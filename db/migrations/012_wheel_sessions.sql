-- type: additive
-- safe-on-prod: yes
-- author: kirill
-- description: Таблицы для «Колеса аукциона» (сессия розыгрыша, участники-снапшоты, раунды выбывания) + история ручных пополнений суммы позиции аукциона + две RPC-функции (атомарное пополнение суммы, честная фиксация взвешенного рейтинга участников).
-- depends-on: 004_auction_rules

-- 1. История ручных изменений суммы позиции аукциона (кто/сколько/когда добавил)
create table if not exists auction_amount_log (
  id uuid primary key default gen_random_uuid(),
  auction_item_id uuid not null references auction_items(id) on delete cascade,
  admin_id uuid references auth.users(id),
  delta integer not null check (delta <> 0),
  amount_before integer not null,
  amount_after integer not null,
  note text,
  created_at timestamptz not null default now()
);

alter table auction_amount_log enable row level security;

create policy "auction_amount_log_select_all" on auction_amount_log
  for select using (true);

create policy "auction_amount_log_admin_insert" on auction_amount_log
  for insert with check (is_admin());

-- 2. Сессия розыгрыша колеса (одна на один заход розыгрыша по категории)
create table if not exists wheel_sessions (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('album','series','film','anime','game','battle')),
  status text not null default 'draft' check (status in ('draft','locked','finished','cancelled')),
  current_round integer not null default 0,
  -- без FK-ограничения на wheel_participants — проверяется на уровне приложения,
  -- чтобы не городить порядок создания таблиц по кругу
  winner_participant_id uuid,
  settings jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  locked_at timestamptz,
  finished_at timestamptz
);

alter table wheel_sessions enable row level security;

create policy "wheel_sessions_select_all" on wheel_sessions
  for select using (true);

create policy "wheel_sessions_admin_write" on wheel_sessions
  for all using (is_admin()) with check (is_admin());

-- 3. Участники сессии — снапшот позиции аукциона на момент фиксации ("Зафиксировать участников").
-- Сумма (amount) берётся из auction_items ровно один раз в момент фиксации и дальше не меняется,
-- даже если исходная позиция потом получит новый донат.
create table if not exists wheel_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references wheel_sessions(id) on delete cascade,
  auction_item_id uuid not null references auction_items(id),
  title text not null,
  artist text,
  amount integer not null check (amount > 0),
  rank integer,
  status text not null default 'active' check (status in ('active','eliminated','winner')),
  eliminated_at_round integer,
  created_at timestamptz not null default now(),
  unique (session_id, auction_item_id)
);

alter table wheel_participants enable row level security;

create policy "wheel_participants_select_all" on wheel_participants
  for select using (true);

create policy "wheel_participants_admin_write" on wheel_participants
  for all using (is_admin()) with check (is_admin());

-- 4. Раунды выбывания — по одной строке на каждого выбывшего участника.
-- Весь порядок выбывания рассчитывается один раз при фиксации сессии (lock_wheel_session),
-- дальше администратор только раскрывает эти строки по очереди кнопкой «Крутить» —
-- новый случайный расчёт при этом не происходит, шансы не меняются.
create table if not exists wheel_rounds (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references wheel_sessions(id) on delete cascade,
  reveal_order integer not null,
  participant_id uuid not null references wheel_participants(id),
  revealed boolean not null default false,
  revealed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (session_id, reveal_order)
);

alter table wheel_rounds enable row level security;

create policy "wheel_rounds_select_all" on wheel_rounds
  for select using (true);

create policy "wheel_rounds_admin_write" on wheel_rounds
  for all using (is_admin()) with check (is_admin());

-- 5. Атомарное пополнение суммы позиции аукциона + запись в лог.
-- security definer — чтобы можно было писать в auction_amount_log с проверкой прав внутри функции,
-- а не полагаться на клиентское чтение-затем-запись (защита от гонки при двойном клике/двух вкладках).
create or replace function increment_auction_amount(p_item_id uuid, p_delta integer, p_note text default null)
returns auction_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row auction_items;
  v_before integer;
begin
  if not is_admin() then
    raise exception 'not authorized';
  end if;
  if p_delta is null or p_delta <= 0 then
    raise exception 'delta must be a positive integer';
  end if;

  select amount into v_before from auction_items where id = p_item_id for update;
  if not found then
    raise exception 'auction item not found';
  end if;

  update auction_items
    set amount = amount + p_delta, updated_at = now()
    where id = p_item_id
    returning * into v_row;

  insert into auction_amount_log (auction_item_id, admin_id, delta, amount_before, amount_after, note)
  values (p_item_id, auth.uid(), p_delta, v_before, v_row.amount, p_note);

  return v_row;
end;
$$;

grant execute on function increment_auction_amount(uuid, integer, text) to authenticated;

-- 6. Фиксация участников сессии + честный взвешенный рейтинг.
-- Алгоритм — Efraimidis–Spirakis (A-ES), эквивалент exponential race / Plackett–Luce:
-- для каждого участника key = random()^(1/вес), сортировка по убыванию key.
-- Участник с наибольшим key оказывается в топе рейтинга (rank 0) с вероятностью ровно
-- вес_участника / сумма_всех_весов — то есть вероятность стать итоговым победителем
-- пропорциональна собранной сумме, без искажений от порядка выбывания.
-- Раунды выбывания (wheel_rounds) заполняются от последнего места к первому:
-- reveal_order 1 = участник с наихудшим рейтингом (выбывает первым),
-- rank 0 в раунды не попадает — он и есть финальный победитель.
create or replace function lock_wheel_session(p_session_id uuid)
returns wheel_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session wheel_sessions;
  v_count integer;
  v_reveal integer;
  v_participant record;
begin
  if not is_admin() then
    raise exception 'not authorized';
  end if;

  select * into v_session from wheel_sessions where id = p_session_id for update;
  if not found then
    raise exception 'session not found';
  end if;
  if v_session.status <> 'draft' then
    raise exception 'session already locked or finished';
  end if;

  select count(*) into v_count from wheel_participants where session_id = p_session_id;
  if v_count < 2 then
    raise exception 'need at least 2 participants to spin the wheel';
  end if;

  v_reveal := 0;
  for v_participant in
    select id
    from wheel_participants
    where session_id = p_session_id
    order by power(random(), 1.0 / amount) desc
  loop
    update wheel_participants set rank = v_reveal where id = v_participant.id;
    v_reveal := v_reveal + 1;
  end loop;

  v_reveal := 1;
  for v_participant in
    select id from wheel_participants where session_id = p_session_id order by rank desc
  loop
    exit when v_reveal >= v_count;
    insert into wheel_rounds (session_id, reveal_order, participant_id) values (p_session_id, v_reveal, v_participant.id);
    v_reveal := v_reveal + 1;
  end loop;

  update wheel_sessions
    set status = 'locked', locked_at = now(), current_round = 0
    where id = p_session_id
    returning * into v_session;

  return v_session;
end;
$$;

grant execute on function lock_wheel_session(uuid) to authenticated;
