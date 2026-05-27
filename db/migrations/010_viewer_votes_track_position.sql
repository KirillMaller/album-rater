-- type: destructive
-- safe-on-prod: yes
-- author: kirill
-- description: добавляем track_position в viewer_votes — позволяет голосовать за каждый трек альбома отдельно. track_position = null означает голос за весь item (альбом/трек/баттл-итог). track_position = N означает голос за N-й трек альбома. Старый unique-индекс заменяется на расширенный — конфликт по тройке (round_index, track_position). На 2026-05-27 в viewer_votes ещё нет данных, миграция без backfill.
-- depends-on: 007_viewer_votes.sql
-- rollback-plan: drop column track_position cascade; пересоздать старый viewer_votes_unique_idx по (viewer_id, item_id, coalesce(round_index, -1)).

alter table public.viewer_votes
  add column if not exists track_position int;

drop index if exists public.viewer_votes_unique_idx;
create unique index viewer_votes_unique_idx
  on public.viewer_votes (
    viewer_id,
    item_id,
    coalesce(round_index, -1),
    coalesce(track_position, -1)
  );
