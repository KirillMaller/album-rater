import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

type ItemComment = {
  id: string;
  author_name: string;
  body: string;
  created_at: string;
  can_remove: boolean;
};

type Props = {
  supabase: SupabaseClient;
  itemId: string;
  signedIn: boolean;
  consentLoaded: boolean;
  canPost: boolean;
  formatDate: (value: string) => string;
  returnKey: string;
  onSignIn: () => void;
  onConsent: () => void;
};

const pageSize = 20;

async function fetchComments(supabase: SupabaseClient, itemId: string, beforeId: string | null) {
  const { data, error } = await supabase.rpc('list_battle_comments', {
    p_item_id: itemId,
    p_before_id: beforeId,
  });
  if (error) throw error;
  return data as ItemComment[];
}

export function ItemComments({
  supabase, itemId, signedIn, consentLoaded, canPost,
  formatDate, returnKey, onSignIn, onConsent,
}: Props) {
  const section = useRef<HTMLElement>(null);
  const [comments, setComments] = useState<ItemComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState('');
  const [body, setBody] = useState('');
  const normalizedBody = body.trim();

  useEffect(() => {
    let active = true;
    void fetchComments(supabase, itemId, null)
      .then((page) => {
        if (!active) return;
        setComments(page);
        setCursor(page.length === pageSize ? page[page.length - 1].id : null);
      })
      .catch(() => { if (active) setLoadError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [supabase, itemId]);

  useEffect(() => {
    const { pathname, search, hash } = window.location;
    const returned = sessionStorage.getItem(returnKey) === pathname + search;
    if (returned || hash === '#comments') {
      const frame = requestAnimationFrame(() => {
        if (returned) sessionStorage.removeItem(returnKey);
        section.current?.scrollIntoView();
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [returnKey]);

  const loadPage = async (beforeId: string | null) => {
    if (!beforeId) setCursor(null);
    setLoading(true);
    setLoadError(false);
    try {
      const page = await fetchComments(supabase, itemId, beforeId);
      setComments((previous) => beforeId ? [...previous, ...page] : page);
      setCursor(page.length === pageSize ? page[page.length - 1].id : null);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  const post = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canPost || pending || loading || !normalizedBody) return;
    setPending(true);
    setActionError('');
    try {
      const { error } = await supabase.rpc('post_item_comment', {
        p_item_id: itemId,
        p_body: normalizedBody,
      });
      if (error) {
        setActionError(error.code === 'P0001' ? error.message : 'Не удалось опубликовать комментарий.');
        return;
      }
      setBody('');
      await loadPage(null);
    } catch {
      setActionError('Не удалось опубликовать комментарий.');
    } finally {
      setPending(false);
    }
  };

  const remove = async (commentId: string) => {
    setPending(true);
    setActionError('');
    try {
      const { error } = await supabase.rpc('remove_battle_comment', { p_comment_id: commentId });
      if (error) {
        setActionError('Не удалось убрать комментарий.');
        return;
      }
      setComments((previous) => previous.filter((comment) => comment.id !== commentId));
    } catch {
      setActionError('Не удалось убрать комментарий.');
    } finally {
      setPending(false);
    }
  };

  return (
    <section id="comments" ref={section} className="panel item-comments" aria-labelledby="comments-title" tabIndex={-1}>
      <h2 id="comments-title">Комментарии</h2>
      {canPost ? (
        <form className="item-comment-form" onSubmit={post}>
          <textarea
            aria-label="Текст комментария"
            placeholder="Написать комментарий"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={2}
            maxLength={1000}
            required
            disabled={pending}
          />
          <button type="submit" className="item-comment-submit" disabled={loading || pending || !normalizedBody}>Опубликовать</button>
        </form>
      ) : !signedIn ? (
        <button type="button" className="ghost" onClick={onSignIn}>Войти, чтобы оставить комментарий</button>
      ) : consentLoaded ? (
        <button type="button" className="ghost" onClick={onConsent}>Принять условия и оставить комментарий</button>
      ) : <p className="muted">Загружаю профиль…</p>}
      {actionError && <p className="form-error" role="alert">{actionError}</p>}
      {comments.length > 0 && (
        <ul className="item-comment-list" role="list">
          {comments.map((comment) => (
            <li key={comment.id}>
              <span className="item-comment-avatar" aria-hidden="true">{Array.from(comment.author_name.trim())[0] || '•'}</span>
              <div className="item-comment-content">
                <div className="item-comment-meta">
                  <strong dir="auto">{comment.author_name}</strong>
                  <time dateTime={comment.created_at}>{formatDate(comment.created_at)}</time>
                </div>
                <p dir="auto">{comment.body}</p>
                {comment.can_remove && (
                  <button type="button" className="item-comment-remove" aria-label="Убрать комментарий" disabled={loading || pending} onClick={() => void remove(comment.id)}>
                    Убрать
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {loading && <p className="muted" role="status">Загружаю комментарии…</p>}
      {loadError && (
        <div className="item-comment-retry">
          <p className="form-error" role="alert">Не удалось загрузить комментарии.</p>
          <button type="button" className="ghost" disabled={pending || loading} onClick={() => void loadPage(cursor)}>Повторить</button>
        </div>
      )}
      {!loading && !loadError && !comments.length && <p className="muted">Комментариев пока нет.</p>}
      {cursor && !loadError && (
        <button type="button" className="ghost" disabled={loading || pending} onClick={() => void loadPage(cursor)}>Показать ещё</button>
      )}
    </section>
  );
}
