-- type: additive
-- safe-on-prod: yes (ADD COLUMN + CREATE OR REPLACE FUNCTION, данные не трогает и не удаляет)
-- author: kirill
-- description: Готовит колесо к живому зрительскому экрану (см. docs/wheel-auction/PLAN.md, Этап 2).
--   wheel_rounds.duration_ms хранит длительность анимации, которую админ выбрал для конкретного
--   спина (кнопки +/- у «Крутить», 2-30 сек) — зрительская страница использует его вместе с
--   revealed_at (момент, когда сервер честно решил кто выбывает), чтобы подхватить анимацию в
--   правильной фазе, даже если открыла страницу на середине вращения.
-- depends-on: 015_wheel_live_spin

alter table wheel_rounds add column if not exists duration_ms integer;

create or replace function spin_wheel_round(p_session_id uuid, p_duration_ms integer default 5000)
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

  insert into wheel_rounds (session_id, reveal_order, participant_id, revealed, revealed_at, duration_ms)
    values (p_session_id, v_reveal, v_chosen, true, now(), p_duration_ms);

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

grant execute on function spin_wheel_round(uuid, integer) to authenticated;
