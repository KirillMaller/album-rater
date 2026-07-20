-- type: additive
-- safe-on-prod: yes
-- author: kirill
-- description: Свой ник и аватар — видно только самому пользователю в шапке сайта (не другим,
--   не в голосах). viewer_profiles уже существовала (согласие на ПДн, RLS "видит/пишет только
--   сам пользователь", anon не имеет доступа вообще) — переиспользуем как общую таблицу профиля,
--   этой же RLS достаточно и для ника/аватара. Доступно и админам, и зрителям (оба проходят
--   через один и тот же Google OAuth и одну и ту же таблицу).
--   Плюс bucket в Supabase Storage под аватарки — первый бакет в проекте. Публичный на чтение
--   (это просто картинка, которую пользователь сам для себя выбрал, ничего приватного, обычная
--   практика для аватарок), запись — только в свою папку {user_id}/....
-- depends-on: 009_viewer_votes_require_consent

alter table public.viewer_profiles add column if not exists display_name text;
alter table public.viewer_profiles add column if not exists avatar_url text;

alter table public.viewer_profiles add constraint viewer_profiles_display_name_length
  check (display_name is null or char_length(display_name) <= 32) not valid;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatars_own_write" on storage.objects;
create policy "avatars_own_write" on storage.objects
  for insert with check (
    bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "avatars_own_update" on storage.objects;
create policy "avatars_own_update" on storage.objects
  for update using (
    bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "avatars_own_delete" on storage.objects;
create policy "avatars_own_delete" on storage.objects
  for delete using (
    bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]
  );
