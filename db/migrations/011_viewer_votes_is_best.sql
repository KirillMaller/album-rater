-- type: additive
-- safe-on-prod: yes
-- author: kirill
-- description: добавляем флаг is_best в viewer_votes — зритель может пометить трек как «свой лучший». Применимо только к голосам с track_position != null. Дефолт false.
-- depends-on: 007_viewer_votes.sql, 010_viewer_votes_track_position.sql

alter table public.viewer_votes
  add column if not exists is_best boolean not null default false;

create index if not exists viewer_votes_best_idx
  on public.viewer_votes (item_id, track_position)
  where is_best = true;
