-- Очередь аукционов: на что зрители скидывают донаты.
-- После разбора запись удаляется (а в каталоге появляется обычная карточка с оценкой).

create table auction_items (
  id uuid primary key default uuid_generate_v4(),
  category text not null check (category in ('album', 'series', 'film', 'anime', 'game', 'battle')),
  title text not null,
  artist text,
  amount integer not null default 0 check (amount >= 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_auction_items_category on auction_items(category);
create index idx_auction_items_amount on auction_items(amount desc);

create trigger trg_auction_items_updated_at
  before update on auction_items
  for each row execute function update_updated_at();

alter table auction_items enable row level security;

create policy "public reads auction_items" on auction_items
  for select using (true);

create policy "admin writes auction_items" on auction_items
  for all using (is_admin()) with check (is_admin());

grant select on auction_items to anon, authenticated;
grant insert, update, delete on auction_items to authenticated;
