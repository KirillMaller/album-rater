-- type: additive
-- safe-on-prod: yes (переопределяет функции через CREATE OR REPLACE, данные не трогает и не удаляет)
-- author: kirill
-- description: Честная механика колеса — победитель/выбывший больше не решается один раз при
--   фиксации участников. lock_wheel_session теперь просто открывает сессию к раскрутке, без
--   предрасчёта всей очереди выбывания. Новая RPC spin_wheel_round делает ОДИН взвешенный
--   случайный выбор в момент нажатия «Крутить»: вес участника = 1 / сумма (та же формула, что
--   рисует размер сектора на колесе), чем больше донат — тем меньше сектор — тем меньше шанс
--   вылететь именно в этом раунде. Каждый спин — независимый честный розыгрыш по актуальному
--   списку ещё не выбывших, а не чтение заранее просчитанного списка.
-- depends-on: 014_wheel_multi_category

create or replace function lock_wheel_session(p_session_id uuid)
returns wheel_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session wheel_sessions;
  v_count integer;
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

  update wheel_sessions
    set status = 'locked', locked_at = now(), current_round = 0
    where id = p_session_id
    returning * into v_session;

  return v_session;
end;
$$;

create or replace function spin_wheel_round(p_session_id uuid)
returns table (eliminated_participant_id uuid, reveal_order integer, session_status text, is_final boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session wheel_sessions;
  v_active_count integer;
  v_total_weight numeric;
  v_pick numeric;
  v_running numeric := 0;
  v_chosen uuid;
  v_reveal integer;
  v_row record;
begin
  if not is_admin() then
    raise exception 'not authorized';
  end if;

  select * into v_session from wheel_sessions where id = p_session_id for update;
  if not found then
    raise exception 'session not found';
  end if;
  if v_session.status <> 'locked' then
    raise exception 'session is not in locked state';
  end if;

  -- блокируем участников этой сессии на время розыгрыша — защита от двойного клика/двух вкладок
  perform 1 from wheel_participants where session_id = p_session_id for update;

  select count(*) into v_active_count from wheel_participants where session_id = p_session_id and status = 'active';
  if v_active_count < 2 then
    raise exception 'need at least 2 active participants to spin';
  end if;

  select coalesce(sum(1.0 / amount), 0) into v_total_weight
    from wheel_participants where session_id = p_session_id and status = 'active';

  v_pick := random() * v_total_weight;

  for v_row in
    select id, 1.0 / amount as w
    from wheel_participants
    where session_id = p_session_id and status = 'active'
    order by id
  loop
    v_running := v_running + v_row.w;
    if v_chosen is null and v_running >= v_pick then
      v_chosen := v_row.id;
    end if;
  end loop;

  if v_chosen is null then
    select id into v_chosen from wheel_participants
      where session_id = p_session_id and status = 'active'
      order by id desc limit 1;
  end if;

  select coalesce(max(w.reveal_order), 0) + 1 into v_reveal from wheel_rounds w where w.session_id = p_session_id;

  update wheel_participants set status = 'eliminated', eliminated_at_round = v_reveal where id = v_chosen;

  insert into wheel_rounds (session_id, reveal_order, participant_id, revealed, revealed_at)
    values (p_session_id, v_reveal, v_chosen, true, now());

  if v_active_count = 2 then
    update wheel_participants set status = 'winner'
      where session_id = p_session_id and status = 'active';

    update wheel_sessions
      set status = 'finished', finished_at = now(), current_round = v_reveal,
        winner_participant_id = (select id from wheel_participants where session_id = p_session_id and status = 'winner')
      where id = p_session_id;

    return query select v_chosen, v_reveal, 'finished'::text, true;
  else
    update wheel_sessions set current_round = v_reveal where id = p_session_id;
    return query select v_chosen, v_reveal, 'locked'::text, false;
  end if;
end;
$$;

grant execute on function spin_wheel_round(uuid) to authenticated;
