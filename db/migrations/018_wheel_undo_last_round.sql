-- type: additive
-- safe-on-prod: yes (CREATE OR REPLACE FUNCTION — данные не удаляет структурно; RPC делает
--   обычный UPDATE/DELETE строк как часть бизнес-логики отмены, это не DDL и не затрагивает схему)
-- author: kirill
-- description: RPC для отмены последнего спина колеса (design_handoff_r1f_redesign/README.md
--   §4.1, П4 «Отмена последнего спина» — страховка от промаха на живом эфире: один honest-спин
--   уже нельзя было исправить иначе, чем начать весь розыгрыш заново). Возвращает последнего
--   выбывшего участника обратно в 'active'. Если последний спин был решающим (сессия уже
--   'finished') — откатывает и победителя обратно в 'active', сессию обратно в 'locked'.
--   Удаляет соответствующую строку wheel_rounds, чтобы история и current_round остались
--   консистентны. Как и spin_wheel_round — сама проверяет is_admin(), не полагается на RLS.
-- depends-on: 016_wheel_spin_duration
--
-- ⚠️ НЕ ПРИМЕНЕНО К БАЗЕ. Подготовлено на этапе редизайна (design_handoff_r1f_redesign),
--   кнопка «Отменить спин» в WheelPanel уже вызывает эту RPC и до применения миграции будет
--   честно показывать ошибку от Supabase вместо тихого падения. Катить на DEV/PROD — только
--   после явного «да» Кирилла и снапшота (docs/DATA_SAFETY.md).

create or replace function undo_last_wheel_round(p_session_id uuid)
returns wheel_rounds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session wheel_sessions;
  v_round wheel_rounds;
begin
  if not is_admin() then
    raise exception 'not authorized';
  end if;

  select * into v_session from wheel_sessions where id = p_session_id for update;
  if not found then
    raise exception 'session not found';
  end if;
  if v_session.status not in ('locked', 'finished') then
    raise exception 'session is not in a state that can be undone';
  end if;

  select * into v_round from wheel_rounds
    where session_id = p_session_id
    order by reveal_order desc
    limit 1;
  if not found then
    raise exception 'no round to undo';
  end if;

  -- блокируем участников этой сессии на время отмены — та же защита от гонки, что и при спине
  perform 1 from wheel_participants where session_id = p_session_id for update;

  if v_session.status = 'finished' then
    -- последний спин был решающим: возвращаем в игру и выбывшего, и того, кого он сделал победителем
    update wheel_participants set status = 'active', eliminated_at_round = null
      where id = v_round.participant_id;
    update wheel_participants set status = 'active'
      where session_id = p_session_id and status = 'winner';
    update wheel_sessions
      set status = 'locked', finished_at = null, winner_participant_id = null,
        current_round = v_round.reveal_order - 1
      where id = p_session_id;
  else
    update wheel_participants set status = 'active', eliminated_at_round = null
      where id = v_round.participant_id;
    update wheel_sessions set current_round = v_round.reveal_order - 1 where id = p_session_id;
  end if;

  delete from wheel_rounds where id = v_round.id;

  return v_round;
end;
$$;

grant execute on function undo_last_wheel_round(uuid) to authenticated;
