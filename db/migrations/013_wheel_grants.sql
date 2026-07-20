-- type: additive
-- safe-on-prod: yes
-- author: kirill
-- description: Недостающие GRANT на таблицы колеса аукциона из 012_wheel_sessions.sql — RLS-политики
--   там были, но без GRANT постгрес всё равно режет доступ к таблице целиком (доступ был проверен на
--   боевой базе: PostgREST отдавал "permission denied for table wheel_sessions", код 42501).
-- depends-on: 012_wheel_sessions

grant select on auction_amount_log to anon, authenticated;
grant insert on auction_amount_log to authenticated;

grant select on wheel_sessions to anon, authenticated;
grant insert, update, delete on wheel_sessions to authenticated;

grant select on wheel_participants to anon, authenticated;
grant insert, update, delete on wheel_participants to authenticated;

grant select on wheel_rounds to anon, authenticated;
grant insert, update, delete on wheel_rounds to authenticated;
