alter table rated_items
  drop constraint if exists rated_items_type_check;

alter table rated_items
  add constraint rated_items_type_check
  check (type in ('album', 'battle', 'track'));

alter table rated_items
  add column if not exists metadata jsonb;
