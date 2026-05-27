-- type: destructive
-- safe-on-prod: yes
-- author: kirill
-- description: ужесточаем RLS на viewer_votes — голосовать можно только если в viewer_profiles стоит consented_at. До накатки убедиться: на момент применения у нас нет уже записанных голосов (таблица пустая) или все авторы голосов уже имеют consented_at в viewer_profiles. На 2026-05-27 таблица пустая.
-- depends-on: 007_viewer_votes.sql, 008_viewer_profiles.sql
-- rollback-plan: drop policy viewer_votes_insert_consented + viewer_votes_update_consented, create заново старые policies viewer_votes_insert_own / viewer_votes_update_own с условием auth.uid() = viewer_id.

-- Snapshot перед накаткой: db/snapshots/viewer_votes_<YYYYMMDD>.json (см. DATA_SAFETY.md).

drop policy if exists "viewer_votes_insert_own" on public.viewer_votes;
create policy "viewer_votes_insert_consented"
  on public.viewer_votes for insert
  with check (
    auth.uid() = viewer_id
    and exists (
      select 1 from public.viewer_profiles p
      where p.user_id = auth.uid()
        and p.consented_at is not null
    )
  );

drop policy if exists "viewer_votes_update_own" on public.viewer_votes;
create policy "viewer_votes_update_consented"
  on public.viewer_votes for update
  using (
    auth.uid() = viewer_id
    and exists (
      select 1 from public.viewer_profiles p
      where p.user_id = auth.uid()
        and p.consented_at is not null
    )
  )
  with check (
    auth.uid() = viewer_id
    and exists (
      select 1 from public.viewer_profiles p
      where p.user_id = auth.uid()
        and p.consented_at is not null
    )
  );

-- delete оставляем как было — каждый может удалять свои голоса даже если отозвал согласие.
