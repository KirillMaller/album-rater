-- type: additive
-- safe-on-prod: yes
-- author: kirill
-- description: таблица viewer_profiles — хранит факт согласия зрителя на обработку ПДн и условия использования. Без записи здесь зритель не может голосовать (см. миграцию 009).

create table if not exists public.viewer_profiles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    -- момент когда пользователь нажал «Принимаю». null = ещё не согласился.
    consented_at timestamptz,
    -- версия текста на момент согласия. Если поднимем — придётся пересогласовывать.
    consent_version int not null default 1,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- триггер на updated_at
create or replace function public.viewer_profiles_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end$$;

drop trigger if exists viewer_profiles_set_updated_at on public.viewer_profiles;
create trigger viewer_profiles_set_updated_at
  before update on public.viewer_profiles
  for each row execute function public.viewer_profiles_set_updated_at();

-- Grants. select закрыт от anon (профили не публичные), писать может только сам пользователь.
grant select on public.viewer_profiles to authenticated, service_role;
grant insert, update on public.viewer_profiles to authenticated, service_role;
grant delete on public.viewer_profiles to service_role;

-- RLS
alter table public.viewer_profiles enable row level security;

-- видеть свой профиль
drop policy if exists "viewer_profiles_select_own" on public.viewer_profiles;
create policy "viewer_profiles_select_own"
  on public.viewer_profiles for select
  using (auth.uid() = user_id);

-- создавать свой профиль
drop policy if exists "viewer_profiles_insert_own" on public.viewer_profiles;
create policy "viewer_profiles_insert_own"
  on public.viewer_profiles for insert
  with check (auth.uid() = user_id);

-- обновлять свой профиль (например, перезаписать consented_at при пересогласии)
drop policy if exists "viewer_profiles_update_own" on public.viewer_profiles;
create policy "viewer_profiles_update_own"
  on public.viewer_profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
