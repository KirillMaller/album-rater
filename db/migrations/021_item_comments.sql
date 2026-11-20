-- type: additive
-- description: Комментарии ко всем опубликованным карточкам с автоматической подписью.
-- depends-on: 020_battle_comments

begin;

create or replace function public.list_battle_comments(p_item_id uuid, p_before_id uuid default null)
returns table (id uuid, author_name text, body text, created_at timestamptz, can_remove boolean)
language sql stable security definer
-- Существующая is_admin() обращается к public.admin_users без схемы.
set search_path = pg_catalog, public, pg_temp
as $$
  select c.id, c.author_name, c.body, c.created_at,
         coalesce(c.author_id = auth.uid(), false) or public.is_admin()
  from public.battle_comments c
  join public.rated_items i on i.id = c.item_id
  where c.item_id = p_item_id
    and i.published
    and c.removed_at is null
    and (
      p_before_id is null or (c.created_at, c.id) < (
        -- Скрытый комментарий остаётся рабочим курсором своей страницы.
        select cursor_comment.created_at, cursor_comment.id
        from public.battle_comments cursor_comment
        where cursor_comment.id = p_before_id and cursor_comment.item_id = p_item_id
      )
    )
  order by c.created_at desc, c.id desc
  limit 20;
$$;

create function public.post_item_comment(p_item_id uuid, p_body text)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_author_id uuid := auth.uid();
  v_whitespace constant text := U&'[[:space:]\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+';
  v_author_name text;
  v_body text;
  v_now timestamptz;
  v_comment_id uuid;
begin
  if v_author_id is null then
    raise exception 'Войдите, чтобы оставить комментарий.';
  end if;

  perform 1 from public.viewer_profiles p
  where p.user_id = v_author_id and p.consented_at is not null and p.consent_version >= 2
  for share;
  if not found then
    raise exception 'Подтвердите согласие с условиями участия, чтобы оставить комментарий.';
  end if;

  perform 1 from public.rated_items i
  where i.id = p_item_id and i.published
  for share;
  if not found then
    raise exception 'Эта карточка недоступна для комментариев.';
  end if;

  v_body := regexp_replace(p_body, '^' || v_whitespace || '|' || v_whitespace || '$', '', 'g');
  if coalesce(char_length(v_body), 0) not between 1 and 1000 then
    raise exception 'Комментарий должен содержать от 1 до 1000 символов.';
  end if;

  -- Один интервал на автора для всех карточек, включая скрытые комментарии.
  if not pg_try_advisory_xact_lock(hashtextextended('battle_comments:' || v_author_id::text, 0)) then
    raise exception 'Подождите 10 секунд между комментариями.';
  end if;
  v_now := clock_timestamp();
  if exists (
    select 1 from public.battle_comments c
    where c.author_id = v_author_id and c.created_at > v_now - interval '10 seconds'
  ) then
    raise exception 'Подождите 10 секунд между комментариями.';
  end if;

  -- Повторно используем только имя из уже публичного комментария.
  select c.author_name into v_author_name
  from public.battle_comments c
  join public.rated_items i on i.id = c.item_id
  where c.author_id = v_author_id and c.removed_at is null and i.published
  order by c.created_at desc, c.id desc
  limit 1;

  -- Случайная подпись не позволяет вычислить внутренний ID автора.
  v_author_name := coalesce(v_author_name, 'Зритель ' || left(gen_random_uuid()::text, 8));

  insert into public.battle_comments (item_id, author_id, author_name, body, created_at)
  values (p_item_id, v_author_id, v_author_name, v_body, v_now)
  returning id into v_comment_id;

  return v_comment_id;
end;
$$;

revoke all on function public.post_item_comment(uuid, text) from public, anon, authenticated;
grant execute on function public.post_item_comment(uuid, text) to authenticated;

-- Прежняя сигнатура нужна вкладкам, открытым до обновления фронта.
create or replace function public.post_battle_comment(p_item_id uuid, p_body text, p_author_name text)
returns uuid
language sql security invoker
set search_path = pg_catalog, pg_temp
as $$
  select public.post_item_comment(p_item_id, p_body);
$$;

notify pgrst, 'reload schema';
commit;
