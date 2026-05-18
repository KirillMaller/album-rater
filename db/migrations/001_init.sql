create extension if not exists "uuid-ossp";

create table rated_items (
  id uuid primary key default uuid_generate_v4(),
  type text not null check (type in ('album', 'battle', 'track')),
  slug text unique not null,
  title text not null,
  artist text,
  participants text,
  cover_url text,
  release_year int,
  genre text,
  description text,
  review text,
  final_score numeric(3,1) check (final_score between 0 and 10),
  score_mode text not null default 'auto' check (score_mode in ('auto', 'manual')),
  metadata jsonb,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table track_scores (
  id uuid primary key default uuid_generate_v4(),
  item_id uuid not null references rated_items(id) on delete cascade,
  position int not null,
  title text not null,
  score numeric(3,1) check (score between 0 and 10),
  cover_url text,
  created_at timestamptz not null default now()
);

create table media_links (
  id uuid primary key default uuid_generate_v4(),
  item_id uuid not null references rated_items(id) on delete cascade,
  kind text not null check (kind in ('original', 'reaction')),
  platform text not null,
  url text not null,
  label text,
  starts_at text,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

create index idx_rated_items_published on rated_items(published);
create index idx_rated_items_type on rated_items(type);
create index idx_track_scores_item on track_scores(item_id);
create unique index idx_track_scores_position on track_scores(item_id, position);
create index idx_media_links_item on media_links(item_id);

create or replace function is_admin() returns boolean as $$
  select exists (
    select 1 from admin_users where user_id = auth.uid()
  );
$$ language sql security definer stable;

create or replace function update_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_rated_items_updated_at
  before update on rated_items
  for each row execute function update_updated_at();

alter table rated_items enable row level security;
alter table track_scores enable row level security;
alter table media_links enable row level security;
alter table admin_users enable row level security;

create policy "public reads published" on rated_items
  for select using (published = true or is_admin());

create policy "admin writes rated_items" on rated_items
  for all using (is_admin()) with check (is_admin());

create policy "public reads track_scores of published" on track_scores
  for select using (
    exists (select 1 from rated_items where id = item_id and (published = true or is_admin()))
  );

create policy "admin writes track_scores" on track_scores
  for all using (is_admin()) with check (is_admin());

create policy "public reads media_links of published" on media_links
  for select using (
    exists (select 1 from rated_items where id = item_id and (published = true or is_admin()))
  );

create policy "admin writes media_links" on media_links
  for all using (is_admin()) with check (is_admin());

create policy "admin reads admin_users" on admin_users
  for select using (is_admin());

grant usage on schema public to anon, authenticated;
grant execute on function is_admin() to anon, authenticated;

grant select on rated_items to anon, authenticated;
grant select on track_scores to anon, authenticated;
grant select on media_links to anon, authenticated;

grant insert, update, delete on rated_items to authenticated;
grant insert, update, delete on track_scores to authenticated;
grant insert, update, delete on media_links to authenticated;
grant select on admin_users to authenticated;
