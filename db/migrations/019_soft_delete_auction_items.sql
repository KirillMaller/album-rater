-- type: additive
-- safe-on-prod: yes
-- description: Убирает лоты из активной очереди без удаления связанной истории колеса.

alter table auction_items
  add column if not exists archived_at timestamptz;

create index if not exists idx_auction_items_active
  on auction_items (category, amount desc)
  where archived_at is null;
