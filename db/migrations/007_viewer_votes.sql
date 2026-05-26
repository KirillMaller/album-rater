-- type: additive
-- safe-on-prod: yes
-- author: kirill
-- description: таблица viewer_votes для голосов зрителей за треки/альбомы/баттлы. RLS: читать всем, писать только свой голос.

create table if not exists public.viewer_votes (
    id uuid primary key default gen_random_uuid(),
    viewer_id uuid not null references auth.users(id) on delete cascade,
    item_id uuid not null references public.rated_items(id) on delete cascade,
    -- для альбома/трека: оценка 0..11 (как у Рифмабеса), для баттла обычно null
    score numeric(4,2) check (score is null or (score >= 0 and score <= 11)),
    -- для баттла: null = голос за итог, иначе индекс раунда (0..N)
    round_index int,
    -- для баттла: победитель раунда или итога
    winner_side text check (winner_side is null or winner_side in ('a','b','draw')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- один аккаунт = один голос на (item, round). coalesce даёт стабильный ключ когда round_index = null (итог баттла или трек)
create unique index if not exists viewer_votes_unique_idx
  on public.viewer_votes (viewer_id, item_id, coalesce(round_index, -1));

-- быстрый агрегат «средняя оценка зрителей по item»
create index if not exists viewer_votes_item_idx on public.viewer_votes (item_id);

-- триггер на updated_at
create or replace function public.viewer_votes_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end$$;

drop trigger if exists viewer_votes_set_updated_at on public.viewer_votes;
create trigger viewer_votes_set_updated_at
  before update on public.viewer_votes
  for each row execute function public.viewer_votes_set_updated_at();

-- Grants (паттерн как в 001/003/004 — select всем, остальное только залогиненным; service_role для backup-скриптов)
grant select on public.viewer_votes to anon, authenticated, service_role;
grant insert, update, delete on public.viewer_votes to authenticated, service_role;

-- RLS
alter table public.viewer_votes enable row level security;

-- читать всем (нужно для агрегации средней оценки)
drop policy if exists "viewer_votes_select_all" on public.viewer_votes;
create policy "viewer_votes_select_all"
  on public.viewer_votes for select
  using (true);

-- писать только свой голос
drop policy if exists "viewer_votes_insert_own" on public.viewer_votes;
create policy "viewer_votes_insert_own"
  on public.viewer_votes for insert
  with check (auth.uid() = viewer_id);

drop policy if exists "viewer_votes_update_own" on public.viewer_votes;
create policy "viewer_votes_update_own"
  on public.viewer_votes for update
  using (auth.uid() = viewer_id)
  with check (auth.uid() = viewer_id);

drop policy if exists "viewer_votes_delete_own" on public.viewer_votes;
create policy "viewer_votes_delete_own"
  on public.viewer_votes for delete
  using (auth.uid() = viewer_id);
