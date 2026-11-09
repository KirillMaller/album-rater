-- type: additive
-- description: Комментарии к опубликованным баттлам с модерацией через RPC.
-- depends-on: 001_init, 008_viewer_profiles

begin;

create table public.battle_comments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.rated_items(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null check (char_length(author_name) between 1 and 32),
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default clock_timestamp(),
  removed_at timestamptz
);

create index idx_battle_comments_item_page on public.battle_comments (item_id, created_at desc, id desc);
create index idx_battle_comments_author_time on public.battle_comments (author_id, created_at desc);

alter table public.battle_comments enable row level security;
revoke all on table public.battle_comments from public, anon, authenticated;

create function public.list_battle_comments(p_item_id uuid, p_before_id uuid default null)
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
    and i.type = 'battle'
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

create function public.post_battle_comment(p_item_id uuid, p_body text, p_author_name text)
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
  where i.id = p_item_id and i.type = 'battle' and i.published
  for share;
  if not found then
    raise exception 'Этот баттл недоступен для комментариев.';
  end if;

  v_author_name := btrim(regexp_replace(p_author_name, v_whitespace, ' ', 'g'));
  v_body := regexp_replace(p_body, '^' || v_whitespace || '|' || v_whitespace || '$', '', 'g');
  if coalesce(char_length(v_author_name), 0) not between 1 and 32 then
    raise exception 'Ник должен содержать от 1 до 32 символов.';
  end if;
  if coalesce(char_length(v_body), 0) not between 1 and 1000 then
    raise exception 'Комментарий должен содержать от 1 до 1000 символов.';
  end if;

  -- Один интервал на автора для всех баттлов, включая скрытые комментарии.
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

  insert into public.battle_comments (item_id, author_id, author_name, body, created_at)
  values (p_item_id, v_author_id, v_author_name, v_body, v_now)
  returning id into v_comment_id;

  return v_comment_id;
end;
$$;

create function public.remove_battle_comment(p_comment_id uuid)
returns void
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_author_id uuid := auth.uid();
begin
  if v_author_id is null then
    raise exception 'Войдите, чтобы скрыть комментарий.';
  end if;

  update public.battle_comments c
  set removed_at = coalesce(c.removed_at, clock_timestamp())
  where c.id = p_comment_id and (c.author_id = v_author_id or public.is_admin());
  if not found then
    raise exception 'Комментарий недоступен.';
  end if;
end;
$$;

revoke all on function public.list_battle_comments(uuid, uuid) from public, anon, authenticated;
revoke all on function public.post_battle_comment(uuid, text, text) from public, anon, authenticated;
revoke all on function public.remove_battle_comment(uuid) from public, anon, authenticated;

grant execute on function public.list_battle_comments(uuid, uuid) to anon, authenticated;
grant execute on function public.post_battle_comment(uuid, text, text) to authenticated;
grant execute on function public.remove_battle_comment(uuid) to authenticated;

commit;
