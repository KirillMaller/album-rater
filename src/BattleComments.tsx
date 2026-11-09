import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

type BattleComment = {
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
  return data as BattleComment[];
}

export function BattleComments({
  supabase, itemId, signedIn, consentLoaded, canPost,
  formatDate, returnKey, onSignIn, onConsent,
}: Props) {
  const section = useRef<HTMLElement>(null);
  const [comments, setComments] = useState<BattleComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState('');
  const [name, setName] = useState('');
  const [body, setBody] = useState('');

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
    if (returned) sessionStorage.removeItem(returnKey);
    if (returned || hash === '#comments') {
      const frame = requestAnimationFrame(() => section.current?.scrollIntoView());
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
    if (!canPost || pending || loading || !body.trim() || !name.trim()) return;
    setPending(true);
    setActionError('');
    try {
      const { error } = await supabase.rpc('post_battle_comment', {
        p_item_id: itemId,
        p_body: body.trim(),
        p_author_name: name.trim(),
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
    <section id="comments" ref={section} className="panel battle-comments" aria-labelledby="comments-title">
      <h2 id="comments-title">Комментарии</h2>
      {canPost ? (
        <form className="battle-comment-form" onSubmit={post}>
          <label>
            Публичный ник
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={32} required disabled={pending} />
          </label>
          <label>
            Оставить комментарий
            <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={3} maxLength={1000} required disabled={pending} />
          </label>
          <button type="submit" disabled={loading || pending || !name.trim() || !body.trim()}>Опубликовать</button>
        </form>
      ) : !signedIn ? (
        <button type="button" className="ghost" onClick={onSignIn}>Войти, чтобы оставить комментарий</button>
      ) : consentLoaded ? (
        <button type="button" className="ghost" onClick={onConsent}>Принять условия и оставить комментарий</button>
      ) : <p className="muted">Загружаю профиль…</p>}
      {actionError && <p className="form-error" role="alert">{actionError}</p>}
      {comments.length > 0 && (
        <ul className="battle-comment-list">
          {comments.map((comment) => (
            <li key={comment.id}>
              <div className="battle-comment-meta">
                <strong>{comment.author_name}</strong>
                <time dateTime={comment.created_at}>{formatDate(comment.created_at)}</time>
                {comment.can_remove && (
                  <button type="button" className="ghost" disabled={loading || pending} onClick={() => void remove(comment.id)}>
                    Убрать
                  </button>
                )}
              </div>
              <p>{comment.body}</p>
            </li>
          ))}
        </ul>
      )}
      {loading && <p className="muted" role="status">Загружаю комментарии…</p>}
      {loadError && (
        <div className="battle-comment-retry">
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
