-- Прикол: возможность выставить оценку до 11 ("this one goes to eleven").
-- Расширяем верхнюю границу с 10 до 11 для итоговой оценки и оценок треков.

alter table rated_items drop constraint if exists rated_items_final_score_check;
alter table rated_items add constraint rated_items_final_score_check check (final_score between 0 and 11);

alter table track_scores drop constraint if exists track_scores_score_check;
alter table track_scores add constraint track_scores_score_check check (score between 0 and 11);
