-- Дата оценки записи (когда стример её разобрал).
-- Отличается от created_at: запись могла быть добавлена сегодня,
-- но оценена раньше — админ ставит реальную дату вручную.
-- Действует для всех типов: album, battle, track.

alter table rated_items
  add column if not exists reviewed_at date;
