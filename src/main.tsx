import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createClient, type User } from '@supabase/supabase-js';
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  Edit3,
  ExternalLink,
  Headphones,
  Library,
  Lock,
  LogOut,
  Plus,
  Save,
  Search,
  Star,
  Trash2,
  Video,
} from 'lucide-react';
import './styles.css';

const redirectedUrl = sessionStorage.getItem('redirect');
if (redirectedUrl) {
  sessionStorage.removeItem('redirect');
  history.replaceState(null, '', redirectedUrl);
}

type ItemType = 'album' | 'battle' | 'track';
type ScoreMode = 'auto' | 'manual';
type LinkKind = 'original' | 'reaction';

type BattleSideKey = 'a' | 'b' | 'draw';

type BattleRound = {
  id: string;
  position: number;
  winner: BattleSideKey;
  scoreA: number | '';
  scoreB: number | '';
  comment?: string;
};

type BattleFormat = '1v1' | '2v2' | '3v3' | 'triple' | 'deathmatch' | 'other';
type BattleStyle = 'acapella' | 'bpm' | 'mixed' | 'freestyle' | 'thematic' | 'other';

type BattleMetadata = {
  sideA: string;
  sideB: string;
  rounds: BattleRound[];
  finalWinner: BattleSideKey;
  format?: BattleFormat;
  style?: BattleStyle;
  stage?: string;
};

type ItemMetadata = {
  battle?: BattleMetadata;
  yandex?: {
    albumId: string;
    trackId?: string;
    sourceUrl: string;
  };
  youtube?: {
    videoId: string;
    sourceUrl: string;
  };
};

type ParsedBattleTitle =
  | { format: 'standard'; sideA: string[]; sideB: string[]; tournament: string; stage: string }
  | { format: 'deathmatch'; participants: string[]; tournament: string; stage: string }
  | { format: 'unknown'; raw: string; tournament: string; stage: string };

type YoutubeImportResult = {
  videoId: string;
  sourceUrl: string;
  title: string;
  author: string;
  authorUrl: string;
  thumbnailUrl: string;
  parsed: ParsedBattleTitle;
};

type TrackScore = {
  id: string;
  position: number;
  title: string;
  score: number | '';
  coverUrl?: string;
};

type MediaLink = {
  id: string;
  kind: LinkKind;
  platform: string;
  url: string;
  label?: string;
  startsAt?: string;
};

const originalPlatforms = ['Яндекс.Музыка', 'Spotify', 'Apple Music', 'YouTube Music', 'VK Музыка', 'SoundCloud', 'Bandcamp', 'Другое'];

const genreOptions = ['Рэп', 'Поп', 'R&B / соул', 'Рок', 'Электроника', 'Инди', 'Метал', 'Экспериментальный', 'Свой'];

const battleFormatOptions: Array<{ value: BattleFormat; label: string }> = [
  { value: '1v1', label: '1 на 1' },
  { value: '2v2', label: '2 на 2' },
  { value: '3v3', label: '3 на 3' },
  { value: 'triple', label: 'Triple Threat (1 vs 1 vs 1)' },
  { value: 'deathmatch', label: 'Дезматч (4+, все против всех)' },
  { value: 'other', label: 'Свой формат' },
];

const battleStyleOptions: Array<{ value: BattleStyle; label: string }> = [
  { value: 'acapella', label: 'A Capella (без бита)' },
  { value: 'bpm', label: 'BPM (с битом)' },
  { value: 'mixed', label: 'BPM + A Capella' },
  { value: 'freestyle', label: 'Фристайл / Импровизация' },
  { value: 'thematic', label: 'Тематический' },
  { value: 'other', label: 'Свой стиль' },
];

const battleGenre = 'Баттл-рэп';
const reactionPlatforms = ['YouTube', 'Boosty', 'Twitch', 'VK Видео', 'Rutube', 'Другое'];

type YandexImportResult = {
  albumId: string;
  trackId?: string;
  title: string;
  artist: string;
  year?: number;
  genre?: string;
  coverUrl?: string;
  tracks: Array<{ id?: number; title: string; duration?: string }>;
  sourceUrl: string;
};

type RatedItem = {
  id: string;
  type: ItemType;
  slug: string;
  title: string;
  artist?: string;
  participants?: string;
  coverUrl?: string;
  releaseYear?: number;
  genre?: string;
  description?: string;
  review?: string;
  finalScore: number;
  scoreMode: ScoreMode;
  published: boolean;
  tracks: TrackScore[];
  links: MediaLink[];
  metadata?: ItemMetadata;
  createdAt: string;
  updatedAt: string;
};

const storageKey = 'r1frating-items-v1';
const authKey = 'r1frating-demo-admin';
const hasSupabaseEnv = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
const supabase = hasSupabaseEnv
  ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
  : null;

function extractYoutubeId(rawUrl: string): string {
  const u = new URL(rawUrl);
  if (u.hostname === 'youtu.be') {
    const id = u.pathname.slice(1).split('/')[0];
    if (!id) throw new Error('В ссылке YouTube не найден ID видео');
    return id;
  }
  if (u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com' || u.hostname === 'm.youtube.com') {
    const id = u.searchParams.get('v');
    if (id) return id;
    const m = u.pathname.match(/^\/(?:shorts|embed)\/([\w-]+)/);
    if (m) return m[1];
  }
  throw new Error('Это не ссылка YouTube');
}

function parseBattleTitle(title: string, author: string): ParsedBattleTitle {
  let t = title
    .replace(/\s*#[\wА-яёЁ]+/g, '')
    .replace(/\s*\|\s*\d{4}\s*$/, '')
    .trim();

  let fighters = t;
  let tail = '';
  for (const sep of [' | ', ' - ', ' — ']) {
    const i = t.indexOf(sep);
    if (i > 0) {
      fighters = t.slice(0, i);
      tail = t.slice(i + sep.length);
      break;
    }
  }

  let tournament = '';
  let stage = '';
  const paren = fighters.match(/^(.+?)\s*\(([^)]+)\)\s*(.*)$/);
  if (paren) {
    fighters = paren[1].trim();
    tournament = paren[2].trim();
    stage = paren[3].trim();
  }

  if (!tournament && tail) {
    const m = tail.match(/^([^:]+?)(?::\s*(.+))?$/);
    tournament = m?.[1]?.trim() || tail.trim();
    stage = m?.[2]?.trim() || stage;
  }

  const split = (s: string) =>
    s
      .split(/\s+(?:x|х|&|\+)\s+/i)
      .map((p) => p.replace(/\s+aka\s+.+$/i, '').trim())
      .filter(Boolean);

  const vsMatch = fighters.match(/^(.+?)\s+(?:vs|VS|Vs|против)\s+(.+)$/);
  if (vsMatch) {
    return {
      format: 'standard',
      sideA: split(vsMatch[1]),
      sideB: split(vsMatch[2]),
      tournament,
      stage,
    };
  }

  const haystack = `${author} ${title}`;
  if (/БОЛЬШЕ\s+ЧЕМ\s+БАТТЛ|DEATHMATCH|ДЕЗМАТЧ/i.test(haystack)) {
    return {
      format: 'deathmatch',
      participants: split(fighters),
      tournament: tournament || author,
      stage,
    };
  }

  return {
    format: 'unknown',
    raw: fighters,
    tournament: tournament || author,
    stage,
  };
}

async function fetchYoutubeBattle(rawUrl: string): Promise<YoutubeImportResult> {
  const videoId = extractYoutubeId(rawUrl);
  const canonical = `https://www.youtube.com/watch?v=${videoId}`;
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonical)}&format=json`;
  const response = await fetch(oembedUrl);
  if (response.status === 404 || response.status === 401) {
    throw new Error('Ролик не найден или закрыт от встраивания');
  }
  if (!response.ok) {
    throw new Error(`YouTube вернул HTTP ${response.status}`);
  }
  const data = await response.json();
  const title = String(data.title ?? '');
  const author = String(data.author_name ?? '');
  return {
    videoId,
    sourceUrl: canonical,
    title,
    author,
    authorUrl: String(data.author_url ?? ''),
    thumbnailUrl: String(data.thumbnail_url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`),
    parsed: parseBattleTitle(title, author),
  };
}

const starterItems: RatedItem[] = [
  {
    id: crypto.randomUUID(),
    type: 'album',
    slug: 'kanye-west-donda',
    title: 'Donda',
    artist: 'Kanye West',
    coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/98/67/84/98678497-e0c1-13d0-98bc-175904342f7c/21UMGIM73612.rgb.jpg/600x600bb.jpg',
    releaseYear: 2021,
    genre: 'Hip-Hop',
    description: 'Большой альбом с резкими перепадами, сильными гостями и неоднородной драматургией.',
    review: '### Коротко\n\nСильные пики вытягивают альбом, но длина и повторы мешают держать фокус. В MVP это демо-запись, её можно удалить в админке.',
    finalScore: 7.6,
    scoreMode: 'auto',
    published: true,
    tracks: [
      { id: crypto.randomUUID(), position: 1, title: 'Jail', score: 8.2 },
      { id: crypto.randomUUID(), position: 2, title: 'Off The Grid', score: 8.8 },
      { id: crypto.randomUUID(), position: 3, title: 'Hurricane', score: 7.4 },
      { id: crypto.randomUUID(), position: 4, title: 'Moon', score: 8.0 },
    ],
    links: [
      { id: crypto.randomUUID(), kind: 'original', platform: 'Apple Music', url: 'https://music.apple.com/', label: 'Послушать альбом' },
      { id: crypto.randomUUID(), kind: 'reaction', platform: 'YouTube', url: 'https://youtube.com/', label: 'Реакция', startsAt: '00:12:30' },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

function readItems() {
  const raw = localStorage.getItem(storageKey);
  return raw ? (JSON.parse(raw) as RatedItem[]) : starterItems;
}

function averageScore(tracks: TrackScore[]) {
  const scores = tracks.map((track) => Number(track.score)).filter(Number.isFinite);
  if (!scores.length) return 0;
  return Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1));
}

function normalizeSlug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/['"`]/g, '')
    .replace(/[^a-zа-яё0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '');
}

function createItemSlug(item: RatedItem) {
  const base = [item.type === 'battle' ? item.participants : item.artist, item.title]
    .filter(Boolean)
    .join(' ');
  return normalizeSlug(base || item.title || crypto.randomUUID());
}

function parseTrackList(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\d+[\.)\-\s]+/, ''))
    .filter(Boolean)
    .map((title, index) => ({ id: crypto.randomUUID(), position: index + 1, title, score: '' as const }));
}

function normalizeTrackPositions(tracks: TrackScore[]) {
  return tracks.map((track, index) => ({ ...track, position: index + 1 }));
}

function createBattleRound(position: number): BattleRound {
  return {
    id: crypto.randomUUID(),
    position,
    winner: 'draw',
    scoreA: '',
    scoreB: '',
  };
}

function normalizeBattleRounds(rounds: BattleRound[]) {
  return rounds.map((round, index) => ({ ...round, position: index + 1 }));
}

function createDefaultBattle(): BattleMetadata {
  return {
    sideA: '',
    sideB: '',
    rounds: [createBattleRound(1), createBattleRound(2), createBattleRound(3)],
    finalWinner: 'draw',
    format: '1v1',
  };
}

function battleWinnerLabel(battle?: BattleMetadata) {
  if (!battle) return 'Победитель не выбран';
  if (battle.finalWinner === 'a') return battle.sideA || 'Сторона A';
  if (battle.finalWinner === 'b') return battle.sideB || 'Сторона B';
  return 'Ничья / спорно';
}

function itemAdminMeta(item: RatedItem) {
  const base = `${itemTypeLabel(item.type)} · ${item.published ? 'опубликовано' : 'черновик'} · ${item.finalScore.toFixed(1)}`;
  if (item.type !== 'battle') return base;
  return `${base} · Победитель: ${battleWinnerLabel(item.metadata?.battle)}`;
}

function itemTypeLabel(type: ItemType) {
  if (type === 'album') return 'Альбом';
  if (type === 'battle') return 'Баттл';
  return 'Трек';
}

function itemCredit(item: RatedItem) {
  if (item.type === 'battle') return item.participants || 'Участники не указаны';
  return item.artist || 'Артист не указан';
}

function scoreClass(score: number) {
  if (score >= 9) return 'score score-top';
  if (score >= 7.5) return 'score score-high';
  if (score >= 6) return 'score score-mid';
  if (score >= 4) return 'score score-low';
  return 'score score-bad';
}

function fromDbItem(row: any): RatedItem {
  return {
    id: row.id,
    type: row.type,
    slug: row.slug,
    title: row.title,
    artist: row.artist ?? undefined,
    participants: row.participants ?? undefined,
    coverUrl: row.cover_url ?? undefined,
    releaseYear: row.release_year ?? undefined,
    genre: row.genre ?? undefined,
    description: row.description ?? undefined,
    review: row.review ?? undefined,
    finalScore: Number(row.final_score ?? 0),
    scoreMode: row.score_mode,
    published: row.published,
    tracks: [...(row.track_scores ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((track) => ({
        id: track.id,
        position: track.position,
        title: track.title,
        score: track.score === null ? '' : Number(track.score),
        coverUrl: track.cover_url ?? undefined,
      })),
    links: [...(row.media_links ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((link) => ({
        id: link.id,
        kind: link.kind,
        platform: link.platform,
        url: link.url,
        label: link.label ?? undefined,
        startsAt: link.starts_at ?? undefined,
      })),
    metadata: row.metadata ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toDbItem(item: RatedItem) {
  return {
    id: item.id,
    type: item.type,
    slug: item.slug,
    title: item.title,
    artist: item.artist || null,
    participants: item.participants || null,
    cover_url: item.coverUrl || null,
    release_year: item.releaseYear || null,
    genre: item.genre || null,
    description: item.description || null,
    review: item.review || null,
    final_score: item.finalScore,
    score_mode: item.scoreMode,
    published: item.published,
    metadata: item.metadata ?? null,
  };
}

type Store = {
  items: RatedItem[];
  loading: boolean;
  error?: string;
  admin: boolean;
  user: User | null;
  setAdmin: (value: boolean) => void;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  saveItem: (item: RatedItem) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
};

const StoreContext = createContext<Store | null>(null);

function useStore() {
  const context = useContext(StoreContext);
  if (!context) throw new Error('Store is missing');
  return context;
}

function StoreProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<RatedItem[]>(supabase ? [] : readItems);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [error, setError] = useState<string>();
  const [user, setUser] = useState<User | null>(null);
  const [admin, setAdminState] = useState(localStorage.getItem(authKey) === '1');

  const persist = (next: RatedItem[]) => {
    setItems(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  };

  const loadItems = async () => {
    if (!supabase) return;
    setLoading(true);
    setError(undefined);
    const { data, error } = await supabase
      .from('rated_items')
      .select('*, track_scores(*), media_links(*)')
      .order('updated_at', { ascending: false });

    if (error) {
      setError(error.message);
    } else {
      setItems((data ?? []).map(fromDbItem));
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    const { data } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase) return;
    loadItems();
  }, [user]);

  useEffect(() => {
    if (!supabase) return;
    if (!user) {
      setAdminState(false);
      return;
    }

    supabase
      .from('admin_users')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => setAdminState(Boolean(data)));
  }, [user]);

  const value = useMemo<Store>(() => ({
    items,
    loading,
    error,
    admin,
    user,
    setAdmin(value) {
      setAdminState(value);
      localStorage.setItem(authKey, value ? '1' : '0');
    },
    async signIn(email, password) {
      if (!supabase) {
        setAdminState(true);
        localStorage.setItem(authKey, '1');
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async signOut() {
      if (supabase) await supabase.auth.signOut();
      setUser(null);
      setAdminState(false);
      localStorage.setItem(authKey, '0');
    },
    async saveItem(item) {
      const normalized = {
        ...item,
        finalScore: item.scoreMode === 'auto' ? averageScore(item.tracks) : Number(item.finalScore || 0),
        updatedAt: new Date().toISOString(),
      };

      if (!supabase) {
        persist(items.some((existing) => existing.id === item.id)
          ? items.map((existing) => (existing.id === item.id ? normalized : existing))
          : [normalized, ...items]);
        return;
      }

      const { error: itemError } = await supabase.from('rated_items').upsert(toDbItem(normalized));
      if (itemError) {
        const metadataMissing = itemError.message.toLowerCase().includes('metadata');
        if (metadataMissing && normalized.type === 'battle') {
          throw new Error('Для сохранения баттла с раундами нужна миграция metadata. Выполни общий SQL перед сохранением баттлов.');
        }
        if (metadataMissing) {
          const { metadata: _metadata, ...withoutMetadata } = toDbItem(normalized);
          const { error: fallbackError } = await supabase.from('rated_items').upsert(withoutMetadata);
          if (fallbackError) throw fallbackError;
        } else {
          throw itemError;
        }
      }

      const { error: tracksDeleteError } = await supabase.from('track_scores').delete().eq('item_id', normalized.id);
      if (tracksDeleteError) throw tracksDeleteError;
      if (normalized.tracks.length) {
        const { error: tracksError } = await supabase.from('track_scores').insert(normalized.tracks.map((track, index) => ({
          item_id: normalized.id,
          position: index + 1,
          title: track.title,
          score: track.score === '' ? null : Number(track.score),
          cover_url: track.coverUrl || null,
        })));
        if (tracksError) throw tracksError;
      }

      const { error: linksDeleteError } = await supabase.from('media_links').delete().eq('item_id', normalized.id);
      if (linksDeleteError) throw linksDeleteError;
      if (normalized.links.length) {
        const { error: linksError } = await supabase.from('media_links').insert(normalized.links.map((link, index) => ({
          item_id: normalized.id,
          kind: link.kind,
          platform: link.platform,
          url: link.url,
          label: link.label || null,
          starts_at: link.startsAt || null,
          position: index,
        })));
        if (linksError) throw linksError;
      }

      await loadItems();
    },
    async deleteItem(id) {
      if (!supabase) {
        persist(items.filter((item) => item.id !== id));
        return;
      }
      const { error } = await supabase.from('rated_items').delete().eq('id', id);
      if (error) throw error;
      await loadItems();
    },
  }), [admin, error, items, loading, user]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

function App() {
  return (
    <BrowserRouter basename="/album-rater">
      <StoreProvider>
        <Shell />
      </StoreProvider>
    </BrowserRouter>
  );
}

function Shell() {
  const { admin, signOut } = useStore();
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand"><Library size={22} /> R1fрейтинг</Link>
        <nav>
          <Link to="/">Каталог</Link>
          <Link to="/admin">Админка</Link>
          {admin && <button className="ghost" onClick={() => signOut()}><LogOut size={16} /> Выйти</button>}
        </nav>
      </header>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/item/:slug" element={<ItemPage />} />
        <Route path="/admin/login" element={<LoginPage />} />
        <Route path="/admin" element={<AdminRoute><AdminPage /></AdminRoute>} />
        <Route path="/admin/new" element={<AdminRoute><TypePickerPage /></AdminRoute>} />
        <Route path="/admin/new/:type" element={<AdminRoute><EditorPage /></AdminRoute>} />
        <Route path="/admin/edit/:id" element={<AdminRoute><EditorPage /></AdminRoute>} />
      </Routes>
    </>
  );
}

function HomePage() {
  const { items, loading, error } = useStore();
  const [query, setQuery] = useState('');
  const [activeType, setActiveType] = useState<ItemType>('album');
  const [sort, setSort] = useState<'new' | 'best' | 'worst'>('best');
  const published = items.filter((item) => item.published);
  const filtered = published.filter((item) => `${item.title} ${item.artist} ${item.participants} ${item.genre}`.toLowerCase().includes(query.toLowerCase()));
  const sortItems = (list: RatedItem[]) => [...list].sort((a, b) => (
    sort === 'new' ? b.updatedAt.localeCompare(a.updatedAt) : sort === 'best' ? b.finalScore - a.finalScore : a.finalScore - b.finalScore
  ));
  const albums = sortItems(filtered.filter((item) => item.type === 'album'));
  const battles = sortItems(filtered.filter((item) => item.type === 'battle'));
  const tracks = sortItems(filtered.filter((item) => item.type === 'track'));
  const activeItems = activeType === 'album' ? albums : activeType === 'battle' ? battles : tracks;
  const activeTitle = activeType === 'album' ? 'Альбомы' : activeType === 'battle' ? 'Баттлы' : 'Треки';
  const activeEmpty = activeType === 'album' ? 'Опубликованных альбомов пока нет.' : activeType === 'battle' ? 'Опубликованных баттлов пока нет.' : 'Опубликованных треков пока нет.';

  return (
    <main>
      <section className="hero">
        <div>
          <p className="eyebrow">Оценки Рифмабеса</p>
          <h1>R1fрейтинг</h1>
          <p>Альбомы, треки, баттлы, рецензии и ссылки на реакции в одном месте.</p>
          <div className="hero-actions">
            <Link className="button" to="/admin/new"><Plus size={16} /> Начать оценку</Link>
          </div>
        </div>
        <div className="stat"><strong>{published.length}</strong><span>опубликовано</span></div>
      </section>

      <section className="filters">
        <label><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по артисту, названию или жанру" /></label>
        <select value={sort} onChange={(event) => setSort(event.target.value as 'new' | 'best' | 'worst')}>
          <option value="best">Лучшие</option>
          <option value="worst">Спорные</option>
          <option value="new">Новые</option>
        </select>
      </section>

      <section className="catalog-tabs" aria-label="Раздел каталога">
        <button className={activeType === 'album' ? 'active' : ''} onClick={() => setActiveType('album')}>Альбомы <span>{albums.length}</span></button>
        <button className={activeType === 'battle' ? 'active' : ''} onClick={() => setActiveType('battle')}>Баттлы <span>{battles.length}</span></button>
        <button className={activeType === 'track' ? 'active' : ''} onClick={() => setActiveType('track')}>Треки <span>{tracks.length}</span></button>
      </section>

      {loading && <div className="empty">Загружаем каталог из Supabase...</div>}
      {error && <div className="empty">Ошибка загрузки: {error}</div>}
      {!loading && !error && !filtered.length && <div className="empty">Пока нет опубликованных записей по этому поиску.</div>}
      {!loading && !error && Boolean(filtered.length) && <RankingSection title={activeTitle} items={activeItems} empty={activeEmpty} />}
    </main>
  );
}

function RankingSection({ title, items, empty }: { title: string; items: RatedItem[]; empty: string }) {
  return (
    <section className="ranking-section">
      <div className="section-head">
        <h2>{title}</h2>
        <span>{items.length}</span>
      </div>
      {items.length ? (
        <div className="grid">
          {items.map((item) => <ItemCard key={item.id} item={item} />)}
        </div>
      ) : (
        <div className="empty">{empty}</div>
      )}
    </section>
  );
}

function ItemCard({ item }: { item: RatedItem }) {
  return (
    <Link to={`/item/${item.slug}`} className="item-card">
      <div className="cover-wrap">
        {item.coverUrl ? <img src={item.coverUrl} alt="" /> : <div className="cover-placeholder"><Star /></div>}
        <span className={scoreClass(item.finalScore)}>{item.finalScore.toFixed(1)}</span>
      </div>
      <p>{itemCredit(item)}</p>
      {item.type === 'battle' && <span className="winner-line">Победитель: {battleWinnerLabel(item.metadata?.battle)}</span>}
      <h2>{item.title}</h2>
      <span>{item.releaseYear || 'Без года'} · {item.genre || 'Без жанра'}</span>
    </Link>
  );
}

function ItemPage() {
  const { slug } = useParams();
  const item = useStore().items.find((entry) => entry.slug === slug);
  if (!item || !item.published) return <main><div className="empty">Запись не найдена или ещё не опубликована.</div></main>;
  const originals = item.links.filter((link) => link.kind === 'original');
  const reactions = item.links.filter((link) => link.kind === 'reaction');
  const battle = item.metadata?.battle;

  return (
    <main>
      <section className="detail-hero">
        <div className="detail-cover">{item.coverUrl ? <img src={item.coverUrl} alt="" /> : <Star />}</div>
        <div>
          <p className="eyebrow">{itemCredit(item)}</p>
          <h1>{item.title}</h1>
          <p>{item.releaseYear || 'Без года'} · {item.genre || 'Без жанра'}</p>
          <span className={scoreClass(item.finalScore)}>{item.finalScore.toFixed(1)}</span>
          {item.description && <p className="lead">{item.description}</p>}
        </div>
      </section>
      <section className="columns">
        <div className="panel">
          {item.type === 'battle' ? (
            <>
              <h2>Раунды</h2>
              <p className="muted">Победитель: {battleWinnerLabel(battle)}</p>
              {(battle?.rounds ?? []).map((round) => (
                <div className="battle-round-view" key={round.id}>
                  <b>Раунд {round.position}</b>
                  <span>{battle?.sideA || 'A'}: {round.scoreA || '-'} · {battle?.sideB || 'B'}: {round.scoreB || '-'}</span>
                  <span>Раунд: {round.winner === 'a' ? battle?.sideA || 'A' : round.winner === 'b' ? battle?.sideB || 'B' : 'ничья / спорно'}</span>
                  {round.comment && <p>{round.comment}</p>}
                </div>
              ))}
              {!battle?.rounds?.length && <p className="muted">Раунды пока не добавлены.</p>}
            </>
          ) : item.type === 'album' ? (
            <>
              <h2>Треклист</h2>
              {item.tracks.map((track) => <div className="track" key={track.id}><span>{track.position}. {track.title}</span><b>{track.score || '-'}</b></div>)}
            </>
          ) : (
            <>
              <h2>Оценка трека</h2>
              <p className="muted">Отдельный трек без треклиста.</p>
            </>
          )}
        </div>
        <div className="panel">
          <h2>Ссылки</h2>
          <LinkGroup title="Послушать" icon={<Headphones size={18} />} links={originals} />
          <LinkGroup title="Реакция" icon={<Video size={18} />} links={reactions} />
        </div>
      </section>
      <section className="panel markdown">
        <h2>Рецензия</h2>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.review || 'Рецензия пока не добавлена.'}</ReactMarkdown>
      </section>
    </main>
  );
}

function LinkGroup({ title, icon, links }: { title: string; icon: React.ReactNode; links: MediaLink[] }) {
  return (
    <div className="link-group">
      <h3>{icon}{title}</h3>
      {links.map((link) => <a key={link.id} href={link.url} target="_blank" rel="noreferrer">{link.platform}{link.label ? ` · ${link.label}` : ''}{link.startsAt ? ` · ${link.startsAt}` : ''}<ExternalLink size={14} /></a>)}
      {!links.length && <p className="muted">Нет ссылок.</p>}
    </div>
  );
}

function LoginPage() {
  const { signIn } = useStore();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  return (
    <main className="auth">
      <form className="panel" onSubmit={async (event) => {
        event.preventDefault();
        setError('');
        try {
          await signIn(email, password);
          navigate('/admin');
        } catch (error) {
          setError(error instanceof Error ? error.message : 'Не удалось войти');
        }
      }}>
        <Lock size={28} />
        <h1>Вход в админку</h1>
        <p>{hasSupabaseEnv ? 'Вход через Supabase Auth.' : 'Демо-режим: введите любой email и пароль, чтобы проверить интерфейс.'}</p>
        {error && <p className="form-error">{error}</p>}
        <input type="email" required placeholder="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        <input type="password" required placeholder="пароль" value={password} onChange={(event) => setPassword(event.target.value)} />
        <button><Lock size={16} /> Войти</button>
      </form>
    </main>
  );
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  return useStore().admin ? <>{children}</> : <Navigate to="/admin/login" replace />;
}

function AdminPage() {
  const { items, deleteItem, loading, error } = useStore();
  const [activeType, setActiveType] = useState<ItemType>('album');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'new' | 'best' | 'worst'>('new');
  const typeItems = items.filter((item) => item.type === activeType);
  const filteredItems = typeItems
    .filter((item) => `${item.title} ${item.artist} ${item.participants} ${item.genre}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => sort === 'new' ? b.updatedAt.localeCompare(a.updatedAt) : sort === 'best' ? b.finalScore - a.finalScore : a.finalScore - b.finalScore);
  const counts = {
    album: items.filter((item) => item.type === 'album').length,
    battle: items.filter((item) => item.type === 'battle').length,
    track: items.filter((item) => item.type === 'track').length,
  };
  const handleDelete = async (item: RatedItem) => {
    const confirmed = window.confirm(`Удалить "${item.title}"? Треки и ссылки тоже удалятся.`);
    if (!confirmed) return;
    await deleteItem(item.id);
  };

  return (
    <main>
      <section className="admin-head">
        <div>
          <p className="eyebrow">Управление каталогом</p>
          <h1>Админка</h1>
        </div>
        <Link className="button" to="/admin/new"><Plus size={16} /> Начать оценку</Link>
      </section>
      <section className="filters">
        <label><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по названию, артисту или жанру" /></label>
        <select value={sort} onChange={(event) => setSort(event.target.value as 'new' | 'best' | 'worst')}>
          <option value="new">Новые</option>
          <option value="best">Лучшие</option>
          <option value="worst">Спорные</option>
        </select>
      </section>
      <section className="catalog-tabs" aria-label="Раздел админки">
        <button className={activeType === 'album' ? 'active' : ''} onClick={() => setActiveType('album')}>Альбомы <span>{counts.album}</span></button>
        <button className={activeType === 'battle' ? 'active' : ''} onClick={() => setActiveType('battle')}>Баттлы <span>{counts.battle}</span></button>
        <button className={activeType === 'track' ? 'active' : ''} onClick={() => setActiveType('track')}>Треки <span>{counts.track}</span></button>
      </section>
      <section className="panel table">
        {loading && <div className="empty">Загружаем записи...</div>}
        {error && <div className="empty">Ошибка загрузки: {error}</div>}
        {!loading && !error && !filteredItems.length && <div className="empty">В этом разделе записей пока нет.</div>}
        {filteredItems.map((item) => (
          <div className="admin-row" key={item.id}>
            <img src={item.coverUrl || ''} alt="" />
            <div className="admin-row-main"><b>{item.title}</b><span>{itemAdminMeta(item)}</span></div>
            <div className="admin-actions">
              <Link className="ghost" to={`/admin/edit/${item.id}`}><Edit3 size={16} /> Редактировать</Link>
              <button className="danger" onClick={() => handleDelete(item)}><Trash2 size={16} /> Удалить</button>
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}

function TypePickerPage() {
  const options: Array<{ type: ItemType; title: string; text: string }> = [
    { type: 'album', title: 'Альбом', text: 'Треклист, оценки треков, автоматическая итоговая оценка.' },
    { type: 'battle', title: 'Баттл', text: 'Участники, раунды или треки, итоговая оценка и ссылки на реакцию.' },
    { type: 'track', title: 'Отдельный трек', text: 'Один трек, артист, оценка вручную, ссылки и короткая рецензия.' },
  ];

  return (
    <main>
      <section className="admin-head">
        <div>
          <p className="eyebrow">Новая оценка</p>
          <h1>Что оцениваем?</h1>
        </div>
      </section>
      <section className="type-grid">
        {options.map((option) => (
          <Link className="type-card" to={`/admin/new/${option.type}`} key={option.type}>
            <span>{option.title}</span>
            <p>{option.text}</p>
          </Link>
        ))}
      </section>
    </main>
  );
}

function EditorPage() {
  const { id } = useParams();
  const { type } = useParams();
  const { items, saveItem } = useStore();
  const navigate = useNavigate();
  const existing = items.find((item) => item.id === id);
  const newItemType: ItemType = type === 'battle' || type === 'track' ? type : 'album';
  const [draft, setDraft] = useState<RatedItem>(existing ?? {
    id: crypto.randomUUID(),
    type: newItemType,
    slug: '',
    title: '',
    finalScore: 0,
    scoreMode: newItemType === 'album' ? 'auto' : 'manual',
    published: false,
    tracks: [],
    links: [],
    genre: newItemType === 'battle' ? battleGenre : undefined,
    metadata: newItemType === 'battle' ? { battle: createDefaultBattle() } : undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const [trackText, setTrackText] = useState('');
  const [yandexUrl, setYandexUrl] = useState('');
  const [importStatus, setImportStatus] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [youtubeImportStatus, setYoutubeImportStatus] = useState('');
  const [isYoutubeImporting, setIsYoutubeImporting] = useState(false);

  const patch = (value: Partial<RatedItem>) => setDraft((current) => ({ ...current, ...value }));
  const addLink = (kind: LinkKind) => patch({ links: [...draft.links, { id: crypto.randomUUID(), kind, platform: '', url: '' }] });
  const addTrack = () => patch({ tracks: normalizeTrackPositions([...draft.tracks, { id: crypto.randomUUID(), position: draft.tracks.length + 1, title: '', score: '' }]) });
  const removeTrack = (index: number) => patch({ tracks: normalizeTrackPositions(draft.tracks.filter((_, i) => i !== index)) });
  const moveTrack = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= draft.tracks.length) return;
    const next = [...draft.tracks];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    patch({ tracks: normalizeTrackPositions(next) });
  };
  const updateTrack = (index: number, value: Partial<TrackScore>) => patch({ tracks: normalizeTrackPositions(draft.tracks.map((track, i) => i === index ? { ...track, ...value } : track)) });
  const updateLink = (index: number, value: Partial<MediaLink>) => patch({ links: draft.links.map((link, i) => i === index ? { ...link, ...value } : link) });
  const removeLink = (index: number) => patch({ links: draft.links.filter((_, i) => i !== index) });
  const albumScore = draft.scoreMode === 'auto' ? averageScore(draft.tracks) : Number(draft.finalScore || 0);
  const isTrackItem = draft.type === 'track';
  const isBattleItem = draft.type === 'battle';
  const scoreTitle = isTrackItem ? 'Оценка трека' : isBattleItem ? 'Оценка баттла' : 'Итоговая оценка';
  const battle = draft.metadata?.battle ?? createDefaultBattle();
  const updateBattle = (value: Partial<BattleMetadata>) => {
    const nextBattle = { ...battle, ...value };
    patch({
      participants: `${nextBattle.sideA || 'Сторона A'} vs ${nextBattle.sideB || 'Сторона B'}`,
      metadata: { ...draft.metadata, battle: nextBattle },
    });
  };
  const updateBattleRound = (index: number, value: Partial<BattleRound>) => {
    updateBattle({
      rounds: normalizeBattleRounds(battle.rounds.map((round, i) => i === index ? { ...round, ...value } : round)),
    });
  };
  const addBattleRound = () => updateBattle({ rounds: normalizeBattleRounds([...battle.rounds, createBattleRound(battle.rounds.length + 1)]) });
  const removeBattleRound = (index: number) => updateBattle({ rounds: normalizeBattleRounds(battle.rounds.filter((_, i) => i !== index)) });
  const handleTypeChange = (nextType: ItemType) => {
    const wasBattle = draft.type === 'battle';
    const becomesBattle = nextType === 'battle';
    let nextGenre = draft.genre;
    if (becomesBattle) nextGenre = battleGenre;
    else if (wasBattle && draft.genre === battleGenre) nextGenre = undefined;
    patch({
      type: nextType,
      scoreMode: nextType === 'album' ? 'auto' : 'manual',
      tracks: nextType === 'album' ? draft.tracks : [],
      genre: nextGenre,
      metadata: becomesBattle ? { ...draft.metadata, battle: draft.metadata?.battle ?? createDefaultBattle() } : undefined,
    });
  };
  const importFromYandex = async () => {
    setImportStatus('');
    setIsImporting(true);

    try {
      const proxyBase = import.meta.env.VITE_YANDEX_PROXY_URL || '/api';
      const response = await fetch(`${proxyBase}/yandex-music/import?url=${encodeURIComponent(yandexUrl)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось импортировать Яндекс.Музыку');

      const imported = data as YandexImportResult;
      const isSingleTrack = imported.tracks.length <= 1;
      const importedType: ItemType = isSingleTrack ? 'track' : 'album';
      const importedTracks = imported.tracks.map((track, index) => ({
        id: crypto.randomUUID(),
        position: index + 1,
        title: track.title,
        score: '' as const,
      }));

      patch({
        type: importedType,
        title: imported.title || draft.title,
        artist: imported.artist || draft.artist,
        releaseYear: imported.year,
        genre: imported.genre || draft.genre,
        coverUrl: imported.coverUrl || draft.coverUrl,
        scoreMode: importedType === 'track' ? 'manual' : 'auto',
        tracks: importedType === 'album' ? importedTracks : [],
        links: [
          ...draft.links,
          {
            id: crypto.randomUUID(),
            kind: 'original',
            platform: 'Яндекс.Музыка',
            url: imported.sourceUrl,
            label: imported.tracks.length <= 1 ? 'Трек' : 'Альбом',
          },
        ],
        metadata: {
          ...draft.metadata,
          yandex: { albumId: imported.albumId, trackId: imported.trackId, sourceUrl: imported.sourceUrl },
        },
      });
      setTrackText(imported.tracks.map((track) => track.title).join('\n'));
      setImportStatus(`Импортировано: ${imported.title}. Треков: ${imported.tracks.length}.`);
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : 'Ошибка импорта');
    } finally {
      setIsImporting(false);
    }
  };

  const importFromYoutube = async () => {
    setYoutubeImportStatus('');
    setIsYoutubeImporting(true);
    try {
      const result = await fetchYoutubeBattle(youtubeUrl);

      let nextSideA = battle.sideA;
      let nextSideB = battle.sideB;
      let nextFormat: BattleFormat | undefined = battle.format;
      let formatHint = '';

      if (result.parsed.format === 'standard') {
        nextSideA = result.parsed.sideA.join(' & ');
        nextSideB = result.parsed.sideB.join(' & ');
        const aSize = result.parsed.sideA.length;
        const bSize = result.parsed.sideB.length;
        const maxSize = Math.max(aSize, bSize);
        nextFormat = maxSize >= 3 ? '3v3' : maxSize === 2 ? '2v2' : '1v1';
      } else if (result.parsed.format === 'deathmatch') {
        nextSideA = result.parsed.participants.join(' & ');
        nextSideB = '';
        nextFormat = 'deathmatch';
        formatHint = ' Это дезматч — поддержка формата ещё в работе, участники собраны в стороне A, поправь руками.';
      } else {
        nextSideA = result.parsed.raw;
        formatHint = ' Не получилось автоматически разобрать формат — заполни стороны вручную.';
      }

      const nextBattle: BattleMetadata = {
        ...battle,
        sideA: nextSideA,
        sideB: nextSideB,
        format: nextFormat,
        stage: result.parsed.stage || battle.stage,
      };

      patch({
        type: 'battle',
        title: draft.title || result.title,
        coverUrl: draft.coverUrl || result.thumbnailUrl,
        participants: `${nextSideA || 'Сторона A'} vs ${nextSideB || 'Сторона B'}`,
        links: [
          ...draft.links,
          {
            id: crypto.randomUUID(),
            kind: 'original',
            platform: 'YouTube',
            url: result.sourceUrl,
            label: result.author || 'Видео',
          },
        ],
        metadata: {
          ...draft.metadata,
          battle: nextBattle,
          youtube: { videoId: result.videoId, sourceUrl: result.sourceUrl },
        },
      });
      setYoutubeImportStatus(`Импортировано: ${result.title}.${formatHint}`);
    } catch (error) {
      setYoutubeImportStatus(error instanceof Error ? error.message : 'Ошибка импорта');
    } finally {
      setIsYoutubeImporting(false);
    }
  };

  const [saveError, setSaveError] = useState('');
  const submitItem = async (published: boolean) => {
    setSaveError('');
    try {
      await saveItem({ ...draft, slug: draft.slug || createItemSlug(draft), finalScore: albumScore, published });
      navigate('/admin');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Не удалось сохранить запись');
    }
  };

  return (
    <main>
      <form className="editor" onSubmit={(event) => { event.preventDefault(); submitItem(true); }}>
        {draft.type !== 'battle' && (
          <section className="panel">
            <h2>Импорт из Яндекс.Музыки</h2>
            <div className="import-row">
              <input value={yandexUrl} onChange={(event) => setYandexUrl(event.target.value)} placeholder="Вставь ссылку Яндекс.Музыки на альбом или трек" />
              <button type="button" disabled={!yandexUrl || isImporting} onClick={importFromYandex}>{isImporting ? 'Импорт...' : 'Импортировать'}</button>
            </div>
            {importStatus && <p className={importStatus.includes('Ошибка') || importStatus.includes('капчу') || importStatus.includes('Не удалось') ? 'form-error' : 'form-note'}>{importStatus}</p>}
          </section>
        )}

        {draft.type === 'battle' && (
          <section className="panel">
            <h2>Импорт с YouTube</h2>
            <div className="import-row">
              <input value={youtubeUrl} onChange={(event) => setYoutubeUrl(event.target.value)} placeholder="Вставь ссылку на YouTube — Кубок МЦ, Versus, и т.п." />
              <button type="button" disabled={!youtubeUrl || isYoutubeImporting} onClick={importFromYoutube}>{isYoutubeImporting ? 'Импорт...' : 'Импортировать'}</button>
            </div>
            {youtubeImportStatus && <p className={youtubeImportStatus.startsWith('Импортировано') ? 'form-note' : 'form-error'}>{youtubeImportStatus}</p>}
          </section>
        )}

        <section className="panel">
          <h1>{existing ? 'Редактирование' : `Оценка: ${itemTypeLabel(draft.type).toLowerCase()}`}</h1>
          {saveError && <p className="form-error">{saveError}</p>}
          <div className="form-grid">
            <select value={draft.type} disabled={Boolean(existing)} onChange={(event) => handleTypeChange(event.target.value as ItemType)}><option value="album">Альбом</option><option value="battle">Баттл</option><option value="track">Трек</option></select>
            <input value={draft.title} onChange={(event) => patch({ title: event.target.value, slug: draft.slug || normalizeSlug(event.target.value) })} placeholder="Название" required />
            {draft.type !== 'battle' && <input value={draft.artist || ''} onChange={(event) => patch({ artist: event.target.value })} placeholder="Артист" />}
            {draft.type === 'battle' && <input value={draft.participants || ''} onChange={(event) => patch({ participants: event.target.value })} placeholder="Участники баттла" />}
            <input value={draft.slug} onChange={(event) => patch({ slug: normalizeSlug(event.target.value) })} placeholder="Короткая ссылка" />
            <input type="number" value={draft.releaseYear || ''} onChange={(event) => patch({ releaseYear: Number(event.target.value) || undefined })} placeholder="Год" />
            {draft.type !== 'battle' && (() => {
              const currentGenre = draft.genre || '';
              const presetGenres = genreOptions.slice(0, -1); // без «Свой»
              const isCustom = currentGenre !== '' && !presetGenres.includes(currentGenre);
              const selectorValue = currentGenre === '' ? '' : (isCustom ? 'Свой' : currentGenre);
              return (
                <>
                  <select
                    value={selectorValue}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === 'Свой') patch({ genre: isCustom ? currentGenre : ' ' });
                      else patch({ genre: value });
                    }}
                  >
                    <option value="">Жанр…</option>
                    {genreOptions.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                  {selectorValue === 'Свой' && (
                    <input
                      value={isCustom ? currentGenre : ''}
                      onChange={(event) => patch({ genre: event.target.value })}
                      placeholder="Свой жанр"
                    />
                  )}
                </>
              );
            })()}
            {draft.type === 'battle' && (
              <>
                <select
                  value={battle.format || '1v1'}
                  onChange={(event) => updateBattle({ format: event.target.value as BattleFormat })}
                >
                  {battleFormatOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
                <select
                  value={battle.style || ''}
                  onChange={(event) => updateBattle({ style: (event.target.value || undefined) as BattleStyle | undefined })}
                >
                  <option value="">Стиль…</option>
                  {battleStyleOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
                <input
                  value={battle.stage || ''}
                  onChange={(event) => updateBattle({ stage: event.target.value })}
                  placeholder="Стадия (1/4, Финал, Fresh Blood, Титульный…)"
                />
              </>
            )}
            <input value={draft.coverUrl || ''} onChange={(event) => patch({ coverUrl: event.target.value })} placeholder="URL обложки" />
          </div>
          <textarea value={draft.description || ''} onChange={(event) => patch({ description: event.target.value })} placeholder="Короткое описание" />
        </section>

        {draft.type === 'album' && <section className="panel">
          <h2>Треки</h2>
          <textarea value={trackText} onChange={(event) => setTrackText(event.target.value)} placeholder="Вставьте треклист: один трек на строку" />
          <div className="track-actions">
            <button type="button" onClick={() => patch({ tracks: normalizeTrackPositions(parseTrackList(trackText)) })}>Создать треки из списка</button>
            <button type="button" className="ghost" onClick={addTrack}><Plus size={16} /> Добавить трек</button>
          </div>
          {draft.tracks.map((track, index) => (
            <div className="track-edit" key={track.id}>
              <span>{index + 1}</span>
              <input value={track.title} onChange={(event) => updateTrack(index, { title: event.target.value })} />
              <input type="number" min="0" max="10" step="0.1" value={track.score} onChange={(event) => updateTrack(index, { score: event.target.value === '' ? '' : Number(event.target.value) })} />
              <div className="track-row-actions">
                <button type="button" className="ghost icon-btn" disabled={index === 0} onClick={() => moveTrack(index, -1)} title="Поднять трек"><ArrowUp size={16} /></button>
                <button type="button" className="ghost icon-btn" disabled={index === draft.tracks.length - 1} onClick={() => moveTrack(index, 1)} title="Опустить трек"><ArrowDown size={16} /></button>
                <button type="button" className="danger icon-btn" onClick={() => removeTrack(index)} title="Удалить трек"><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
        </section>}

        {isBattleItem && <section className="panel">
          <h2>Раунды баттла</h2>
          <div className="battle-sides">
            <input value={battle.sideA} onChange={(event) => updateBattle({ sideA: event.target.value })} placeholder="Участник или команда A" />
            <input value={battle.sideB} onChange={(event) => updateBattle({ sideB: event.target.value })} placeholder="Участник или команда B" />
          </div>
          {battle.rounds.map((round, index) => (
            <div className="battle-round" key={round.id}>
              <strong>Раунд {index + 1}</strong>
              <input type="number" min="0" max="10" step="0.1" value={round.scoreA} onChange={(event) => updateBattleRound(index, { scoreA: event.target.value === '' ? '' : Number(event.target.value) })} placeholder={`Очки: ${battle.sideA || 'A'}`} />
              <input type="number" min="0" max="10" step="0.1" value={round.scoreB} onChange={(event) => updateBattleRound(index, { scoreB: event.target.value === '' ? '' : Number(event.target.value) })} placeholder={`Очки: ${battle.sideB || 'B'}`} />
              <select value={round.winner} onChange={(event) => updateBattleRound(index, { winner: event.target.value as BattleSideKey })}>
                <option value="draw">Ничья / спорно</option>
                <option value="a">Раунд за {battle.sideA || 'A'}</option>
                <option value="b">Раунд за {battle.sideB || 'B'}</option>
              </select>
              <input value={round.comment || ''} onChange={(event) => updateBattleRound(index, { comment: event.target.value })} placeholder="Комментарий к раунду" />
              <button type="button" className="danger icon-btn" onClick={() => removeBattleRound(index)} title="Удалить раунд"><Trash2 size={16} /></button>
            </div>
          ))}
          <div className="track-actions">
            <button type="button" className="ghost" onClick={addBattleRound}><Plus size={16} /> Добавить раунд</button>
          </div>
          <div className="battle-winner">
            <span className="muted">Итоговый победитель</span>
            <select value={battle.finalWinner} onChange={(event) => updateBattle({ finalWinner: event.target.value as BattleSideKey })}>
              <option value="draw">Ничья / спорно</option>
              <option value="a">{battle.sideA || 'Сторона A'}</option>
              <option value="b">{battle.sideB || 'Сторона B'}</option>
            </select>
            <p>Сейчас победитель выбирается вручную. Позже можно добавить автоподсчёт по раундам.</p>
          </div>
        </section>}

        <section className="panel">
          <h2>Итог и рецензия</h2>
          <div className="score-editor">
            <div>
              <span className="muted">{scoreTitle}</span>
              <strong className={scoreClass(albumScore)}>{albumScore.toFixed(1)}</strong>
              <p>{draft.scoreMode === 'auto' ? 'Считается автоматически как среднее по оценённым трекам.' : 'Задаётся вручную.'}</p>
            </div>
            <div>
              <select value={draft.scoreMode} disabled={isTrackItem || isBattleItem} onChange={(event) => patch({ scoreMode: event.target.value as ScoreMode })}><option value="auto">Среднее по трекам</option><option value="manual">Вручную</option></select>
              <input type="number" min="0" max="10" step="0.1" value={albumScore} disabled={draft.scoreMode === 'auto'} onChange={(event) => patch({ finalScore: Number(event.target.value) })} />
            </div>
          </div>
          <textarea className="review-input" value={draft.review || ''} onChange={(event) => patch({ review: event.target.value })} placeholder="Markdown-рецензия" />
        </section>

        <section className="panel">
          <h2>Ссылки</h2>
          <div className="track-actions">
            <button type="button" onClick={() => addLink('original')}>Добавить ссылку на оригинал</button>
            <button type="button" onClick={() => addLink('reaction')}>Добавить ссылку на реакцию</button>
          </div>
          {draft.links.map((link, index) => (
            <div className="link-edit" key={link.id}>
              <select value={link.kind} onChange={(event) => updateLink(index, { kind: event.target.value as LinkKind })}><option value="original">Оригинал</option><option value="reaction">Реакция</option></select>
              <input list={link.kind === 'original' ? 'original-platforms' : 'reaction-platforms'} value={link.platform} onChange={(event) => updateLink(index, { platform: event.target.value })} placeholder={link.kind === 'original' ? 'Площадка: Яндекс.Музыка, Spotify...' : 'Площадка: YouTube, Boosty...'} />
              <input value={link.url} onChange={(event) => updateLink(index, { url: event.target.value })} placeholder="Ссылка" />
              <input value={link.startsAt || ''} onChange={(event) => updateLink(index, { startsAt: event.target.value })} placeholder="Таймкод, если нужен" />
              <button type="button" className="danger icon-btn" onClick={() => removeLink(index)} title="Удалить ссылку"><Trash2 size={16} /></button>
            </div>
          ))}
          <datalist id="original-platforms">
            {originalPlatforms.map((platform) => <option value={platform} key={platform} />)}
          </datalist>
          <datalist id="reaction-platforms">
            {reactionPlatforms.map((platform) => <option value={platform} key={platform} />)}
          </datalist>
        </section>

        <section className="publish-bar">
          <label><input type="checkbox" checked={draft.published} onChange={(event) => patch({ published: event.target.checked })} /> Опубликовано</label>
          <div className="publish-actions">
            <button type="button" className="ghost" onClick={() => submitItem(false)}><Save size={16} /> Сохранить черновик</button>
            <button><Save size={16} /> Сохранить и опубликовать</button>
          </div>
        </section>
      </form>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
