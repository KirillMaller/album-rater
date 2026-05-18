-- Правила аукционов: markdown-текст. По умолчанию одна строка scope='global'.
-- В будущем можно завести отдельные правила для категорий (scope='album' и т.п.) без миграции.

create table auction_rules (
  scope text primary key,
  content text not null default '',
  updated_at timestamptz not null default now()
);

create trigger trg_auction_rules_updated_at
  before update on auction_rules
  for each row execute function update_updated_at();

alter table auction_rules enable row level security;

create policy "public reads auction_rules" on auction_rules
  for select using (true);

create policy "admin writes auction_rules" on auction_rules
  for all using (is_admin()) with check (is_admin());

grant select on auction_rules to anon, authenticated;
grant insert, update, delete on auction_rules to authenticated;

insert into auction_rules (scope, content)
values ('global', '## Правила аукционов

Текст появится позже.')
on conflict (scope) do nothing;
