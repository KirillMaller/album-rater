-- type: additive
-- safe-on-prod: yes
-- author: kirill
-- description: Поддержка розыгрыша колеса сразу по нескольким категориям.
--   wheel_sessions.categories — полный список категорий сессии (старая колонка category
--   остаётся для обратной совместимости, хранит первую из выбранных).
--   wheel_participants.category — категория конкретного участника-снапшота,
--   нужна чтобы группировать список подготовки по категориям на фронте.
-- depends-on: 013_wheel_grants

alter table wheel_sessions add column if not exists categories text[] not null default '{}'::text[];

alter table wheel_participants add column if not exists category text;

alter table wheel_participants add constraint wheel_participants_category_check
  check (category is null or category in ('album','series','film','anime','game','battle')) not valid;
