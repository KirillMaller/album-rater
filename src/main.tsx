import React, { createContext, forwardRef, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import ReactMarkdown from 'react-markdown';

const safeMarkdownUrl = (url: string) => {
  const trimmed = url.trim().toLowerCase();
  if (trimmed.startsWith('javascript:') || trimmed.startsWith('data:') || trimmed.startsWith('vbscript:')) return '';
  return url;
};
import remarkGfm from 'remark-gfm';
import privacyMarkdown from '../docs/PRIVACY.md?raw';
import termsMarkdown from '../docs/USER_AGREEMENT.md?raw';
import { createClient, type User } from '@supabase/supabase-js';
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Disc3,
  Edit3,
  ExternalLink,
  Headphones,
  Library,
  LayoutGrid,
  List,
  Lock,
  LogOut,
  Music,
  Plus,
  RefreshCw,
  RotateCw,
  Save,
  Search,
  Star,
  Swords,
  Trash2,
  Trophy,
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
type ScoreValue = number | '' | '-';

type AuctionCategory = 'album' | 'series' | 'film' | 'anime' | 'game' | 'battle';

type AuctionItem = {
  id: string;
  category: AuctionCategory;
  title: string;
  artist?: string;
  amount: number;
  note?: string;
  createdAt: string;
  updatedAt: string;
};

type AuctionRules = {
  scope: string;
  content: string;
  updatedAt: string;
};

const auctionCategoryLabel: Record<AuctionCategory, string> = {
  album: 'Альбомы',
  series: 'Сериалы',
  film: 'Фильмы',
  anime: 'Аниме',
  game: 'Игры',
  battle: 'Баттлы',
};

const auctionCategoryOrder: AuctionCategory[] = ['album', 'series', 'film', 'anime', 'game', 'battle'];

const auctionCategoryHasArtist: Record<AuctionCategory, boolean> = {
  album: true,
  battle: true,
  series: false,
  film: false,
  anime: false,
  game: false,
};

// Колесо аукциона — розыгрыш следующей позиции, шанс пропорционален собранной сумме.
type WheelSessionStatus = 'draft' | 'locked' | 'finished' | 'cancelled';
type WheelParticipantStatus = 'active' | 'eliminated' | 'winner';

type WheelSession = {
  id: string;
  category: AuctionCategory;
  status: WheelSessionStatus;
  currentRound: number;
  winnerParticipantId?: string;
  settings: Record<string, unknown>;
  createdBy?: string;
  createdAt: string;
  lockedAt?: string;
  finishedAt?: string;
};

type WheelParticipant = {
  id: string;
  sessionId: string;
  auctionItemId: string;
  title: string;
  artist?: string;
  amount: number;
  rank?: number;
  status: WheelParticipantStatus;
  eliminatedAtRound?: number;
  createdAt: string;
};

type WheelRound = {
  id: string;
  sessionId: string;
  revealOrder: number;
  participantId: string;
  revealed: boolean;
  revealedAt?: string;
  createdAt: string;
};

type AuctionAmountLogEntry = {
  id: string;
  auctionItemId: string;
  adminId?: string;
  delta: number;
  amountBefore: number;
  amountAfter: number;
  note?: string;
  createdAt: string;
};

function monthsSince(value: string) {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return 0;
  const diffDays = (Date.now() - time) / (24 * 60 * 60 * 1000);
  return Math.floor(diffDays / 30);
}

function formatMSK(value: string | Date, options: Intl.DateTimeFormatOptions = { dateStyle: 'short', timeStyle: 'short' }) {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', ...options });
}

function formatMSKTime(value: string | Date) {
  return formatMSK(value, { hour: '2-digit', minute: '2-digit' });
}

function todayInMoscow() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
}

function parseScoreInput(text: string, allowExclude = false): ScoreValue {
  const cleaned = text.replace(',', '.').trim();
  if (cleaned === '') return '';
  if (allowExclude && cleaned === '-') return '-';
  const num = Number.parseFloat(cleaned);
  if (Number.isNaN(num)) return '';
  if (num < 0) return 0;
  if (num > 11) return 11;
  return Math.round(num * 10) / 10;
}

function formatScoreValue(value: ScoreValue) {
  return value === '' ? '' : String(value).replace('.', ',');
}

function numericScoreValue(value: ScoreValue): number | '' {
  return value === '-' ? '' : value;
}

function ScoreInput({ value, onChange, disabled, placeholder, allowExclude }: {
  value: ScoreValue;
  onChange: (next: ScoreValue) => void;
  disabled?: boolean;
  placeholder?: string;
  allowExclude?: boolean;
}) {
  const [text, setText] = useState<string>(formatScoreValue(value));
  useEffect(() => {
    const current = parseScoreInput(text, allowExclude);
    if (current !== value) {
      setText(formatScoreValue(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, allowExclude]);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => {
        const raw = event.target.value;
        setText(raw);
        onChange(parseScoreInput(raw, allowExclude));
      }}
      onWheel={(event) => (event.currentTarget as HTMLInputElement).blur()}
    />
  );
}

function formatMSKDate(value: string) {
  if (!value) return '';
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return value;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' });
}

function auctionStaleLevel(item: AuctionItem): 'fresh' | 'warning' | 'danger' {
  if (item.amount > 500) return 'fresh';
  const months = monthsSince(item.updatedAt);
  if (months >= 6) return 'danger';
  if (months >= 3) return 'warning';
  return 'fresh';
}

function auctionStaleLabel(item: AuctionItem) {
  const level = auctionStaleLevel(item);
  if (level === 'fresh') return '';
  const months = monthsSince(item.updatedAt);
  if (level === 'danger') return `давно не обновлялся (${months} мес.), можно убрать`;
  return `давно не обновлялся (${months} мес.)`;
}

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
type JudgeWinner = BattleSideKey | 'unjudged';

type BattleMetadata = {
  sideA: string;
  sideB: string;
  rounds: BattleRound[];
  finalWinner: BattleSideKey;
  judgeWinner?: JudgeWinner;
  format?: BattleFormat;
  style?: BattleStyle;
  stage?: string;
  tournament?: string;
  season?: string;
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
  excludedTrackPositions?: number[];
  bestTrackPositions?: number[];
};

type ParsedBattleTitle =
  | { format: 'standard'; sideA: string[]; sideB: string[]; tournament: string; stage: string }
  | { format: 'deathmatch'; participants: string[]; tournament: string; stage: string }
  | { format: 'unknown'; raw: string; tournament: string; stage: string };

type ParsedYoutubeTrackTitle = {
  artist: string;
  title: string;
};

type YoutubeImportResult = {
  videoId: string;
  sourceUrl: string;
  title: string;
  author: string;
  authorUrl: string;
  thumbnailUrl: string;
  parsed: ParsedBattleTitle;
};

type YoutubeTrackImportResult = Omit<YoutubeImportResult, 'parsed'> & {
  parsed: ParsedYoutubeTrackTitle;
};

type TrackScore = {
  id: string;
  position: number;
  title: string;
  score: ScoreValue;
  coverUrl?: string;
  isBest?: boolean;
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
const maxBestAlbumTracks = 3;

const genreOptions = ['Русский рэп', 'Рэп', 'Поп', 'R&B / соул', 'Рок', 'Электроника', 'Инди', 'Метал', 'Экспериментальный', 'Свой'];

const yandexGenreLabels: Record<string, string> = {
  rusrap: 'Русский рэп',
  rap: 'Рэп',
  pop: 'Поп',
  rnb: 'R&B / соул',
  soul: 'R&B / соул',
  rock: 'Рок',
  electronics: 'Электроника',
  electronic: 'Электроника',
  indie: 'Инди',
  metal: 'Метал',
};

function normalizeImportedGenre(genre?: string) {
  if (!genre) return undefined;
  const trimmed = genre.trim();
  return yandexGenreLabels[trimmed.toLowerCase()] || trimmed;
}

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
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
};

const storageKey = 'r1frating-items-v1';
const authKey = 'r1frating-demo-admin';
const editorDraftPrefix = 'r1frating-editor-draft';
const hasSupabaseEnv = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
const supabase = hasSupabaseEnv
  ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
  : null;

type EditorDraftBackup = {
  draft: RatedItem;
  trackText: string;
  yandexUrl: string;
  youtubeUrl: string;
  savedAt: string;
};

function readEditorDraftBackup(key: string): EditorDraftBackup | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as EditorDraftBackup : null;
  } catch {
    return null;
  }
}

function hasMeaningfulEditorDraft(draft: RatedItem, trackText: string, yandexUrl: string, youtubeUrl: string) {
  return Boolean(
    draft.title.trim() ||
    draft.slug.trim() ||
    draft.artist?.trim() ||
    draft.participants?.trim() ||
    draft.coverUrl?.trim() ||
    draft.description?.trim() ||
    draft.review?.trim() ||
    draft.releaseYear ||
    draft.tracks.length ||
    draft.links.length ||
    trackText.trim() ||
    yandexUrl.trim() ||
    youtubeUrl.trim()
  );
}

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

function cleanYoutubeTrackTitlePart(value: string) {
  return value
    .normalize('NFKC')
    .replace(/\s*#[\wА-яёЁ]+/g, '')
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')
    .replace(/\s+(?:vs\.?|против)\s+.+$/i, '')
    .replace(/\s*\((?:премьера\s+клипа|official\s+(?:music\s+)?video|music\s+video|official\s+audio|audio|lyrics?|lyric\s+video|клип|премьера|prod\.?[^)]*)\)\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseYoutubeTrackTitle(title: string, author: string): ParsedYoutubeTrackTitle {
  const cleaned = cleanYoutubeTrackTitlePart(title);
  const separator = cleaned.match(/\s[-–—]\s/);
  if (!separator?.index) {
    return {
      artist: author.trim(),
      title: cleaned || title.trim(),
    };
  }

  const rawArtist = cleaned.slice(0, separator.index).trim();
  const rawTitle = cleaned.slice(separator.index + separator[0].length).trim();
  const artists = rawArtist
    .split(/\s+(?:&|feat\.?|ft\.?|featuring|x|х)\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);

  return {
    artist: artists.length ? artists.join(', ') : (author.trim() || rawArtist),
    title: cleanYoutubeTrackTitlePart(rawTitle) || rawTitle || cleaned,
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
    thumbnailUrl: displayCoverUrl(String(data.thumbnail_url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`)),
    parsed: parseBattleTitle(title, author),
  };
}

async function fetchYoutubeTrack(rawUrl: string): Promise<YoutubeTrackImportResult> {
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
    thumbnailUrl: displayCoverUrl(String(data.thumbnail_url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`)),
    parsed: parseYoutubeTrackTitle(title, author),
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
  const scores = tracks.map((track) => track.score).filter((score): score is number => typeof score === 'number' && Number.isFinite(score));
  if (!scores.length) return 0;
  return Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1));
}

function bestAlbumTracks(item: RatedItem) {
  if (item.type !== 'album') return [];
  return item.tracks.filter((track) => track.isBest).slice(0, maxBestAlbumTracks);
}

function bestAlbumTracksLabel(item: RatedItem) {
  const tracks = bestAlbumTracks(item);
  if (!tracks.length) return '';
  return `Лучшие треки: ${tracks.map((track) => track.title).join(', ')}`;
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

function battleJudgeLabel(battle?: BattleMetadata) {
  if (!battle?.judgeWinner) return 'Не указано';
  if (battle.judgeWinner === 'unjudged') return 'Не судился';
  if (battle.judgeWinner === 'a') return battle.sideA || 'Сторона A';
  if (battle.judgeWinner === 'b') return battle.sideB || 'Сторона B';
  return 'Ничья / спорно';
}

function BattleWinnerSummary({ battle }: { battle?: BattleMetadata }) {
  if (!battle) return null;
  const judge = battle.judgeWinner;
  const rifmaLabel = battleWinnerLabel(battle);
  if (!judge || judge === 'unjudged') {
    return (
      <div className="battle-winner-banner">
        <span className="battle-winner-label">R1Fmabes:</span>
        <span className="battle-winner-name">{rifmaLabel}</span>
        <span className="battle-winner-note">не судился</span>
      </div>
    );
  }
  const judgeLabel = battleJudgeLabel(battle);
  if (judge === battle.finalWinner) {
    return (
      <div className="battle-winner-banner">
        <span className="battle-winner-label">Победитель:</span>
        <span className="battle-winner-name">{judgeLabel}</span>
        <span className="battle-winner-note">— единогласно (судьи и R1Fmabes)</span>
      </div>
    );
  }
  return (
    <div className="battle-winner-banner battle-winner-split">
      <div>
        <span className="battle-winner-label">По судьям:</span>
        <span className="battle-winner-name">{judgeLabel}</span>
      </div>
      <div>
        <span className="battle-winner-label">R1Fmabes:</span>
        <span className="battle-winner-name">{rifmaLabel}</span>
      </div>
    </div>
  );
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

function ItemTypeIcon({ type, size = 11 }: { type: ItemType; size?: number }) {
  if (type === 'album') return <Disc3 size={size} strokeWidth={2.4} />;
  if (type === 'battle') return <Swords size={size} strokeWidth={2.4} />;
  return <Music size={size} strokeWidth={2.4} />;
}

function itemCredit(item: RatedItem) {
  if (item.type === 'battle') {
    const meta = item.metadata?.battle;
    const parts = [meta?.tournament, meta?.season, meta?.stage].filter(Boolean);
    return parts.length ? parts.join(' · ') : (item.participants || 'Баттл');
  }
  return item.artist || 'Артист не указан';
}

function releaseLabel(item: RatedItem) {
  return item.releaseYear ? String(item.releaseYear) : relativeDate(item.createdAt);
}

function cardDateLabel(item: RatedItem) {
  const released = item.releaseYear ? `вышел: ${item.releaseYear}` : 'выход: без даты';
  const reviewed = item.reviewedAt ? `оценён: ${formatMSKDate(item.reviewedAt)}` : `добавлен: ${relativeDate(item.createdAt)}`;
  return `${released} · ${reviewed}`;
}

function scoreClass(score: number) {
  if (score >= 9) return 'score score-top';
  if (score >= 7.5) return 'score score-high';
  if (score >= 6) return 'score score-mid';
  if (score >= 4) return 'score score-low';
  return 'score score-bad';
}

function fromDbItem(row: any): RatedItem {
  const metadata = row.metadata ?? undefined;
  const excludedTrackPositions = new Set<number>(metadata?.excludedTrackPositions ?? []);
  const bestTrackPositions = new Set<number>(metadata?.bestTrackPositions ?? []);
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
        score: excludedTrackPositions.has(track.position) ? '-' : (track.score === null ? '' : Number(track.score)),
        coverUrl: track.cover_url ?? undefined,
        isBest: bestTrackPositions.has(track.position),
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
    metadata,
    reviewedAt: row.reviewed_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toDbItem(item: RatedItem) {
  const excludedTrackPositions = item.tracks
    .filter((track) => track.score === '-')
    .map((track) => track.position);
  const bestTrackPositions = item.type === 'album'
    ? item.tracks
      .filter((track) => track.isBest)
      .slice(0, maxBestAlbumTracks)
      .map((track) => track.position)
    : [];
  const metadata = {
    ...(item.metadata ?? {}),
    excludedTrackPositions,
    bestTrackPositions,
  };

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
    metadata,
    reviewed_at: item.reviewedAt || null,
  };
}

type Store = {
  items: RatedItem[];
  loading: boolean;
  error?: string;
  admin: boolean;
  user: User | null;
  viewerConsentedAt: string | null;
  viewerConsentLoaded: boolean;
  viewerVotesByItem: Map<string, AllVote[]>;
  setAdmin: (value: boolean) => void;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  recordConsent: () => Promise<void>;
  loadMyItemVotes: (itemId: string) => Promise<{ album: number | null; tracks: Map<number, number>; battleRounds: Map<number, BattleSide>; battleFinal: BattleSide | null; bestTracks: Set<number> }>;
  loadItemAllVotes: (itemId: string) => Promise<Array<{ viewerId: string; trackPosition: number | null; roundIndex: number | null; score: number | null; winner: BattleSide | null; isBest: boolean }>>;
  toggleMyBestTrack: (itemId: string, position: number, isBest: boolean) => Promise<void>;
  saveMyAlbumVote: (itemId: string, score: number) => Promise<void>;
  saveMyTrackVote: (itemId: string, position: number, score: number) => Promise<void>;
  saveMyBattleRoundVote: (itemId: string, roundIndex: number, side: BattleSide) => Promise<void>;
  saveMyBattleFinalVote: (itemId: string, side: BattleSide) => Promise<void>;
  clearMyAlbumVote: (itemId: string) => Promise<void>;
  clearMyTrackVotes: (itemId: string) => Promise<void>;
  saveItem: (item: RatedItem) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  auctions: AuctionItem[];
  auctionRules: AuctionRules | null;
  auctionsLoading: boolean;
  auctionsError?: string;
  saveAuction: (item: AuctionItem) => Promise<void>;
  deleteAuction: (id: string) => Promise<void>;
  saveAuctionRules: (content: string) => Promise<void>;
  addAuctionAmount: (itemId: string, delta: number) => Promise<void>;
};

const CONSENT_VERSION = 1;

type BattleSide = 'a' | 'b' | 'draw';

function fromDbAuction(row: any): AuctionItem {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    artist: row.artist ?? undefined,
    amount: Number(row.amount ?? 0),
    note: row.note ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toDbAuction(item: AuctionItem) {
  return {
    id: item.id,
    category: item.category,
    title: item.title,
    artist: item.artist || null,
    amount: item.amount,
    note: item.note || null,
  };
}

function fromDbWheelSession(row: any): WheelSession {
  return {
    id: row.id,
    category: row.category,
    status: row.status,
    currentRound: Number(row.current_round ?? 0),
    winnerParticipantId: row.winner_participant_id ?? undefined,
    settings: row.settings ?? {},
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
    lockedAt: row.locked_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
  };
}

function toDbWheelSession(session: Pick<WheelSession, 'category' | 'status' | 'createdBy'>) {
  return {
    category: session.category,
    status: session.status,
    created_by: session.createdBy ?? null,
  };
}

function fromDbWheelParticipant(row: any): WheelParticipant {
  return {
    id: row.id,
    sessionId: row.session_id,
    auctionItemId: row.auction_item_id,
    title: row.title,
    artist: row.artist ?? undefined,
    amount: Number(row.amount ?? 0),
    rank: row.rank ?? undefined,
    status: row.status,
    eliminatedAtRound: row.eliminated_at_round ?? undefined,
    createdAt: row.created_at,
  };
}

function toDbWheelParticipant(sessionId: string, item: AuctionItem) {
  return {
    session_id: sessionId,
    auction_item_id: item.id,
    title: item.title,
    artist: item.artist || null,
    amount: item.amount,
  };
}

function fromDbWheelRound(row: any): WheelRound {
  return {
    id: row.id,
    sessionId: row.session_id,
    revealOrder: Number(row.reveal_order),
    participantId: row.participant_id,
    revealed: Boolean(row.revealed),
    revealedAt: row.revealed_at ?? undefined,
    createdAt: row.created_at,
  };
}

function fromDbAuctionAmountLog(row: any): AuctionAmountLogEntry {
  return {
    id: row.id,
    auctionItemId: row.auction_item_id,
    adminId: row.admin_id ?? undefined,
    delta: Number(row.delta ?? 0),
    amountBefore: Number(row.amount_before ?? 0),
    amountAfter: Number(row.amount_after ?? 0),
    note: row.note ?? undefined,
    createdAt: row.created_at,
  };
}

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
  const [admin, setAdminState] = useState(!supabase && localStorage.getItem(authKey) === '1');
  const [auctions, setAuctions] = useState<AuctionItem[]>([]);
  const [auctionRules, setAuctionRules] = useState<AuctionRules | null>(null);
  const [auctionsLoading, setAuctionsLoading] = useState(Boolean(supabase));
  const [auctionsError, setAuctionsError] = useState<string>();
  const [viewerConsentedAt, setViewerConsentedAt] = useState<string | null>(null);
  const [viewerConsentLoaded, setViewerConsentLoaded] = useState(false);
  const [viewerVotesByItem, setViewerVotesByItem] = useState<Map<string, AllVote[]>>(new Map());

  const loadAuctions = async () => {
    if (!supabase) return;
    if (!auctions.length) setAuctionsLoading(true);
    setAuctionsError(undefined);
    const [itemsResult, rulesResult] = await Promise.all([
      supabase.from('auction_items').select('*').order('amount', { ascending: false }),
      supabase.from('auction_rules').select('*').eq('scope', 'global').maybeSingle(),
    ]);
    if (itemsResult.error) {
      setAuctionsError(itemsResult.error.message);
    } else {
      setAuctions((itemsResult.data ?? []).map(fromDbAuction));
    }
    if (rulesResult.error) {
      setAuctionsError((prev) => prev ?? rulesResult.error.message);
    } else if (rulesResult.data) {
      setAuctionRules({
        scope: rulesResult.data.scope,
        content: rulesResult.data.content ?? '',
        updatedAt: rulesResult.data.updated_at,
      });
    }
    setAuctionsLoading(false);
  };

  const persist = (next: RatedItem[]) => {
    setItems(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  };

  const loadItems = async () => {
    if (!supabase) return;
    if (!items.length) setLoading(true);
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

  const checkAdmin = async (userId: string) => {
    if (!supabase) return false;
    const { data, error } = await supabase
      .from('admin_users')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return Boolean(data);
  };

  useEffect(() => {
    if (!supabase) return;

    const setStableUser = (nextUser: User | null) => {
      setUser((current) => (current?.id === nextUser?.id ? current : nextUser));
    };

    const stripOAuthHash = () => {
      if (window.location.hash.includes('access_token')) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    };

    supabase.auth.getUser().then(({ data }) => setStableUser(data.user ?? null));
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setStableUser(session?.user ?? null);
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        stripOAuthHash();
      }
    });

    if (window.location.hash.includes('access_token')) {
      const stuckTimer = window.setTimeout(() => {
        if (window.location.hash.includes('access_token')) {
          stripOAuthHash();
        }
      }, 4000);
      return () => {
        window.clearTimeout(stuckTimer);
        data.subscription.unsubscribe();
      };
    }

    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase) return;
    loadItems();
    loadAuctions();
  }, [user]);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase
      .from('viewer_votes')
      .select('item_id, viewer_id, score, track_position, round_index, winner_side, is_best')
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        const byItem = new Map<string, AllVote[]>();
        data.forEach((row: any) => {
          const itemId = row.item_id as string;
          const vote: AllVote = {
            viewerId: row.viewer_id,
            trackPosition: row.track_position,
            roundIndex: row.round_index,
            isBest: Boolean(row.is_best),
            score: row.score == null ? null : (typeof row.score === 'number' ? row.score : Number(row.score)),
            winner: (row.winner_side ?? null) as BattleSide | null,
          };
          const list = byItem.get(itemId);
          if (list) list.push(vote);
          else byItem.set(itemId, [vote]);
        });
        setViewerVotesByItem(byItem);
      });
    return () => { cancelled = true; };
  }, [items]);

  useEffect(() => {
    if (!supabase) return;
    if (!user) {
      setAdminState(false);
      return;
    }

    checkAdmin(user.id)
      .then(setAdminState)
      .catch(() => setAdminState(false));
  }, [user]);

  useEffect(() => {
    if (!supabase) return;
    if (!user) {
      setViewerConsentedAt(null);
      setViewerConsentLoaded(false);
      return;
    }

    setViewerConsentLoaded(false);
    supabase
      .from('viewer_profiles')
      .select('consented_at')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          console.error('Не удалось загрузить профиль зрителя', error);
          setViewerConsentedAt(null);
        } else {
          setViewerConsentedAt(data?.consented_at ?? null);
        }
        setViewerConsentLoaded(true);
      });
  }, [user]);

  const upsertViewerVote = async (params: {
    itemId: string;
    matchTrackPosition: number | null;
    matchRoundIndex: number | null;
    updateFields: Record<string, unknown>;
    insertFields: Record<string, unknown>;
  }) => {
    if (!supabase) throw new Error('Голосование работает только на проде с Supabase');
    if (!user) throw new Error('Войди через Google чтобы голосовать');
    if (!viewerConsentedAt) throw new Error('Подтверди условия чтобы голосовать');
    const sb = supabase;
    const userId = user.id;
    const findExisting = async () => {
      let q = sb.from('viewer_votes').select('id').eq('viewer_id', userId).eq('item_id', params.itemId);
      q = params.matchTrackPosition == null ? q.is('track_position', null) : q.eq('track_position', params.matchTrackPosition);
      q = params.matchRoundIndex == null ? q.is('round_index', null) : q.eq('round_index', params.matchRoundIndex);
      const { data, error } = await q.maybeSingle();
      if (error) throw error;
      return data;
    };
    const existing = await findExisting();
    if (existing) {
      const { error } = await sb.from('viewer_votes').update(params.updateFields).eq('id', existing.id);
      if (error) throw error;
      return;
    }
    const { error: insertError } = await sb.from('viewer_votes').insert({
      viewer_id: userId,
      item_id: params.itemId,
      ...params.insertFields,
    });
    if (insertError) {
      const code = (insertError as { code?: string }).code;
      if (code === '23505') {
        // Race condition: кто-то параллельно вставил строку. Повторно select + update.
        const retryExisting = await findExisting();
        if (retryExisting) {
          const { error: retryError } = await sb.from('viewer_votes').update(params.updateFields).eq('id', retryExisting.id);
          if (retryError) throw retryError;
          return;
        }
      }
      throw insertError;
    }
  };

  const applyLocalVote = (itemId: string, partial: { trackPosition: number | null; roundIndex: number | null; score?: number | null; winner?: BattleSide | null; isBest?: boolean }) => {
    if (!user) return;
    setViewerVotesByItem((prev) => {
      const next = new Map(prev);
      const list = next.get(itemId) ?? [];
      const idx = list.findIndex((v) => v.viewerId === user.id && v.trackPosition === partial.trackPosition && v.roundIndex === partial.roundIndex);
      const existingVote = idx >= 0 ? list[idx] : null;
      const merged: AllVote = {
        viewerId: user.id,
        trackPosition: partial.trackPosition,
        roundIndex: partial.roundIndex,
        score: partial.score !== undefined ? partial.score : (existingVote?.score ?? null),
        winner: partial.winner !== undefined ? partial.winner : (existingVote?.winner ?? null),
        isBest: partial.isBest !== undefined ? partial.isBest : (existingVote?.isBest ?? false),
      };
      if (idx >= 0) {
        const updated = [...list];
        updated[idx] = merged;
        next.set(itemId, updated);
      } else {
        next.set(itemId, [...list, merged]);
      }
      return next;
    });
  };

  const value = useMemo<Store>(() => ({
    items,
    loading,
    error,
    admin,
    user,
    setAdmin(value) {
      if (supabase) return;
      setAdminState(value);
      localStorage.setItem(authKey, value ? '1' : '0');
    },
    async signIn(email, password) {
      if (!supabase) {
        setAdminState(true);
        localStorage.setItem(authKey, '1');
        return;
      }

      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const nextUser = data.user;
      if (!nextUser) throw new Error('Supabase не вернул пользователя после входа');
      const isAdmin = await checkAdmin(nextUser.id);
      if (!isAdmin) {
        await supabase.auth.signOut();
        throw new Error('Этот аккаунт не добавлен в список админов');
      }
      setUser(nextUser);
      setAdminState(true);
    },
    async signInWithGoogle() {
      if (!supabase) throw new Error('Вход через Google доступен только на проде с настроенным Supabase');
      const cleanReturnUrl = window.location.origin + window.location.pathname;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: cleanReturnUrl },
      });
      if (error) throw error;
    },
    async signOut() {
      if (supabase) await supabase.auth.signOut();
      setUser(null);
      setAdminState(false);
      setViewerConsentedAt(null);
      setViewerConsentLoaded(false);
      if (!supabase) localStorage.setItem(authKey, '0');
    },
    async recordConsent() {
      if (!supabase) throw new Error('Согласие работает только на проде с Supabase');
      if (!user) throw new Error('Войди через Google перед согласием');
      const consentedAt = new Date().toISOString();
      const { error } = await supabase.from('viewer_profiles').upsert({
        user_id: user.id,
        consented_at: consentedAt,
        consent_version: CONSENT_VERSION,
      });
      if (error) throw error;
      setViewerConsentedAt(consentedAt);
    },
    async loadMyItemVotes(itemId) {
      const empty = { album: null as number | null, tracks: new Map<number, number>(), battleRounds: new Map<number, BattleSide>(), battleFinal: null as BattleSide | null, bestTracks: new Set<number>() };
      if (!supabase || !user) return empty;
      const { data, error } = await supabase
        .from('viewer_votes')
        .select('score, track_position, round_index, winner_side, is_best')
        .eq('viewer_id', user.id)
        .eq('item_id', itemId);
      if (error) throw error;
      const result = { album: null as number | null, tracks: new Map<number, number>(), battleRounds: new Map<number, BattleSide>(), battleFinal: null as BattleSide | null, bestTracks: new Set<number>() };
      (data ?? []).forEach((row) => {
        if (row.is_best && row.track_position != null) result.bestTracks.add(row.track_position);
        const winner = row.winner_side as BattleSide | null;
        if (winner) {
          if (row.round_index == null) result.battleFinal = winner;
          else result.battleRounds.set(row.round_index, winner);
          // не возвращаемся: в той же строке может лежать и score (для баттла
          // оценка цифрой и голос за победителя живут в одной строке БД)
        }
        if (row.score == null) return;
        const score = typeof row.score === 'number' ? row.score : Number(row.score);
        if (row.track_position == null && row.round_index == null) result.album = score;
        else if (row.track_position != null) result.tracks.set(row.track_position, score);
      });
      return result;
    },
    async loadItemAllVotes(itemId) {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from('viewer_votes')
        .select('viewer_id, score, track_position, round_index, winner_side, is_best')
        .eq('item_id', itemId);
      if (error) throw error;
      return (data ?? []).map((row) => ({
        viewerId: row.viewer_id,
        trackPosition: row.track_position,
        roundIndex: row.round_index,
        score: row.score == null ? null : (typeof row.score === 'number' ? row.score : Number(row.score)),
        winner: (row.winner_side ?? null) as BattleSide | null,
        isBest: Boolean(row.is_best),
      }));
    },
    async toggleMyBestTrack(itemId, position, isBest) {
      await upsertViewerVote({
        itemId,
        matchTrackPosition: position,
        matchRoundIndex: null,
        updateFields: { is_best: isBest },
        insertFields: {
          track_position: position,
          round_index: null,
          score: null,
          winner_side: null,
          is_best: isBest,
        },
      });
      applyLocalVote(itemId, { trackPosition: position, roundIndex: null, isBest });
    },
    async saveMyAlbumVote(itemId, score) {
      await upsertViewerVote({
        itemId,
        matchTrackPosition: null,
        matchRoundIndex: null,
        updateFields: { score },
        insertFields: {
          score,
          round_index: null,
          track_position: null,
          winner_side: null,
        },
      });
      applyLocalVote(itemId, { trackPosition: null, roundIndex: null, score });
    },
    async saveMyTrackVote(itemId, position, score) {
      await upsertViewerVote({
        itemId,
        matchTrackPosition: position,
        matchRoundIndex: null,
        updateFields: { score },
        insertFields: {
          score,
          round_index: null,
          track_position: position,
          winner_side: null,
        },
      });
      applyLocalVote(itemId, { trackPosition: position, roundIndex: null, score });
    },
    async saveMyBattleRoundVote(itemId, roundIndex, side) {
      await upsertViewerVote({
        itemId,
        matchTrackPosition: null,
        matchRoundIndex: roundIndex,
        updateFields: { winner_side: side },
        insertFields: {
          round_index: roundIndex,
          track_position: null,
          score: null,
          winner_side: side,
        },
      });
      applyLocalVote(itemId, { trackPosition: null, roundIndex, winner: side });
    },
    async saveMyBattleFinalVote(itemId, side) {
      await upsertViewerVote({
        itemId,
        matchTrackPosition: null,
        matchRoundIndex: null,
        updateFields: { winner_side: side },
        insertFields: {
          round_index: null,
          track_position: null,
          score: null,
          winner_side: side,
        },
      });
      applyLocalVote(itemId, { trackPosition: null, roundIndex: null, winner: side });
    },
    async clearMyAlbumVote(itemId) {
      if (!supabase || !user) return;
      const { error } = await supabase
        .from('viewer_votes')
        .delete()
        .eq('viewer_id', user.id)
        .eq('item_id', itemId)
        .is('round_index', null)
        .is('track_position', null);
      if (error) throw error;
    },
    async clearMyTrackVotes(itemId) {
      if (!supabase || !user) return;
      const { error } = await supabase
        .from('viewer_votes')
        .delete()
        .eq('viewer_id', user.id)
        .eq('item_id', itemId)
        .is('round_index', null)
        .not('track_position', 'is', null);
      if (error) throw error;
    },
    viewerConsentedAt,
    viewerConsentLoaded,
    viewerVotesByItem,
    async saveItem(item) {
      const normalized = {
        ...item,
        genre: item.type === 'battle' ? item.genre : normalizeImportedGenre(item.genre),
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
          score: typeof track.score === 'number' ? track.score : null,
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
    auctions,
    auctionRules,
    auctionsLoading,
    auctionsError,
    async saveAuction(item) {
      if (!supabase) throw new Error('Аукционы доступны только с Supabase');
      const { error } = await supabase.from('auction_items').upsert(toDbAuction(item));
      if (error) throw error;
      await loadAuctions();
    },
    async deleteAuction(id) {
      if (!supabase) throw new Error('Аукционы доступны только с Supabase');
      const { error } = await supabase.from('auction_items').delete().eq('id', id);
      if (error) throw error;
      await loadAuctions();
    },
    async saveAuctionRules(content) {
      if (!supabase) throw new Error('Аукционы доступны только с Supabase');
      const { error } = await supabase.from('auction_rules').upsert({ scope: 'global', content });
      if (error) throw error;
      await loadAuctions();
    },
    async addAuctionAmount(itemId, delta) {
      if (!supabase) throw new Error('Аукционы доступны только с Supabase');
      const { error } = await supabase.rpc('increment_auction_amount', { p_item_id: itemId, p_delta: delta });
      if (error) throw error;
      await loadAuctions();
    },
  }), [admin, error, items, loading, user, viewerConsentedAt, viewerConsentLoaded, viewerVotesByItem, auctions, auctionRules, auctionsLoading, auctionsError]);  // eslint-disable-line react-hooks/exhaustive-deps

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

function App() {
  return (
    <BrowserRouter>
      <StoreProvider>
        <ScrollMemory />
        <Shell />
      </StoreProvider>
    </BrowserRouter>
  );
}

function ScrollMemory() {
  const location = useLocation();

  useEffect(() => {
    const key = `r1frating-scroll:${location.pathname}${location.search}`;
    const saved = Number(sessionStorage.getItem(key) || 0);
    window.requestAnimationFrame(() => window.scrollTo({ top: saved, left: 0, behavior: 'auto' }));

    let frame = 0;
    const saveNow = () => sessionStorage.setItem(key, String(window.scrollY));
    const save = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(saveNow);
    };

    window.addEventListener('scroll', save, { passive: true });
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', save);

    return () => {
      saveNow();
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', save);
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', save);
    };
  }, [location.pathname, location.search]);

  return null;
}

function ConsentModal() {
  const { user, viewerConsentedAt, viewerConsentLoaded, recordConsent } = useStore();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!user) {
      setDismissed(false);
      setError('');
      return;
    }
    setDismissed(sessionStorage.getItem(`consentDismissed:${user.id}`) === '1');
  }, [user?.id]);

  useEffect(() => {
    const handler = () => {
      if (user) {
        sessionStorage.removeItem(`consentDismissed:${user.id}`);
        setDismissed(false);
      }
    };
    window.addEventListener('r1f:request-consent', handler);
    return () => window.removeEventListener('r1f:request-consent', handler);
  }, [user?.id]);

  if (!user || !viewerConsentLoaded || viewerConsentedAt || dismissed) return null;

  const dismiss = () => {
    if (user) sessionStorage.setItem(`consentDismissed:${user.id}`, '1');
    setDismissed(true);
  };

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await recordConsent();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить согласие');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="consent-overlay" role="dialog" aria-modal="true" aria-labelledby="consent-title">
      <div className="consent-modal">
        <button type="button" className="consent-close" onClick={dismiss} aria-label="Закрыть">×</button>
        <h2 id="consent-title">Чтобы голосовать</h2>
        <p>
          Нажимая «Принимаю», ты подтверждаешь, что тебе есть 16 лет и ты согласен с <Link to="/privacy" target="_blank" rel="noopener noreferrer">Политикой конфиденциальности</Link> и <Link to="/terms" target="_blank" rel="noopener noreferrer">Условиями использования</Link>. Это нужно один раз.
        </p>
        {error && <div className="consent-error">{error}</div>}
        <div className="consent-actions">
          <button type="button" className="ghost" onClick={dismiss}>Позже</button>
          <button type="button" onClick={submit} disabled={saving}>{saving ? 'Сохраняю…' : 'Принимаю'}</button>
        </div>
      </div>
    </div>
  );
}

function Shell() {
  const { admin } = useStore();
  return (
    <>
      <ConsentModal />
      <header className="topbar">
        <Link to="/" className="brand"><span className="brand-mark">R1</span> R1Fрейтинг</Link>
        <nav>
          <Link to="/" className="nav-link">Каталог</Link>
          <Link to="/auctions" className="nav-link">Аукционы</Link>
          <Link to="/auctions/rules" className="nav-link">Правила</Link>
          {admin && <Link to="/admin" className="nav-link">Админка</Link>}
          <AuthBadge />
        </nav>
      </header>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/auctions" element={<AuctionsPage />} />
        <Route path="/auctions/rules" element={<AuctionRulesPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/item/:slug" element={<ItemPage />} />
        <Route path="/admin/login" element={<LoginPage />} />
        <Route path="/admin" element={<AdminRoute><AdminPage /></AdminRoute>} />
        <Route path="/admin/auctions" element={<AdminRoute><AdminAuctionsPage /></AdminRoute>} />
        <Route path="/admin/auctions/wheel" element={<AdminRoute><AdminWheelPage /></AdminRoute>} />
        <Route path="/admin/new" element={<AdminRoute><TypePickerPage /></AdminRoute>} />
        <Route path="/admin/new/:type" element={<AdminRoute><EditorPage /></AdminRoute>} />
        <Route path="/admin/edit/:id" element={<AdminRoute><EditorPage /></AdminRoute>} />
      </Routes>
      <footer className="site-footer">
        <span className="footer-age">16+</span>
        <span className="footer-sep">·</span>
        <Link to="/privacy" className="footer-link">Политика конфиденциальности</Link>
        <span className="footer-sep">·</span>
        <Link to="/terms" className="footer-link">Условия использования</Link>
      </footer>
    </>
  );
}

type HomeTypeFilter = 'all' | ItemType;
type HomeSort = 'new' | 'best' | 'worst';
type HomePeriod = 'all' | 'month' | 'week' | 'year' | 'last-year';
type HomeDateBasis = 'reviewed' | 'released';
type CatalogView = 'cards' | 'list';

const catalogViewKey = 'r1frating-catalog-view';

const homeTypeTabs: Array<{ value: HomeTypeFilter; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'album', label: 'Альбомы' },
  { value: 'battle', label: 'Баттлы' },
  { value: 'track', label: 'Треки' },
];

type HomeFiltersCache = {
  query: string;
  activeType: HomeTypeFilter;
  sort: HomeSort;
  period: HomePeriod;
  dateBasis: HomeDateBasis;
  activeTournament: string;
  activeSeason: string;
};

let cachedHomeFilters: HomeFiltersCache = {
  query: '',
  activeType: 'all',
  sort: 'new',
  period: 'all',
  dateBasis: 'reviewed',
  activeTournament: '',
  activeSeason: '',
};

function HomePage() {
  const { items, loading, error, admin } = useStore();
  const [query, setQuery] = useState(cachedHomeFilters.query);
  const [activeType, setActiveType] = useState<HomeTypeFilter>(cachedHomeFilters.activeType);
  const [sort, setSort] = useState<HomeSort>(cachedHomeFilters.sort);
  const [period, setPeriod] = useState<HomePeriod>(cachedHomeFilters.period);
  const [dateBasis, setDateBasis] = useState<HomeDateBasis>(cachedHomeFilters.dateBasis);
  const [catalogView, setCatalogView] = useState<CatalogView>(() => localStorage.getItem(catalogViewKey) === 'list' ? 'list' : 'cards');
  const [activeTournament, setActiveTournament] = useState<string>(cachedHomeFilters.activeTournament);
  const [activeSeason, setActiveSeason] = useState<string>(cachedHomeFilters.activeSeason);
  useEffect(() => localStorage.setItem(catalogViewKey, catalogView), [catalogView]);
  useEffect(() => {
    cachedHomeFilters = { query, activeType, sort, period, dateBasis, activeTournament, activeSeason };
  }, [query, activeType, sort, period, dateBasis, activeTournament, activeSeason]);
  const published = items.filter((item) => item.published);
  const bestAlbum = [...published].filter((item) => item.type === 'album').sort((a, b) => b.finalScore - a.finalScore)[0];
  const bestBattle = [...published].filter((item) => item.type === 'battle').sort((a, b) => b.finalScore - a.finalScore)[0];
  const bestTrack = [...published].filter((item) => item.type === 'track').sort((a, b) => b.finalScore - a.finalScore)[0];
  const featured = [bestAlbum, bestBattle, bestTrack].filter(Boolean) as RatedItem[];
  const searched = published.filter((item) => `${item.title} ${item.artist ?? ''} ${item.participants ?? ''} ${item.genre ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  const periodItems = searched.filter((item) => matchesPeriod(item, period, dateBasis));
  const typeFiltered = activeType === 'all' ? periodItems : periodItems.filter((item) => item.type === activeType);
  const battleTournaments = activeType === 'battle'
    ? Array.from(new Set(typeFiltered.flatMap((item) => item.metadata?.battle?.tournament ? [item.metadata.battle.tournament] : []))).sort()
    : [];
  const tournamentFiltered = activeType === 'battle' && activeTournament
    ? typeFiltered.filter((item) => item.metadata?.battle?.tournament === activeTournament)
    : typeFiltered;
  const battleSeasons = activeType === 'battle' && activeTournament
    ? Array.from(new Set(tournamentFiltered.flatMap((item) => item.metadata?.battle?.season ? [item.metadata.battle.season] : []))).sort()
    : [];
  const visibleBase = activeType === 'battle' && activeTournament && activeSeason
    ? tournamentFiltered.filter((item) => item.metadata?.battle?.season === activeSeason)
    : tournamentFiltered;
  const visibleItems = sortCatalog(visibleBase, sort, dateBasis);
  const periodScopedItems = published.filter((item) => matchesPeriod(item, period, dateBasis));
  const topAlbums = [...periodScopedItems].filter((item) => item.type === 'album').sort((a, b) => b.finalScore - a.finalScore).slice(0, 3);
  const topBattles = [...periodScopedItems].filter((item) => item.type === 'battle').sort((a, b) => b.finalScore - a.finalScore).slice(0, 3);
  const topTracks = [...periodScopedItems].filter((item) => item.type === 'track').sort((a, b) => b.finalScore - a.finalScore).slice(0, 3);
  const bestMonth = [...periodScopedItems].sort((a, b) => b.finalScore - a.finalScore)[0];
  const periodTitle =
    period === 'week' ? 'за неделю' :
    period === 'month' ? 'за месяц' :
    period === 'year' ? 'в этом году' :
    period === 'last-year' ? 'за прошлый год' :
    'за всё время';
  const topTitlePrefix = dateBasis === 'released' ? 'Лучшие вышедшие' : 'Лучшие оценённые';
  const weekItems = published.filter((item) => matchesPeriod(item, 'week', 'reviewed'));
  const counts = {
    all: periodItems.length,
    album: periodItems.filter((item) => item.type === 'album').length,
    battle: periodItems.filter((item) => item.type === 'battle').length,
    track: periodItems.filter((item) => item.type === 'track').length,
  };

  return (
    <main className="home">
      <section className="home-intro">
        <div>
          <p className="eyebrow">Оценки R1Fmabes</p>
          <h1>Каталог</h1>
          <p className="lead">Альбомы, треки, баттлы и ссылки на реакции в одном месте: что R1Fmabes слушал, смотрел и разбирал на стримах.</p>
        </div>
      </section>

      {loading ? (
        <FeaturedSkeleton />
      ) : featured.length > 0 && (
        <section className="featured-strip" aria-label="Лучшее в каталоге">
          {featured.map((item) => <FeaturedCard key={item.id} item={item} admin={admin} />)}
        </section>
      )}

      <section className="home-search-row">
        <label className="home-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по артисту, названию или жанру" /></label>
      </section>

      <section className="home-tools">
        <div className="pillbar" aria-label="Сортировка">
          <button className={sort === 'new' ? 'on' : ''} onClick={() => setSort('new')}>Новые</button>
          <button className={sort === 'best' ? 'on' : ''} onClick={() => setSort('best')}>Лучшие</button>
          <button className={sort === 'worst' ? 'on' : ''} onClick={() => setSort('worst')}>Худшие</button>
        </div>
        <div className="pillbar" aria-label="Какую дату учитывать">
          <button className={dateBasis === 'reviewed' ? 'on' : ''} onClick={() => setDateBasis('reviewed')}>Оценённые</button>
          <button className={dateBasis === 'released' ? 'on' : ''} onClick={() => setDateBasis('released')}>Вышедшие</button>
        </div>
        <div className="pillbar view-toggle" aria-label="Вид каталога">
          <button className={catalogView === 'cards' ? 'on' : ''} onClick={() => setCatalogView('cards')} title="Карточки"><LayoutGrid size={16} /></button>
          <button className={catalogView === 'list' ? 'on' : ''} onClick={() => setCatalogView('list')} title="Список"><List size={16} /></button>
        </div>
        <select value={period} onChange={(event) => setPeriod(event.target.value as HomePeriod)} aria-label="Период">
          <option value="all">За всё время</option>
          <option value="month">За месяц</option>
          <option value="week">За 7 дней</option>
          <option value="year">В этом году</option>
          <option value="last-year">За прошлый год</option>
        </select>
      </section>

      <section className="type-tabs" aria-label="Типы записей">
        {homeTypeTabs.map((tab) => (
          <button key={tab.value} className={activeType === tab.value ? 'on' : ''} onClick={() => { setActiveType(tab.value); setActiveTournament(''); setActiveSeason(''); }}>
            {tab.value !== 'all' && <ItemTypeIcon type={tab.value as ItemType} size={12} />}
            {tab.label} <span>{counts[tab.value]}</span>
          </button>
        ))}
      </section>
      {activeType === 'battle' && battleTournaments.length > 0 && (
        <section className="type-tabs type-subtabs" aria-label="Площадка баттла">
          <button className={activeTournament === '' ? 'on' : ''} onClick={() => { setActiveTournament(''); setActiveSeason(''); }}>Все площадки <span>{typeFiltered.length}</span></button>
          {battleTournaments.map((t) => (
            <button key={t} className={activeTournament === t ? 'on' : ''} onClick={() => { setActiveTournament(t); setActiveSeason(''); }}>
              {t} <span>{typeFiltered.filter((item) => item.metadata?.battle?.tournament === t).length}</span>
            </button>
          ))}
        </section>
      )}
      {activeType === 'battle' && activeTournament && battleSeasons.length > 0 && (
        <section className="type-tabs type-subtabs" aria-label="Сезон">
          <button className={activeSeason === '' ? 'on' : ''} onClick={() => setActiveSeason('')}>Все сезоны <span>{tournamentFiltered.length}</span></button>
          {battleSeasons.map((s) => (
            <button key={s} className={activeSeason === s ? 'on' : ''} onClick={() => setActiveSeason(s)}>
              {s} <span>{tournamentFiltered.filter((item) => item.metadata?.battle?.season === s).length}</span>
            </button>
          ))}
        </section>
      )}

      {error && <div className="empty">Ошибка загрузки: {error}</div>}

      {loading && !error && <HomeCatalogSkeleton />}

      {!loading && !error && (
        <section className="catalog-split">
          <div>
            {!visibleItems.length ? (
              <div className="empty">По этим фильтрам пока нет опубликованных записей.</div>
            ) : catalogView === 'list' ? (
              <div className="catalog-list">
                {visibleItems.map((item) => <ItemListRow key={item.id} item={item} admin={admin} />)}
              </div>
            ) : (
              <div className="catalog-grid">
                {visibleItems.map((item) => <ItemCard key={item.id} item={item} admin={admin} />)}
              </div>
            )}
          </div>
          <aside className="home-rail">
            <RailPanel title={`${topTitlePrefix} альбомы ${periodTitle}`} items={topAlbums} ranked empty="Альбомов в этот период нет." />
            <RailPanel title={`${topTitlePrefix} баттлы ${periodTitle}`} items={topBattles} ranked empty="Баттлов в этот период нет." />
            <RailPanel title={`${topTitlePrefix} треки ${periodTitle}`} items={topTracks} ranked empty="Треков в этот период нет." />
          </aside>
        </section>
      )}

      <section className="activity-strip">
        <div className="activity-nums">
          <div><strong>{weekItems.filter((item) => item.type === 'album').length}</strong><small>альбомов за неделю</small></div>
          <div><strong>{weekItems.filter((item) => item.type === 'battle').length}</strong><small>баттлов за неделю</small></div>
          <div><strong>{weekItems.filter((item) => item.type === 'track').length}</strong><small>треков за неделю</small></div>
          <div><strong>{published.length}</strong><small>всего опубликовано</small></div>
        </div>
      </section>
    </main>
  );
}

function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

function FeaturedSkeleton() {
  return (
    <section className="featured-strip" aria-hidden="true">
      {Array.from({ length: 3 }).map((_, index) => (
        <div className="featured-card skeleton-card" key={index}>
          <SkeletonBlock className="skeleton-score" />
          <div className="featured-body">
            <SkeletonBlock className="skeleton-line short" />
            <SkeletonBlock className="skeleton-line title" />
            <SkeletonBlock className="skeleton-line medium" />
          </div>
        </div>
      ))}
    </section>
  );
}

function HomeCatalogSkeleton() {
  return (
    <section className="catalog-split" aria-hidden="true">
      <div className="catalog-grid">
        {Array.from({ length: 6 }).map((_, index) => (
          <div className="catalog-card skeleton-catalog-card" key={index}>
            <SkeletonBlock className="skeleton-cover" />
            <div className="catalog-card-body">
              <SkeletonBlock className="skeleton-line title" />
              <SkeletonBlock className="skeleton-line medium" />
            </div>
            <div className="catalog-card-foot">
              <SkeletonBlock className="skeleton-line short" />
              <SkeletonBlock className="skeleton-line tiny" />
            </div>
          </div>
        ))}
      </div>
      <aside className="home-rail">
        {Array.from({ length: 3 }).map((_, panelIndex) => (
          <section className="rail-panel" key={panelIndex}>
            <SkeletonBlock className="skeleton-line medium" />
            <div className="rail-list">
              {Array.from({ length: 3 }).map((__, rowIndex) => (
                <div className="rail-item skeleton-rail-item" key={rowIndex}>
                  <SkeletonBlock className="skeleton-dot" />
                  <SkeletonBlock className="skeleton-mini" />
                  <div className="rail-copy">
                    <SkeletonBlock className="skeleton-line medium" />
                    <SkeletonBlock className="skeleton-line short" />
                  </div>
                  <SkeletonBlock className="skeleton-line tiny" />
                </div>
              ))}
            </div>
          </section>
        ))}
      </aside>
    </section>
  );
}

function FeaturedCard({ item, admin }: { item: RatedItem; admin?: boolean }) {
  return (
    <div className="featured-card-shell">
      <Link to={`/item/${item.slug}`} className={`featured-card featured-${item.type}`}>
        <CardCover item={item} />
        <div className="featured-veil" />
        <ScorePair item={item} className="score-pos" />
        <span className={`type-chip type-${item.type} card-type-chip`}><ItemTypeIcon type={item.type} /><span>{itemTypeLabel(item.type)}</span></span>
        <div className="featured-body">
          <div className="featured-meta">
            <span>{cardDateLabel(item)}</span>
          </div>
          <h2>{item.title}</h2>
          <p>{catalogSubtitle(item)}</p>
        </div>
      </Link>
      {admin && <Link className="card-edit-button" to={`/admin/edit/${item.id}`} title="Редактировать"><Edit3 size={15} /><span>Править</span></Link>}
    </div>
  );
}

function ItemCard({ item, admin }: { item: RatedItem; admin?: boolean }) {
  return (
    <div className="catalog-card-shell">
      <Link to={`/item/${item.slug}`} className="catalog-card">
        <div className="catalog-thumb">
          <CardCover item={item} />
          <span className={`type-chip type-${item.type} card-type-chip`}><ItemTypeIcon type={item.type} /><span>{itemTypeLabel(item.type)}</span></span>
          <ScorePair item={item} className="score-pos" />
        </div>
        <div className="catalog-card-body">
          <h2>{item.title}</h2>
          <p>{catalogSubtitle(item)}</p>
          {bestAlbumTracksLabel(item) && <small className="best-tracks-line"><Star size={13} /> {bestAlbumTracksLabel(item)}</small>}
        </div>
        <div className="catalog-card-foot">
          <span>{cardDateLabel(item)}</span>
          <span>{item.links.length ? `${item.links.length} ссыл.` : 'без ссылок'}</span>
        </div>
      </Link>
      {admin && <Link className="card-edit-button" to={`/admin/edit/${item.id}`} title="Редактировать"><Edit3 size={15} /><span>Править</span></Link>}
    </div>
  );
}

function ItemListRow({ item, admin }: { item: RatedItem; admin?: boolean }) {
  return (
    <div className="catalog-list-row-shell">
      <Link to={`/item/${item.slug}`} className="catalog-list-row">
        <div className="catalog-list-thumb"><CardCover item={item} /></div>
        <div className="catalog-list-main">
          <div className="catalog-list-title">
            <h2>{item.title}</h2>
            <span className={`type-chip type-${item.type}`}><ItemTypeIcon type={item.type} /><span>{itemTypeLabel(item.type)}</span></span>
          </div>
          <p>{catalogSubtitle(item)}</p>
          {bestAlbumTracksLabel(item) && <small className="best-tracks-line"><Star size={13} /> {bestAlbumTracksLabel(item)}</small>}
          <small>{cardDateLabel(item)} · {item.links.length ? `${item.links.length} ссыл.` : 'без ссылок'}</small>
        </div>
        <ScorePair item={item} className="catalog-list-score" withLabels />
      </Link>
      {admin && <Link className="list-edit-button" to={`/admin/edit/${item.id}`} title="Редактировать"><Edit3 size={15} /><span>Править</span></Link>}
    </div>
  );
}

function RailPanel({ title, items, ranked, empty }: { title: string; items: RatedItem[]; ranked?: boolean; empty: string }) {
  return (
    <section className="rail-panel">
      <h3>{title}</h3>
      {items.length ? (
        <div className="rail-list">
          {items.map((item, index) => <RailItem key={item.id} item={item} rank={ranked ? index + 1 : undefined} />)}
        </div>
      ) : (
        <p className="rail-empty">{empty}</p>
      )}
    </section>
  );
}

function RailItem({ item, rank }: { item: RatedItem; rank?: number }) {
  return (
    <Link to={`/item/${item.slug}`} className="rail-item">
      <span className="rail-rank">{rank ?? '•'}</span>
      <div className="rail-mini"><CardCover item={item} /></div>
      <div className="rail-copy">
        <strong>{item.title}</strong>
        <small>{catalogSubtitle(item)} · {itemTypeLabel(item.type).toLowerCase()}</small>
      </div>
      <span className="rail-score" style={{ color: scoreColor(item.finalScore) }}>{item.finalScore.toFixed(1)}</span>
    </Link>
  );
}

function scoreColor(score: number) {
  if (score >= 9) return '#ffe600';
  if (score >= 7.5) return '#4ade80';
  if (score >= 6) return '#00e5ff';
  if (score >= 4) return '#ff9f45';
  return '#ff4d6d';
}

function displayCoverUrl(url?: string) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'images.weserv.nl' || parsed.hostname === 'wsrv.nl') return url;
    if (parsed.hostname === 'i.ytimg.com' || parsed.hostname === 'img.youtube.com') {
      return `https://images.weserv.nl/?url=${parsed.hostname}${parsed.pathname}${parsed.search}`;
    }
  } catch {
    return url;
  }
  return url;
}

function CoverImage({ url }: { url?: string }) {
  const [failed, setFailed] = useState(false);
  const src = displayCoverUrl(url);
  if (!src || failed) return <div className="cover-placeholder"><Star /></div>;
  return <img src={src} alt="" onError={() => setFailed(true)} />;
}

function CardCover({ item }: { item: RatedItem }) {
  return <CoverImage url={item.coverUrl} />;
}

function sortCatalog(items: RatedItem[], sort: HomeSort, basis: HomeDateBasis) {
  return [...items].sort((a, b) => {
    if (sort === 'best') return b.finalScore - a.finalScore;
    if (sort === 'worst') return a.finalScore - b.finalScore;
    if (basis === 'released') return (b.releaseYear ?? 0) - (a.releaseYear ?? 0) || byNewestCreated(a, b);
    return itemReviewedTime(b) - itemReviewedTime(a) || byNewestCreated(a, b);
  });
}

function byNewestCreated(a: RatedItem, b: RatedItem) {
  return b.createdAt.localeCompare(a.createdAt);
}

function itemReviewedTime(item: RatedItem) {
  return Date.parse(item.reviewedAt || item.createdAt);
}

function itemReleasedTime(item: RatedItem) {
  const metadata = item.metadata as (ItemMetadata & { releaseDate?: string }) | undefined;
  const releaseDate = metadata?.releaseDate;
  return releaseDate ? Date.parse(releaseDate) : NaN;
}

function matchesPeriod(item: RatedItem, period: HomePeriod, basis: HomeDateBasis) {
  if (period === 'all') return true;
  const currentYear = new Date().getFullYear();
  if (basis === 'released') {
    if (period === 'year') return item.releaseYear === currentYear;
    if (period === 'last-year') return item.releaseYear === currentYear - 1;
    const released = itemReleasedTime(item);
    if (Number.isNaN(released)) return false;
    const days = period === 'month' ? 30 : 7;
    return Date.now() - released <= days * 24 * 60 * 60 * 1000;
  }
  const reviewed = itemReviewedTime(item);
  if (Number.isNaN(reviewed)) return false;
  if (period === 'year') return new Date(reviewed).getFullYear() === currentYear;
  if (period === 'last-year') return new Date(reviewed).getFullYear() === currentYear - 1;
  const days = period === 'month' ? 30 : 7;
  return Date.now() - reviewed <= days * 24 * 60 * 60 * 1000;
}

function catalogSubtitle(item: RatedItem) {
  if (item.type === 'battle') {
    const tournament = item.metadata?.battle?.tournament;
    const season = item.metadata?.battle?.season;
    const stage = item.metadata?.battle?.stage;
    const meta = [tournament, season, stage].filter(Boolean);
    return meta.length ? meta.join(' · ') : (item.participants || 'Участники не указаны');
  }
  return item.artist || 'Артист не указан';
}

function relativeDate(value: string) {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return 'без даты';
  const diffDays = Math.max(0, Math.floor((Date.now() - time) / (24 * 60 * 60 * 1000)));
  if (diffDays === 0) return 'сегодня';
  if (diffDays === 1) return 'вчера';
  if (diffDays < 7) return `${diffDays} дн. назад`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} нед. назад`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} мес. назад`;
  return `${Math.floor(diffDays / 365)} г. назад`;
}

type AllVote = { viewerId: string; trackPosition: number | null; roundIndex: number | null; score: number | null; winner: BattleSide | null; isBest: boolean };

type ItemVotesState = {
  album: number | null;
  tracks: Map<number, number>;
  battleRounds: Map<number, BattleSide>;
  battleFinal: BattleSide | null;
  bestTracks: Set<number>;
  allVotes: AllVote[];
  loaded: boolean;
  error: string;
};

function aggregateBattle(allVotes: AllVote[], roundIndex: number | null) {
  const list = allVotes.filter((v) => v.roundIndex === roundIndex && v.trackPosition == null && v.winner != null);
  if (!list.length) return null;
  const counts: Record<BattleSide, number> = { a: 0, b: 0, draw: 0 };
  list.forEach((v) => { if (v.winner) counts[v.winner] += 1; });
  return { counts, total: list.length };
}

function aggregateForItem(allVotes: AllVote[] | undefined, item: RatedItem) {
  if (!allVotes || !allVotes.length) return null;
  return item.type === 'album' ? aggregateAlbum(allVotes, item) : aggregateSingleScore(allVotes);
}

function ScorePair({ item, className, withLabels }: { item: RatedItem; className?: string; withLabels?: boolean }) {
  const { viewerVotesByItem } = useStore();
  const agg = aggregateForItem(viewerVotesByItem.get(item.id), item);
  return (
    <span className={`score-pair ${className || ''} ${withLabels ? 'score-pair-labeled' : ''}`}>
      <span className="score-pair-row">
        {withLabels && <span className="score-pair-label">R1F</span>}
        <span className={`${scoreClass(item.finalScore)} score-pair-badge`} title="Оценка R1Fmabes">{item.finalScore.toFixed(1)}</span>
      </span>
      {agg ? (
        <span className="score-pair-row">
          {withLabels && <span className="score-pair-label">Зрители · {agg.count}</span>}
          <span className={`${scoreClass(agg.avg)} score-pair-badge`} title={`Средняя зрителей · ${agg.count} ${agg.count === 1 ? 'голос' : agg.count < 5 ? 'голоса' : 'голосов'}`}>{agg.avg.toFixed(1)}</span>
        </span>
      ) : withLabels && (
        <span className="score-pair-row">
          <span className="score-pair-label">Зрители</span>
          <span className="score-pair-badge track-badge-empty">—</span>
        </span>
      )}
    </span>
  );
}

function aggregateSingleScore(allVotes: AllVote[]) {
  const list = allVotes.filter((v) => v.score != null && v.trackPosition == null && v.roundIndex == null);
  if (!list.length) return null;
  const sum = list.reduce((a, v) => a + (v.score ?? 0), 0);
  return { avg: sum / list.length, count: list.length };
}

function aggregateTrack(allVotes: AllVote[], position: number) {
  const list = allVotes.filter((v) => v.trackPosition === position && v.score != null);
  if (!list.length) return null;
  const sum = list.reduce((acc, v) => acc + (v.score ?? 0), 0);
  return { avg: sum / list.length, count: list.length };
}

function aggregateAlbum(allVotes: AllVote[], item: RatedItem) {
  const eligibleTrackPositions = new Set(item.tracks.filter((t) => t.score !== '-').map((t) => t.position));
  const byViewer = new Map<string, { album: number | null; tracks: number[] }>();
  allVotes.forEach((v) => {
    if (v.score == null) return;
    let entry = byViewer.get(v.viewerId);
    if (!entry) {
      entry = { album: null, tracks: [] };
      byViewer.set(v.viewerId, entry);
    }
    if (v.trackPosition == null && v.roundIndex == null) entry.album = v.score;
    else if (v.trackPosition != null && eligibleTrackPositions.has(v.trackPosition)) entry.tracks.push(v.score);
  });
  const finals: number[] = [];
  byViewer.forEach((entry) => {
    if (entry.album != null) finals.push(entry.album);
    else if (entry.tracks.length) finals.push(entry.tracks.reduce((a, b) => a + b, 0) / entry.tracks.length);
  });
  if (!finals.length) return null;
  return { avg: finals.reduce((a, b) => a + b, 0) / finals.length, count: finals.length };
}

function useItemVotes(itemId: string) {
  const { user, viewerConsentedAt, loadMyItemVotes, loadItemAllVotes, saveMyAlbumVote, saveMyTrackVote, saveMyBattleRoundVote, saveMyBattleFinalVote, toggleMyBestTrack, clearMyAlbumVote, clearMyTrackVotes } = useStore();
  const emptyState: ItemVotesState = { album: null, tracks: new Map(), battleRounds: new Map(), battleFinal: null, bestTracks: new Set(), allVotes: [], loaded: false, error: '' };
  const [state, setState] = useState<ItemVotesState>(emptyState);

  useEffect(() => {
    if (itemId === '00000000-0000-0000-0000-000000000000') {
      setState({ ...emptyState, loaded: true });
      return;
    }
    setState((current) => ({ ...current, loaded: false }));
    let cancelled = false;
    Promise.all([
      user && viewerConsentedAt ? loadMyItemVotes(itemId) : Promise.resolve({ album: null as number | null, tracks: new Map<number, number>(), battleRounds: new Map<number, BattleSide>(), battleFinal: null as BattleSide | null, bestTracks: new Set<number>() }),
      loadItemAllVotes(itemId),
    ])
      .then(([mine, all]) => {
        if (cancelled) return;
        setState({ album: mine.album, tracks: mine.tracks, battleRounds: mine.battleRounds, battleFinal: mine.battleFinal, bestTracks: mine.bestTracks, allVotes: all, loaded: true, error: '' });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ ...emptyState, loaded: true, error: err instanceof Error ? err.message : 'Не удалось загрузить голоса' });
      });
    return () => { cancelled = true; };
  }, [user?.id, viewerConsentedAt, itemId]);

  const upsertScoreVote = (allVotes: AllVote[], viewerId: string, trackPosition: number | null, score: number) => {
    const idx = allVotes.findIndex((v) => v.viewerId === viewerId && v.trackPosition === trackPosition && v.roundIndex == null);
    const next = [...allVotes];
    if (idx >= 0) next[idx] = { ...next[idx], score, winner: null };
    else next.push({ viewerId, trackPosition, roundIndex: null, score, winner: null, isBest: false });
    return next;
  };

  const upsertBattleVote = (allVotes: AllVote[], viewerId: string, roundIndex: number | null, side: BattleSide) => {
    const idx = allVotes.findIndex((v) => v.viewerId === viewerId && v.roundIndex === roundIndex && v.trackPosition == null);
    const next = [...allVotes];
    if (idx >= 0) next[idx] = { ...next[idx], winner: side, score: null };
    else next.push({ viewerId, trackPosition: null, roundIndex, score: null, winner: side, isBest: false });
    return next;
  };

  const upsertBestFlag = (allVotes: AllVote[], viewerId: string, position: number, isBest: boolean) => {
    const idx = allVotes.findIndex((v) => v.viewerId === viewerId && v.trackPosition === position && v.roundIndex == null);
    const next = [...allVotes];
    if (idx >= 0) next[idx] = { ...next[idx], isBest };
    else next.push({ viewerId, trackPosition: position, roundIndex: null, score: null, winner: null, isBest });
    return next;
  };

  return {
    state,
    async saveAlbum(score: number) {
      const prevAlbum = state.album;
      const prevAll = state.allVotes;
      if (!user) throw new Error('Войди через Google чтобы голосовать');
      setState((prev) => ({ ...prev, album: score, allVotes: upsertScoreVote(prev.allVotes, user.id, null, score), error: '' }));
      try {
        await saveMyAlbumVote(itemId, score);
      } catch (err) {
        setState((prev) => ({ ...prev, album: prevAlbum, allVotes: prevAll }));
        throw err;
      }
    },
    async saveTrack(position: number, score: number) {
      const prevScore = state.tracks.get(position);
      const prevAll = state.allVotes;
      if (!user) throw new Error('Войди через Google чтобы голосовать');
      setState((prev) => {
        const tracks = new Map(prev.tracks);
        tracks.set(position, score);
        return { ...prev, tracks, allVotes: upsertScoreVote(prev.allVotes, user.id, position, score), error: '' };
      });
      try {
        await saveMyTrackVote(itemId, position, score);
      } catch (err) {
        setState((prev) => {
          const tracks = new Map(prev.tracks);
          if (prevScore == null) tracks.delete(position);
          else tracks.set(position, prevScore);
          return { ...prev, tracks, allVotes: prevAll };
        });
        throw err;
      }
    },
    async saveBattleRound(roundIndex: number, side: BattleSide) {
      const prev = state.battleRounds.get(roundIndex) ?? null;
      const prevAll = state.allVotes;
      if (!user) throw new Error('Войди через Google чтобы голосовать');
      setState((current) => {
        const rounds = new Map(current.battleRounds);
        rounds.set(roundIndex, side);
        return { ...current, battleRounds: rounds, allVotes: upsertBattleVote(current.allVotes, user.id, roundIndex, side), error: '' };
      });
      try {
        await saveMyBattleRoundVote(itemId, roundIndex, side);
      } catch (err) {
        setState((current) => {
          const rounds = new Map(current.battleRounds);
          if (prev == null) rounds.delete(roundIndex);
          else rounds.set(roundIndex, prev);
          return { ...current, battleRounds: rounds, allVotes: prevAll };
        });
        throw err;
      }
    },
    async toggleBest(position: number) {
      if (!user) throw new Error('Войди через Google');
      const prev = state.bestTracks.has(position);
      const next = !prev;
      if (next && state.bestTracks.size >= maxBestAlbumTracks) {
        throw new Error(`Можно отметить не больше ${maxBestAlbumTracks} лучших треков`);
      }
      const prevAll = state.allVotes;
      setState((current) => {
        const bestTracks = new Set(current.bestTracks);
        if (next) bestTracks.add(position);
        else bestTracks.delete(position);
        return { ...current, bestTracks, allVotes: upsertBestFlag(current.allVotes, user.id, position, next) };
      });
      try {
        await toggleMyBestTrack(itemId, position, next);
      } catch (err) {
        setState((current) => {
          const bestTracks = new Set(current.bestTracks);
          if (prev) bestTracks.add(position);
          else bestTracks.delete(position);
          return { ...current, bestTracks, allVotes: prevAll };
        });
        throw err;
      }
    },
    async saveBattleFinal(side: BattleSide) {
      const prev = state.battleFinal;
      const prevAll = state.allVotes;
      if (!user) throw new Error('Войди через Google чтобы голосовать');
      setState((current) => ({ ...current, battleFinal: side, allVotes: upsertBattleVote(current.allVotes, user.id, null, side), error: '' }));
      try {
        await saveMyBattleFinalVote(itemId, side);
      } catch (err) {
        setState((current) => ({ ...current, battleFinal: prev, allVotes: prevAll }));
        throw err;
      }
    },
    async clearAlbum() {
      await clearMyAlbumVote(itemId);
      setState((prev) => ({
        ...prev,
        album: null,
        allVotes: user ? prev.allVotes.filter((v) => !(v.viewerId === user.id && v.trackPosition == null)) : prev.allVotes,
      }));
    },
    async clearTracks() {
      await clearMyTrackVotes(itemId);
      setState((prev) => ({
        ...prev,
        tracks: new Map(),
        allVotes: user ? prev.allVotes.filter((v) => !(v.viewerId === user.id && v.trackPosition != null)) : prev.allVotes,
      }));
    },
  };
}

function viewerTracksAverage(votes: Map<number, number>, item: RatedItem): { avg: number; counted: number; total: number } {
  const counted = [...votes.entries()].filter(([position]) => {
    const track = item.tracks.find((entry) => entry.position === position);
    return track && track.score !== '-';
  });
  const eligibleTotal = item.tracks.filter((track) => track.score !== '-').length;
  if (!counted.length) return { avg: 0, counted: 0, total: eligibleTotal };
  const sum = counted.reduce((acc, [, value]) => acc + value, 0);
  return { avg: sum / counted.length, counted: counted.length, total: eligibleTotal };
}

function clampScore(value: number, max: number) {
  if (Number.isNaN(value)) return 0;
  const clamped = Math.max(0, Math.min(max, value));
  return Math.round(clamped * 10) / 10;
}

type AlbumVoteHandle = {
  saveIfTouched: () => Promise<void>;
};

const AlbumVotePanel = forwardRef<AlbumVoteHandle, { item: RatedItem; votes: ItemVotesState; save: (score: number) => Promise<void>; onTouchedChange?: (touched: boolean) => void }>(function AlbumVotePanel({ item, votes, save, onTouchedChange }, ref) {
  const { user, admin, viewerConsentedAt, viewerConsentLoaded, signInWithGoogle } = useStore();
  const maxScore = admin ? 11 : 10;
  const isAlbum = item.type === 'album';
  const trackStats = isAlbum ? viewerTracksAverage(votes.tracks, item) : { avg: 0, counted: 0, total: 0 };
  const fallbackScore = votes.album ?? (trackStats.counted > 0 ? Math.round(trackStats.avg * 10) / 10 : 0);
  const [draftScore, setDraftScore] = useState<number>(fallbackScore);
  const [draftText, setDraftText] = useState<string>(votes.album != null ? votes.album.toFixed(1) : (fallbackScore > 0 ? fallbackScore.toFixed(1) : ''));
  const [touched, setTouchedState] = useState(false);
  const [error, setError] = useState('');
  const draftRef = useRef(draftScore);
  draftRef.current = draftScore;
  const touchedRef = useRef(touched);
  touchedRef.current = touched;
  const savedAlbumRef = useRef(votes.album);
  savedAlbumRef.current = votes.album;

  const setTouched = (value: boolean) => {
    touchedRef.current = value;
    setTouchedState(value);
    onTouchedChange?.(value);
  };

  useEffect(() => {
    if (touched) return;
    let next: number;
    if (votes.album != null) next = votes.album;
    else if (trackStats.counted > 0) next = Math.round(trackStats.avg * 10) / 10;
    else next = 0;
    setDraftScore(next);
    setDraftText(next > 0 || votes.album === 0 ? next.toFixed(1) : '');
  }, [votes.album, trackStats.counted, trackStats.avg, touched]);

  useImperativeHandle(ref, () => ({
    saveIfTouched: async () => {
      const score = draftRef.current;
      const saved = savedAlbumRef.current;
      const hasChange = touchedRef.current || (score > 0 && score !== saved);
      if (!hasChange) return;
      if (score <= 0) return;
      try {
        await save(score);
        touchedRef.current = false;
        setTouchedState(false);
        onTouchedChange?.(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось сохранить голос');
        throw err;
      }
    },
  }), [save]);

  if (!supabase) return null;

  const requestConsent = () => window.dispatchEvent(new Event('r1f:request-consent'));

  const renderBody = () => {
    if (!user) {
      return (
        <div className="viewer-vote-action">
          <p className="viewer-vote-hint">Войди через Google, чтобы оставить свою оценку.</p>
          <button type="button" onClick={() => signInWithGoogle().catch((err) => setError(err instanceof Error ? err.message : 'Не удалось начать вход'))}>Войти через Google</button>
        </div>
      );
    }
    if (!viewerConsentLoaded) return <p className="muted">Загружаю профиль…</p>;
    if (!viewerConsentedAt) {
      return (
        <div className="viewer-vote-action">
          <p className="viewer-vote-hint">Прими условия — это нужно один раз.</p>
          <button type="button" onClick={requestConsent}>Подтвердить условия</button>
        </div>
      );
    }
    if (!votes.loaded) return <p className="muted">Загружаю твой голос…</p>;
    if (votes.error) return <div className="viewer-vote-error">{votes.error}</div>;
    const showsTracksAverage = isAlbum && votes.album == null && !touched && trackStats.counted > 0;
    return (
      <div className="vote-input-group">
        <div className="vote-input-wrap">
          <div className="vote-side">
            <input
              type="text"
              inputMode="decimal"
              pattern="[0-9.,]*"
              maxLength={4}
              value={draftText}
              placeholder="0.0"
              onChange={(event) => {
                const raw = event.target.value.replace(/[^0-9.,]/g, '');
                setDraftText(raw);
                setTouched(true);
                if (raw === '') {
                  setDraftScore(0);
                  return;
                }
                const num = Number(raw.replace(',', '.'));
                if (!Number.isNaN(num)) setDraftScore(clampScore(num, maxScore));
              }}
              onBlur={() => {
                if (draftText === '' || Number.isNaN(Number(draftText.replace(',', '.')))) {
                  setDraftText(draftScore > 0 ? draftScore.toFixed(1) : '');
                } else {
                  setDraftText(draftScore.toFixed(1));
                }
              }}
              className={`vote-input vote-side-badge ${draftScore > 0 ? scoreClass(draftScore) : ''}`}
              aria-label="Твоя оценка"
            />
          </div>
          {item.type === 'track' && (
            <button
              type="button"
              className="vote-save-button"
              disabled={!touched || draftScore <= 0 || draftScore === votes.album}
              onClick={async () => {
                try {
                  await save(draftScore);
                  setTouchedState(false);
                  onTouchedChange?.(false);
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Не удалось сохранить');
                }
              }}
            >Сохранить</button>
          )}
        </div>
        <div className="vote-input-hint">
          {votes.album != null && <>Сохранено: <b>{votes.album.toFixed(1)}</b></>}
          {votes.album == null && showsTracksAverage && (
            <>Средняя по трекам: <b>{trackStats.avg.toFixed(1)}</b> (по {trackStats.counted} из {trackStats.total})</>
          )}
        </div>
      </div>
    );
  };

  return (
    <section className="viewer-vote-bar">
      <div className="viewer-vote-title">
        <h2>{isAlbum ? 'Поставь оценку альбому' : item.type === 'battle' ? 'Поставь оценку баттлу' : 'Поставь свою оценку'}</h2>
        {isAlbum && <p className="muted viewer-vote-subtitle">Можно оценить альбом целиком или по трекам.</p>}
      </div>
      {renderBody()}
      {error && <div className="viewer-vote-error">{error}</div>}
    </section>
  );
});

type TrackSliderHandle = {
  saveIfTouched: () => Promise<void>;
};

const TrackVoteSlider = forwardRef<TrackSliderHandle, { item: RatedItem; position: number; currentScore: number | null; saveTrack: (score: number) => Promise<void>; onTouchedChange?: (position: number, touched: boolean) => void }>(function TrackVoteSlider({ item, position, currentScore, saveTrack, onTouchedChange }, ref) {
  const { user, admin, viewerConsentedAt, viewerConsentLoaded, signInWithGoogle } = useStore();
  const maxScore = admin ? 11 : 10;
  const [draftScore, setDraftScore] = useState<number>(currentScore ?? 0);
  const [draftText, setDraftText] = useState<string>(currentScore != null ? currentScore.toFixed(1) : '');
  const [touched, setTouchedState] = useState(false);
  const [error, setError] = useState('');
  const draftRef = useRef(draftScore);
  draftRef.current = draftScore;
  const touchedRef = useRef(touched);
  touchedRef.current = touched;
  void item;

  const savedTrackRef = useRef(currentScore);
  savedTrackRef.current = currentScore;

  const setTouched = (value: boolean) => {
    touchedRef.current = value;
    setTouchedState(value);
    onTouchedChange?.(position, value);
  };

  useEffect(() => {
    if (currentScore != null) {
      setDraftScore(currentScore);
      setDraftText(currentScore.toFixed(1));
    } else {
      setDraftScore(0);
      setDraftText('');
    }
    touchedRef.current = false;
    setTouchedState(false);
    onTouchedChange?.(position, false);
  }, [currentScore]);

  useImperativeHandle(ref, () => ({
    saveIfTouched: async () => {
      const score = draftRef.current;
      const saved = savedTrackRef.current;
      const hasChange = touchedRef.current || (score > 0 && score !== saved);
      if (!hasChange) return;
      if (score <= 0) return;
      try {
        await saveTrack(score);
        touchedRef.current = false;
        setTouchedState(false);
        onTouchedChange?.(position, false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось сохранить');
        throw err;
      }
    },
  }), [saveTrack, position]);

  if (!supabase) return null;
  const requestConsent = () => window.dispatchEvent(new Event('r1f:request-consent'));

  if (!user) {
    return (
      <button type="button" className="track-vote-cta" onClick={() => signInWithGoogle().catch(() => undefined)}>
        войти
      </button>
    );
  }
  if (!viewerConsentLoaded) return <span className="muted track-vote-cta">…</span>;
  if (!viewerConsentedAt) {
    return (
      <button type="button" className="track-vote-cta" onClick={requestConsent}>
        принять условия
      </button>
    );
  }

  return (
    <div className="track-viewer">
      <input
        type="text"
        inputMode="decimal"
        pattern="[0-9.,]*"
        maxLength={4}
        value={draftText}
        placeholder="0.0"
        onChange={(event) => {
          const raw = event.target.value.replace(/[^0-9.,]/g, '');
          setDraftText(raw);
          if (raw === '') {
            setDraftScore(0);
            setTouched(true);
            return;
          }
          const num = Number(raw.replace(',', '.'));
          if (Number.isNaN(num)) return;
          const clamped = clampScore(num, maxScore);
          setDraftScore(clamped);
          setTouched(true);
        }}
        onBlur={() => {
          if (draftText === '' || Number.isNaN(Number(draftText.replace(',', '.')))) {
            setDraftText(draftScore > 0 ? draftScore.toFixed(1) : '');
          } else {
            setDraftText(draftScore.toFixed(1));
          }
        }}
        className={`vote-input ${touched ? 'vote-input-touched' : ''} ${draftScore > 0 ? scoreClass(draftScore) : ''}`}
        aria-label={`Твоя оценка треку ${position}`}
      />
      {error && <span className="track-vote-error">{error}</span>}
    </div>
  );
});

type BattleVoteHandle = {
  saveIfTouched: () => Promise<void>;
};

const BattleVoteBlock = forwardRef<BattleVoteHandle, {
  voteKey: string;
  sideALabel: string;
  sideBLabel: string;
  mySide: BattleSide | null;
  allVotes: AllVote[];
  roundIndex: number | null;
  compact?: boolean;
  saveVote: (side: BattleSide) => Promise<void>;
  onTouchedChange: (key: string, touched: boolean) => void;
}>(function BattleVoteBlock({ voteKey, sideALabel, sideBLabel, mySide, allVotes, roundIndex, compact, saveVote, onTouchedChange }, ref) {
  const { user, viewerConsentedAt, viewerConsentLoaded, signInWithGoogle } = useStore();
  const [draftSide, setDraftSide] = useState<BattleSide | null>(mySide);
  const [touched, setTouchedState] = useState(false);
  const [error, setError] = useState('');
  const draftRef = useRef(draftSide);
  draftRef.current = draftSide;
  const touchedRef = useRef(touched);
  touchedRef.current = touched;

  const savedSideRef = useRef(mySide);
  savedSideRef.current = mySide;

  const setTouched = (value: boolean) => {
    touchedRef.current = value;
    setTouchedState(value);
    onTouchedChange(voteKey, value);
  };

  useEffect(() => {
    setDraftSide(mySide);
    touchedRef.current = false;
    setTouchedState(false);
    onTouchedChange(voteKey, false);
  }, [mySide]);

  useImperativeHandle(ref, () => ({
    saveIfTouched: async () => {
      const side = draftRef.current;
      const saved = savedSideRef.current;
      const hasChange = touchedRef.current || (side != null && side !== saved);
      if (!hasChange || side == null) return;
      try {
        await saveVote(side);
        touchedRef.current = false;
        setTouchedState(false);
        onTouchedChange(voteKey, false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось сохранить');
        throw err;
      }
    },
  }), [saveVote, voteKey]);

  const requestConsent = () => window.dispatchEvent(new Event('r1f:request-consent'));
  const agg = aggregateBattle(allVotes, roundIndex);

  const renderOption = (side: BattleSide, label: string) => (
    <button
      key={side}
      type="button"
      className={`battle-vote-option ${draftSide === side ? 'on' : ''} ${touched && draftSide === side ? 'touched' : ''}`}
      onClick={() => {
        setDraftSide(side);
        setTouched(true);
      }}
      disabled={!user || !viewerConsentedAt}
    >
      {label}
    </button>
  );

  return (
    <div className={`battle-vote ${compact ? 'battle-vote-compact' : ''}`}>
      <div className="battle-vote-options">
        {renderOption('a', sideALabel)}
        {renderOption('draw', 'Ничья')}
        {renderOption('b', sideBLabel)}
      </div>
      {agg ? (
        <div className="battle-vote-agg">
          {compact ? 'Зрители: ' : 'Зрители: '}<b>{sideALabel}</b> {Math.round((agg.counts.a / agg.total) * 100)}% ·
          {' '}<b>ничья</b> {Math.round((agg.counts.draw / agg.total) * 100)}% ·
          {' '}<b>{sideBLabel}</b> {Math.round((agg.counts.b / agg.total) * 100)}%
          {' '}<span className="muted">({agg.total})</span>
        </div>
      ) : (
        !compact && <div className="battle-vote-agg muted">Голосов ещё нет</div>
      )}
      {!user && !compact && (
        <button type="button" className="track-vote-cta" onClick={() => signInWithGoogle().catch(() => undefined)}>войти, чтобы голосовать</button>
      )}
      {user && viewerConsentLoaded && !viewerConsentedAt && !compact && (
        <button type="button" className="track-vote-cta" onClick={requestConsent}>принять условия</button>
      )}
      {error && <span className="track-vote-error">{error}</span>}
    </div>
  );
});

function ItemPage() {
  const { slug } = useParams();
  const { items, admin, loading, error } = useStore();
  const placeholderItemId = '00000000-0000-0000-0000-000000000000';
  const itemForVotes = items.find((entry) => entry.slug === slug);
  const votes = useItemVotes(itemForVotes?.id ?? placeholderItemId);
  const albumHandle = useRef<AlbumVoteHandle | null>(null);
  const trackHandles = useRef<Map<number, TrackSliderHandle | null>>(new Map());
  const battleHandles = useRef<Map<string, BattleVoteHandle | null>>(new Map());
  const [touchedTracks, setTouchedTracks] = useState<Set<number>>(new Set());
  const [touchedBattles, setTouchedBattles] = useState<Set<string>>(new Set());
  const [albumTouched, setAlbumTouched] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [saveAllError, setSaveAllError] = useState('');
  const [saveAllOk, setSaveAllOk] = useState(false);
  const handleTrackTouched = (position: number, touched: boolean) => {
    setTouchedTracks((prev) => {
      const has = prev.has(position);
      if (touched === has) return prev;
      const next = new Set(prev);
      if (touched) next.add(position);
      else next.delete(position);
      return next;
    });
  };
  const handleBattleTouched = (key: string, touched: boolean) => {
    setTouchedBattles((prev) => {
      const has = prev.has(key);
      if (touched === has) return prev;
      const next = new Set(prev);
      if (touched) next.add(key);
      else next.delete(key);
      return next;
    });
  };
  const pendingCount = touchedTracks.size + touchedBattles.size + (albumTouched ? 1 : 0);
  const saveAll = async () => {
    if (savingAll) return;
    setSavingAll(true);
    setSaveAllError('');
    setSaveAllOk(false);
    const results: Array<{ ok: true } | { ok: false; reason: unknown }> = [];
    const runHandle = async (handle: { saveIfTouched: () => Promise<void> } | null | undefined) => {
      if (!handle) return;
      try {
        await handle.saveIfTouched();
        results.push({ ok: true });
      } catch (reason) {
        results.push({ ok: false, reason });
      }
    };
    try {
      // album и battle пишут в одну строку (item_id, track_position=null, round_index=null),
      // делаем последовательно чтобы не словить unique violation между insert одной операции
      // и insert другой.
      await runHandle(albumHandle.current);
      for (const handle of battleHandles.current.values()) {
        await runHandle(handle);
      }
      // Треки — каждый своя строка по track_position, можно параллельно для скорости.
      await Promise.all([...trackHandles.current.values()].map((handle) => runHandle(handle)));
      const failed = results.filter((r) => !r.ok) as Array<{ ok: false; reason: unknown }>;
      if (failed.length > 0) {
        const firstMsg = failed[0].reason instanceof Error ? failed[0].reason.message : '';
        setSaveAllError(`Не удалось сохранить (${failed.length}). ${firstMsg}`.trim());
      } else {
        setSaveAllOk(true);
        window.setTimeout(() => setSaveAllOk(false), 2500);
      }
    } finally {
      setSavingAll(false);
    }
  };
  if (loading) return <ItemPageSkeleton />;
  if (error) return <main><div className="empty">Ошибка загрузки: {error}</div></main>;
  const item = itemForVotes;
  if (!item || !item.published) return <main><div className="empty">Запись не найдена или ещё не опубликована.</div></main>;
  const originals = item.links.filter((link) => link.kind === 'original');
  const reactions = item.links.filter((link) => link.kind === 'reaction');
  const battle = item.metadata?.battle;
  const supportsViewerVote = item.type === 'album' || item.type === 'track' || item.type === 'battle';
  const isAlbum = item.type === 'album';

  return (
    <main>
      {(() => {
        const heroAgg = isAlbum
          ? aggregateAlbum(votes.state.allVotes, item)
          : aggregateSingleScore(votes.state.allVotes);
        return (
          <section className="detail-hero">
            <div className="detail-cover"><CoverImage url={item.coverUrl} /></div>
            <div className="detail-hero-body">
              <p className="eyebrow">{itemCredit(item)}</p>
              <h1>{item.title}</h1>
              <div className="detail-hero-scores">
                <div className="vote-side">
                  <span className={`${scoreClass(item.finalScore)} vote-side-badge`}>{item.finalScore.toFixed(1)}</span>
                  <span className="vote-side-label">R1F</span>
                </div>
                {supportsViewerVote && (
                  <div className="vote-side">
                    {heroAgg ? (
                      <span className={`${scoreClass(heroAgg.avg)} vote-side-badge`}>{heroAgg.avg.toFixed(1)}</span>
                    ) : (
                      <span className="vote-side-badge track-badge-empty">—</span>
                    )}
                    <span className="vote-side-label">Зрители{heroAgg ? ` · ${heroAgg.count}` : ''}</span>
                  </div>
                )}
              </div>
              {bestAlbumTracksLabel(item) && (
                <p className="lead detail-hero-best"><Star size={15} fill="#ffe600" stroke="#ffe600" /> {bestAlbumTracksLabel(item)}</p>
              )}
              {item.description && !bestAlbumTracksLabel(item) && <p className="lead">{item.description}</p>}
              <p className="detail-hero-meta">{item.releaseYear || 'Без года'} · {item.genre || 'Без жанра'}{item.reviewedAt ? ` · оценено ${formatMSKDate(item.reviewedAt)}` : ''}</p>
              {admin && <p><Link className="button detail-edit-link" to={`/admin/edit/${item.id}`}><Edit3 size={16} /> Редактировать оценку</Link></p>}
            </div>
          </section>
        );
      })()}
      {supportsViewerVote && (
        <AlbumVotePanel
          ref={albumHandle}
          item={item}
          votes={votes.state}
          save={votes.saveAlbum}
          onTouchedChange={setAlbumTouched}
        />
      )}
      <section className="columns">
        <div className="panel">
          {item.type === 'battle' ? (
            <>
              <h2>Раунды</h2>
              <BattleWinnerSummary battle={battle} />
              {(battle?.rounds ?? []).map((round) => {
                const voteKey = `round:${round.position}`;
                return (
                  <div className="battle-round-view" key={round.id}>
                    <b>Раунд {round.position}</b>
                    <span>{battle?.sideA || 'A'}: {round.scoreA === '' || round.scoreA == null ? '-' : round.scoreA} · {battle?.sideB || 'B'}: {round.scoreB === '' || round.scoreB == null ? '-' : round.scoreB}</span>
                    <span>Раунд за: {round.winner === 'a' ? battle?.sideA || 'A' : round.winner === 'b' ? battle?.sideB || 'B' : 'ничья / спорно'}</span>
                    {round.comment && <p>{round.comment}</p>}
                    {supabase && votes.state.loaded && (
                      <BattleVoteBlock
                        ref={(handle) => {
                          if (handle) battleHandles.current.set(voteKey, handle);
                          else battleHandles.current.delete(voteKey);
                        }}
                        voteKey={voteKey}
                        sideALabel={battle?.sideA || 'A'}
                        sideBLabel={battle?.sideB || 'B'}
                        mySide={votes.state.battleRounds.get(round.position) ?? null}
                        allVotes={votes.state.allVotes}
                        roundIndex={round.position}
                        compact
                        saveVote={(side) => votes.saveBattleRound(round.position, side)}
                        onTouchedChange={handleBattleTouched}
                      />
                    )}
                  </div>
                );
              })}
              {!battle?.rounds?.length && <p className="muted">Раунды пока не добавлены.</p>}
              {supabase && votes.state.loaded && (
                <div className="battle-vote-wrap">
                  <h3>Кто, по-твоему, победил?</h3>
                  <BattleVoteBlock
                    ref={(handle) => {
                      if (handle) battleHandles.current.set('final', handle);
                      else battleHandles.current.delete('final');
                    }}
                    voteKey="final"
                    sideALabel={battle?.sideA || 'A'}
                    sideBLabel={battle?.sideB || 'B'}
                    mySide={votes.state.battleFinal}
                    allVotes={votes.state.allVotes}
                    roundIndex={null}
                    saveVote={votes.saveBattleFinal}
                    onTouchedChange={handleBattleTouched}
                  />
                  {votes.state.loaded && (
                    <div className="vote-save-bar">
                      <button type="button" onClick={saveAll} disabled={savingAll || pendingCount === 0} className="vote-save-button">
                        {savingAll ? 'Сохраняю…' : pendingCount === 0 ? 'Нет изменений' : `Сохранить мой голос`}
                      </button>
                      {saveAllOk && <span className="viewer-vote-saved">Сохранено ✓</span>}
                      {saveAllError && <span className="track-vote-error">{saveAllError}</span>}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : isAlbum ? (
            <>
              <div className="tracklist-head">
                <h2>Треклист</h2>
                <div className="tracklist-legend">
                  {!admin && (
                    <>
                      <span>R1F</span>
                      <span className="track-divider" aria-hidden="true" />
                    </>
                  )}
                  <span>Ты</span>
                  <span className="track-divider" aria-hidden="true" />
                  <span>Все</span>
                </div>
              </div>
              {item.tracks.map((track) => {
                const excluded = track.score === '-';
                const viewerScore = votes.state.tracks.get(track.position) ?? null;
                const streamerScoreIsNumber = typeof track.score === 'number';
                const viewerBest = votes.state.bestTracks.has(track.position);
                const canVote = Boolean(votes.state.loaded);
                return (
                  <div className={`track ${excluded ? 'track-excluded' : ''}`} key={track.id}>
                    <span className="track-star-cell">
                      {track.isBest && <Star size={14} fill="#ffe600" stroke="#ffe600" aria-label="Лучший по R1Fmabes" />}
                    </span>
                    <span className="track-title">{track.position}. {track.title}</span>
                    <div className="track-scores">
                      {excluded ? (
                        <span className="track-locked track-locked-wide"><Lock size={12} /> интро / скит</span>
                      ) : (
                        <>
                          {!admin && (
                            <>
                              {streamerScoreIsNumber ? (
                                <span className={`${scoreClass(track.score as number)} track-badge`}>{Number(track.score).toFixed(1)}</span>
                              ) : (
                                <span className="track-badge track-badge-empty">—</span>
                              )}
                              <span className="track-divider" aria-hidden="true" />
                            </>
                          )}
                          {votes.state.loaded && (
                            <TrackVoteSlider
                              ref={(handle) => {
                                if (handle) trackHandles.current.set(track.position, handle);
                                else trackHandles.current.delete(track.position);
                              }}
                              item={item}
                              position={track.position}
                              currentScore={viewerScore}
                              saveTrack={(score) => votes.saveTrack(track.position, score)}
                              onTouchedChange={handleTrackTouched}
                            />
                          )}
                          <span className="track-divider" aria-hidden="true" />
                          {(() => {
                            const agg = aggregateTrack(votes.state.allVotes, track.position);
                            if (!agg) return <span className="track-badge track-badge-empty" title="Голосов ещё нет">—</span>;
                            return (
                              <span className={`${scoreClass(agg.avg)} track-badge`} title={`${agg.count} ${agg.count === 1 ? 'голос' : agg.count < 5 ? 'голоса' : 'голосов'}`}>
                                {agg.avg.toFixed(1)}
                              </span>
                            );
                          })()}
                          <button
                            type="button"
                            className={`track-star-btn ${viewerBest ? 'on' : ''}`}
                            onClick={() => canVote && votes.toggleBest(track.position).catch(() => undefined)}
                            disabled={!canVote}
                            title={viewerBest ? 'Убрать из «моих лучших»' : 'Отметить как мой лучший'}
                            aria-label="Мой лучший трек"
                          >
                            <Star size={16} fill={viewerBest ? '#00e5ff' : 'none'} stroke={viewerBest ? '#00e5ff' : 'rgba(255,255,255,0.35)'} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
              {votes.state.loaded && supabase && (
                <div className="vote-save-bar">
                  <button type="button" onClick={saveAll} disabled={savingAll || pendingCount === 0} className="vote-save-button">
                    {savingAll ? 'Сохраняю…' : pendingCount === 0 ? 'Нет изменений' : `Сохранить мои оценки (${pendingCount})`}
                  </button>
                  {saveAllOk && <span className="viewer-vote-saved">Сохранено ✓</span>}
                  {saveAllError && <span className="track-vote-error">{saveAllError}</span>}
                </div>
              )}
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
        <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={safeMarkdownUrl}>{item.review || 'Рецензия пока не добавлена.'}</ReactMarkdown>
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

function ItemPageSkeleton() {
  return (
    <main aria-hidden="true">
      <section className="detail-hero">
        <SkeletonBlock className="detail-cover" />
        <div className="detail-skeleton-copy">
          <SkeletonBlock className="skeleton-line short" />
          <SkeletonBlock className="skeleton-line hero-title" />
          <SkeletonBlock className="skeleton-line medium" />
          <SkeletonBlock className="skeleton-score big" />
          <SkeletonBlock className="skeleton-line long" />
        </div>
      </section>
      <section className="columns">
        <div className="panel skeleton-panel">
          <SkeletonBlock className="skeleton-line title" />
          {Array.from({ length: 6 }).map((_, index) => <SkeletonBlock className="skeleton-line long" key={index} />)}
        </div>
        <div className="panel skeleton-panel">
          <SkeletonBlock className="skeleton-line title" />
          <SkeletonBlock className="skeleton-line medium" />
          <SkeletonBlock className="skeleton-line medium" />
        </div>
      </section>
    </main>
  );
}

function AdminRowsSkeleton() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, index) => (
        <div className="admin-row skeleton-admin-row" key={index} aria-hidden="true">
          <SkeletonBlock className="skeleton-admin-thumb" />
          <div className="admin-row-main">
            <SkeletonBlock className="skeleton-line medium" />
            <SkeletonBlock className="skeleton-line long" />
          </div>
          <div className="admin-actions">
            <SkeletonBlock className="skeleton-button" />
            <SkeletonBlock className="skeleton-button" />
          </div>
        </div>
      ))}
    </>
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
  const [activeStatus, setActiveStatus] = useState<'published' | 'draft'>('published');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'new' | 'best' | 'worst'>('new');
  const [activeTournament, setActiveTournament] = useState<string>('');
  const [activeSeason, setActiveSeason] = useState<string>('');
  const typeItems = items.filter((item) => item.type === activeType);
  const battleTournaments = activeType === 'battle'
    ? Array.from(new Set(typeItems.flatMap((item) => item.metadata?.battle?.tournament ? [item.metadata.battle.tournament] : []))).sort()
    : [];
  const tournamentFilteredItems = activeType === 'battle' && activeTournament
    ? typeItems.filter((item) => item.metadata?.battle?.tournament === activeTournament)
    : typeItems;
  const battleSeasons = activeType === 'battle' && activeTournament
    ? Array.from(new Set(tournamentFilteredItems.flatMap((item) => item.metadata?.battle?.season ? [item.metadata.battle.season] : []))).sort()
    : [];
  const seasonFilteredItems = activeType === 'battle' && activeTournament && activeSeason
    ? tournamentFilteredItems.filter((item) => item.metadata?.battle?.season === activeSeason)
    : tournamentFilteredItems;
  const filteredItems = seasonFilteredItems
    .filter((item) => `${item.title} ${item.artist} ${item.participants} ${item.genre}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => sort === 'new' ? b.updatedAt.localeCompare(a.updatedAt) : sort === 'best' ? b.finalScore - a.finalScore : a.finalScore - b.finalScore);
  const publishedItems = filteredItems.filter((item) => item.published);
  const draftItems = filteredItems.filter((item) => !item.published);
  const visibleItems = activeStatus === 'published' ? publishedItems : draftItems;
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
        <div className="admin-head-actions">
          <Link className="ghost" to="/admin/auctions">Аукционы и правила</Link>
          <Link className="button" to="/admin/new"><Plus size={16} /> Начать оценку</Link>
        </div>
      </section>
      <section className="filters">
        <label><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по названию, артисту или жанру" /></label>
        <select value={sort} onChange={(event) => setSort(event.target.value as 'new' | 'best' | 'worst')}>
          <option value="new">Новые</option>
          <option value="best">Лучшие</option>
          <option value="worst">Худшие</option>
        </select>
      </section>
      <section className="catalog-tabs" aria-label="Раздел админки">
        <button className={activeType === 'album' ? 'active' : ''} onClick={() => { setActiveType('album'); setActiveTournament(''); setActiveSeason(''); }}>Альбомы <span>{counts.album}</span></button>
        <button className={activeType === 'battle' ? 'active' : ''} onClick={() => { setActiveType('battle'); setActiveTournament(''); setActiveSeason(''); }}>Баттлы <span>{counts.battle}</span></button>
        <button className={activeType === 'track' ? 'active' : ''} onClick={() => { setActiveType('track'); setActiveTournament(''); setActiveSeason(''); }}>Треки <span>{counts.track}</span></button>
      </section>
      {activeType === 'battle' && battleTournaments.length > 0 && (
        <section className="catalog-tabs catalog-subtabs" aria-label="Площадка баттла">
          <button className={activeTournament === '' ? 'active' : ''} onClick={() => { setActiveTournament(''); setActiveSeason(''); }}>Все площадки <span>{typeItems.length}</span></button>
          {battleTournaments.map((t) => (
            <button key={t} className={activeTournament === t ? 'active' : ''} onClick={() => { setActiveTournament(t); setActiveSeason(''); }}>
              {t} <span>{typeItems.filter((item) => item.metadata?.battle?.tournament === t).length}</span>
            </button>
          ))}
        </section>
      )}
      {activeType === 'battle' && activeTournament && battleSeasons.length > 0 && (
        <section className="catalog-tabs catalog-subtabs" aria-label="Сезон">
          <button className={activeSeason === '' ? 'active' : ''} onClick={() => setActiveSeason('')}>Все сезоны <span>{tournamentFilteredItems.length}</span></button>
          {battleSeasons.map((s) => (
            <button key={s} className={activeSeason === s ? 'active' : ''} onClick={() => setActiveSeason(s)}>
              {s} <span>{tournamentFilteredItems.filter((item) => item.metadata?.battle?.season === s).length}</span>
            </button>
          ))}
        </section>
      )}
      <section className="catalog-tabs admin-status-tabs" aria-label="Статус записи">
        <button className={activeStatus === 'published' ? 'active' : ''} onClick={() => setActiveStatus('published')}>Опубликовано <span>{publishedItems.length}</span></button>
        <button className={activeStatus === 'draft' ? 'active' : ''} onClick={() => setActiveStatus('draft')}>Черновики <span>{draftItems.length}</span></button>
      </section>
      <section className="panel table">
        {loading && <AdminRowsSkeleton />}
        {error && <div className="empty">Ошибка загрузки: {error}</div>}
        {!loading && !error && !filteredItems.length && <div className="empty">В этом разделе записей пока нет.</div>}
        {!loading && !error && filteredItems.length > 0 && !visibleItems.length && (
          <div className="empty">{activeStatus === 'published' ? 'Опубликованных записей по этим фильтрам нет.' : 'Черновиков по этим фильтрам нет.'}</div>
        )}
        {!loading && !error && visibleItems.map((item) => (
          <div className="admin-row" key={item.id}>
            <img src={displayCoverUrl(item.coverUrl)} alt="" />
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

function AuctionsPage() {
  const { auctions, auctionsLoading, auctionsError, admin, saveAuction, deleteAuction } = useStore();
  const [activeCategory, setActiveCategory] = useState<AuctionCategory>('album');
  const [editing, setEditing] = useState<AuctionItem | null>(null);
  const counts = auctionCategoryOrder.reduce((acc, category) => {
    acc[category] = auctions.filter((item) => item.category === category).length;
    return acc;
  }, {} as Record<AuctionCategory, number>);
  const list = auctions.filter((item) => item.category === activeCategory);

  const startNew = () => {
    setEditing({
      id: crypto.randomUUID(),
      category: activeCategory,
      title: '',
      artist: '',
      amount: 0,
      note: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  };

  const handleSave = async () => {
    if (!editing || !editing.title.trim()) return;
    await saveAuction({ ...editing, title: editing.title.trim(), artist: editing.artist?.trim() || undefined, note: editing.note?.trim() || undefined });
    setEditing(null);
  };

  const handleDelete = async (item: AuctionItem) => {
    if (!window.confirm(`Удалить «${item.title}» из очереди? Это не вернёшь.`)) return;
    await deleteAuction(item.id);
  };

  return (
    <main className="auctions">
      <section className="auctions-head">
        <p className="eyebrow">Очередь на разбор</p>
        <h1>Аукционы</h1>
        <p className="lead">Зрители скидывают донаты — чем больше собрано, тем раньше разбор. После того как R1Fmabes разобрал — запись уходит в каталог с оценкой.</p>
        <div className="auctions-meta">
          <span>Всего в очереди: <b>{auctions.length}</b></span>
          <Link to="/auctions/rules" className="auctions-rules-link">Правила →</Link>
        </div>
      </section>

      <section className="type-tabs" aria-label="Категории аукционов">
        {auctionCategoryOrder.map((category) => (
          <button key={category} className={activeCategory === category ? 'on' : ''} onClick={() => setActiveCategory(category)}>
            {auctionCategoryLabel[category]} <span>{counts[category]}</span>
          </button>
        ))}
      </section>

      {admin && (
        <div className="auction-admin-bar">
          <button onClick={startNew}><Plus size={16} /> Добавить в «{auctionCategoryLabel[activeCategory].toLowerCase()}»</button>
        </div>
      )}

      {auctionsLoading && <div className="empty">Загружаем очередь...</div>}
      {auctionsError && <div className="empty">Ошибка загрузки: {auctionsError}</div>}

      {!auctionsLoading && !auctionsError && (
        list.length === 0 ? (
          <p className="auction-empty">В категории «{auctionCategoryLabel[activeCategory].toLowerCase()}» пока пусто.</p>
        ) : (
          <table className="auction-table">
            <thead>
              <tr>
                <th className="auction-rank">#</th>
                <th>Название</th>
                <th className="auction-amount">Сумма</th>
                {admin && <th className="auction-actions-col">Действия</th>}
              </tr>
            </thead>
            <tbody>
              {list.map((item, index) => {
                const stale = auctionStaleLevel(item);
                const staleLabel = auctionStaleLabel(item);
                return (
                  <tr key={item.id} className={stale !== 'fresh' ? `stale-${stale}` : ''}>
                    <td className="auction-rank">{index + 1}</td>
                    <td>
                      <div className="auction-title">
                        {auctionCategoryHasArtist[item.category] && item.artist
                          ? <span><b>{item.artist}</b> — {item.title}</span>
                          : <b>{item.title}</b>}
                      </div>
                      {staleLabel && <div className={`auction-age auction-age-${stale}`}>{staleLabel}</div>}
                      {item.note && <div className="auction-note">{item.note}</div>}
                    </td>
                    <td className="auction-amount">{item.amount.toLocaleString('ru-RU')} ₽</td>
                    {admin && (
                      <td className="auction-actions-col">
                        <div className="auction-row-actions">
                          <button className="ghost icon-btn" title="Изменить" onClick={() => setEditing({ ...item })}><Edit3 size={16} /></button>
                          <button className="danger icon-btn" title="Удалить" onClick={() => handleDelete(item)}><Trash2 size={16} /></button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )
      )}

      {editing && (
        <AuctionEditorModal
          item={editing}
          isNew={!auctions.some((a) => a.id === editing.id)}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
    </main>
  );
}

function AuctionEditorModal({ item, isNew, onChange, onClose, onSave }: {
  item: AuctionItem;
  isNew: boolean;
  onChange: (item: AuctionItem) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2>{isNew ? 'Добавить' : 'Изменить'} — {auctionCategoryLabel[item.category].toLowerCase()}</h2>
        <div className="modal-grid">
          <label>
            Категория
            <select value={item.category} onChange={(event) => onChange({ ...item, category: event.target.value as AuctionCategory })}>
              {auctionCategoryOrder.map((category) => (
                <option key={category} value={category}>{auctionCategoryLabel[category]}</option>
              ))}
            </select>
          </label>
          {auctionCategoryHasArtist[item.category] && (
            <label>
              Артист
              <input value={item.artist ?? ''} onChange={(event) => onChange({ ...item, artist: event.target.value })} placeholder="например, Каспийский Груз" />
            </label>
          )}
          <label>
            Название
            <input value={item.title} onChange={(event) => onChange({ ...item, title: event.target.value })} placeholder="что разбирать" />
          </label>
          <label>
            Сумма донатов, ₽
            <input type="number" min={0} step={50} value={item.amount} onChange={(event) => onChange({ ...item, amount: Number(event.target.value) || 0 })} />
          </label>
          <label className="modal-full">
            Комментарий (опционально)
            <input value={item.note ?? ''} onChange={(event) => onChange({ ...item, note: event.target.value })} placeholder="например, пожелание зрителя" />
          </label>
        </div>
        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>Отмена</button>
          <button onClick={onSave} disabled={!item.title.trim()}><Save size={16} /> Сохранить</button>
        </div>
      </div>
    </div>
  );
}

function AuctionRulesPage() {
  const { auctionRules, auctionsLoading, admin } = useStore();
  return (
    <main>
      <section className="rules-head">
        <p className="eyebrow">Аукционы</p>
        <h1>Правила</h1>
        {admin && <Link to="/admin/auctions" className="auctions-rules-link">Редактировать →</Link>}
      </section>
      <section className="panel">
        {auctionsLoading && !auctionRules ? (
          <p className="muted">Загружаем правила...</p>
        ) : auctionRules?.content ? (
          <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={safeMarkdownUrl}>{auctionRules.content}</ReactMarkdown></div>
        ) : (
          <p className="muted">Правила пока не заполнены.</p>
        )}
      </section>
    </main>
  );
}

function AuthBadge() {
  const { user, admin, signInWithGoogle, signOut } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menuOpen]);

  if (!user) {
    return (
      <button
        className="ghost"
        disabled={busy}
        onClick={async () => {
          try {
            setBusy(true);
            await signInWithGoogle();
          } catch (error) {
            alert((error as Error).message || 'Не удалось начать вход через Google');
            setBusy(false);
          }
        }}
      >
        {busy ? 'Открываю...' : 'Войти'}
      </button>
    );
  }

  const meta = (user.user_metadata ?? {}) as { full_name?: string; name?: string; avatar_url?: string; picture?: string };
  const displayName = meta.full_name || meta.name || user.email || 'Аккаунт';
  const avatarUrl = meta.avatar_url || meta.picture || '';
  const initial = displayName.trim().charAt(0).toUpperCase() || 'A';

  return (
    <div className="auth-badge" onClick={(event) => event.stopPropagation()}>
      <button className="auth-trigger" onClick={() => setMenuOpen((value) => !value)}>
        {avatarUrl
          ? <img className="auth-avatar" src={avatarUrl} alt="" referrerPolicy="no-referrer" />
          : <span className="auth-avatar auth-avatar-fallback">{initial}</span>}
        <span className="auth-name">{displayName}</span>
      </button>
      {menuOpen && (
        <div className="auth-menu">
          {admin && <Link to="/admin" className="auth-menu-item" onClick={() => setMenuOpen(false)}>Админка</Link>}
          <button
            className="auth-menu-item auth-menu-signout"
            onClick={async () => {
              setMenuOpen(false);
              await signOut();
            }}
          >
            <LogOut size={14} /> Выйти
          </button>
        </div>
      )}
    </div>
  );
}

function PrivacyPage() {
  return (
    <main>
      <section className="panel legal-panel">
        <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={safeMarkdownUrl}>{privacyMarkdown}</ReactMarkdown></div>
      </section>
    </main>
  );
}

function TermsPage() {
  return (
    <main>
      <section className="panel legal-panel">
        <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={safeMarkdownUrl}>{termsMarkdown}</ReactMarkdown></div>
      </section>
    </main>
  );
}

function AdminAuctionsPage() {
  const { auctions, auctionRules, saveAuction, deleteAuction, saveAuctionRules, addAuctionAmount } = useStore();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<AuctionItem | null>(null);
  const [addingAmountFor, setAddingAmountFor] = useState<AuctionItem | null>(null);
  const [activeCategory, setActiveCategory] = useState<AuctionCategory>('album');
  const [rulesDraft, setRulesDraft] = useState<string>('');
  const [rulesSaving, setRulesSaving] = useState(false);
  const [rulesSavedAt, setRulesSavedAt] = useState<string>('');

  const counts = auctionCategoryOrder.reduce((acc, category) => {
    acc[category] = auctions.filter((item) => item.category === category).length;
    return acc;
  }, {} as Record<AuctionCategory, number>);
  const activeList = auctions.filter((item) => item.category === activeCategory).sort((a, b) => b.amount - a.amount);

  useEffect(() => {
    if (auctionRules) setRulesDraft(auctionRules.content);
  }, [auctionRules?.scope]);

  const startNew = (category: AuctionCategory) => {
    setEditing({
      id: crypto.randomUUID(),
      category,
      title: '',
      artist: '',
      amount: 0,
      note: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  };

  const handleSave = async () => {
    if (!editing || !editing.title.trim()) return;
    await saveAuction({ ...editing, title: editing.title.trim(), artist: editing.artist?.trim() || undefined, note: editing.note?.trim() || undefined });
    setEditing(null);
  };

  const handleDelete = async (item: AuctionItem) => {
    if (!window.confirm(`Удалить «${item.title}» из очереди? Это не вернёшь.`)) return;
    await deleteAuction(item.id);
  };

  const handleRulesSave = async () => {
    setRulesSaving(true);
    try {
      await saveAuctionRules(rulesDraft);
      setRulesSavedAt(formatMSKTime(new Date()) + ' МСК');
    } finally {
      setRulesSaving(false);
    }
  };

  return (
    <main>
      <section className="admin-head">
        <div>
          <p className="eyebrow">Управление</p>
          <h1>Аукционы</h1>
        </div>
        <Link to="/auctions" className="ghost">Публичная страница</Link>
      </section>

      <section className="panel">
        <h2>Правила</h2>
        <p className="muted">Markdown поддерживается. Появится на странице «Правила».</p>
        <textarea value={rulesDraft} onChange={(event) => setRulesDraft(event.target.value)} className="rules-textarea" />
        <div className="rules-save">
          <button onClick={handleRulesSave} disabled={rulesSaving}><Save size={16} /> Сохранить правила</button>
          {rulesSavedAt && <span className="muted">сохранено в {rulesSavedAt}</span>}
        </div>
      </section>

      <section className="type-tabs" aria-label="Категории аукционов">
        {auctionCategoryOrder.map((category) => (
          <button key={category} className={activeCategory === category ? 'on' : ''} onClick={() => setActiveCategory(category)}>
            {auctionCategoryLabel[category]} <span>{counts[category]}</span>
          </button>
        ))}
      </section>

      <section className="panel admin-auction-block">
        <div className="admin-auction-head">
          <h2>{auctionCategoryLabel[activeCategory]} <span className="muted">({activeList.length})</span></h2>
          <div className="admin-auction-head-actions">
            <button className="ghost" onClick={() => navigate(`/admin/auctions/wheel?category=${activeCategory}`)}>
              <RotateCw size={16} /> Открыть колесо
            </button>
            <button onClick={() => startNew(activeCategory)}><Plus size={16} /> Добавить</button>
          </div>
        </div>
        {activeList.length === 0 ? (
          <p className="muted">Пока ничего нет.</p>
        ) : (
          <div className="admin-auction-list">
            {activeList.map((item) => {
              const stale = auctionStaleLevel(item);
              const staleLabel = auctionStaleLabel(item);
              return (
                <div className={`admin-auction-row${stale !== 'fresh' ? ` stale-${stale}` : ''}`} key={item.id}>
                  <div className="admin-auction-main">
                    <strong>
                      {auctionCategoryHasArtist[item.category] && item.artist
                        ? `${item.artist} — ${item.title}`
                        : item.title}
                    </strong>
                    {staleLabel && <small className={`auction-age-${stale}`}>{staleLabel}</small>}
                    {item.note && <small>{item.note}</small>}
                  </div>
                  <div className="admin-auction-amount">{item.amount.toLocaleString('ru-RU')} ₽</div>
                  <div className="admin-actions">
                    <button className="ghost icon-btn" title="Добавить сумму" onClick={() => setAddingAmountFor(item)}><Plus size={16} /></button>
                    <button className="ghost" onClick={() => setEditing({ ...item })}><Edit3 size={16} /> Изменить</button>
                    <button className="danger" onClick={() => handleDelete(item)}><Trash2 size={16} /> Удалить</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h2>{auctions.some((a) => a.id === editing.id) ? 'Редактировать' : 'Добавить'} — {auctionCategoryLabel[editing.category].toLowerCase().replace(/ы$/, '')}</h2>
            <div className="modal-grid">
              <label>
                Категория
                <select value={editing.category} onChange={(event) => setEditing({ ...editing, category: event.target.value as AuctionCategory })}>
                  {auctionCategoryOrder.map((category) => (
                    <option key={category} value={category}>{auctionCategoryLabel[category]}</option>
                  ))}
                </select>
              </label>
              {auctionCategoryHasArtist[editing.category] && (
                <label>
                  Артист
                  <input value={editing.artist ?? ''} onChange={(event) => setEditing({ ...editing, artist: event.target.value })} placeholder="например, Каспийский Груз" />
                </label>
              )}
              <label>
                Название
                <input value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} placeholder="что разбирать" />
              </label>
              <label>
                Сумма донатов, ₽
                <input type="number" min={0} step={50} value={editing.amount} onChange={(event) => setEditing({ ...editing, amount: Number(event.target.value) || 0 })} />
              </label>
              <label className="modal-full">
                Комментарий (опционально)
                <input value={editing.note ?? ''} onChange={(event) => setEditing({ ...editing, note: event.target.value })} placeholder="например, пожелание зрителя" />
              </label>
            </div>
            <div className="modal-actions">
              <button className="ghost" onClick={() => setEditing(null)}>Отмена</button>
              <button onClick={handleSave} disabled={!editing.title.trim()}><Save size={16} /> Сохранить</button>
            </div>
          </div>
        </div>
      )}

      {addingAmountFor && (
        <AddAmountModal
          item={addingAmountFor}
          onClose={() => setAddingAmountFor(null)}
          onSubmit={async (delta) => {
            await addAuctionAmount(addingAmountFor.id, delta);
            setAddingAmountFor(null);
          }}
        />
      )}
    </main>
  );
}

function AddAmountModal({ item, onClose, onSubmit }: {
  item: AuctionItem;
  onClose: () => void;
  onSubmit: (delta: number) => Promise<void>;
}) {
  const [amountText, setAmountText] = useState('');
  const [error, setError] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const parsed = Number(amountText);
  const isValid = amountText.trim() !== '' && Number.isFinite(parsed) && Number.isInteger(parsed) && parsed > 0;

  const validationMessage = () => {
    if (!amountText.trim()) return 'Введите сумму';
    if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return 'Это не похоже на число';
    if (!Number.isInteger(parsed)) return 'Сумма должна быть целым числом, без копеек';
    if (parsed <= 0) return 'Сумма должна быть больше нуля';
    return '';
  };

  const handleSubmit = async () => {
    const message = validationMessage();
    if (message) {
      setError(message);
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await onSubmit(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось добавить сумму');
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={() => !submitting && onClose()}>
      <div className="modal add-amount-modal" onClick={(event) => event.stopPropagation()}>
        <h2>Добавить сумму</h2>
        <p className="add-amount-item-title">
          {auctionCategoryHasArtist[item.category] && item.artist ? <><b>{item.artist}</b> — {item.title}</> : <b>{item.title}</b>}
        </p>
        <p className="muted">Текущая сумма: <b>{item.amount.toLocaleString('ru-RU')} ₽</b></p>

        <div className="amount-quick-buttons">
          {[100, 300, 500, 1000].map((value) => (
            <button type="button" key={value} className="ghost" onClick={() => { setAmountText(String(value)); setError(''); }}>
              +{value.toLocaleString('ru-RU')} ₽
            </button>
          ))}
        </div>

        <label>
          Своя сумма, ₽
          <input
            type="number"
            min={1}
            step={1}
            value={amountText}
            onChange={(event) => { setAmountText(event.target.value); setError(''); }}
            placeholder="например, 250"
            autoFocus
          />
        </label>

        {isValid && (
          <p className="amount-preview">
            Было: <b>{item.amount.toLocaleString('ru-RU')} ₽</b> · Добавится: <b>{parsed.toLocaleString('ru-RU')} ₽</b> · Станет: <b>{(item.amount + parsed).toLocaleString('ru-RU')} ₽</b>
          </p>
        )}
        {error && <p className="form-error">{error}</p>}

        <div className="modal-actions">
          <button className="ghost" onClick={onClose} disabled={submitting}>Отмена</button>
          <button onClick={handleSubmit} disabled={submitting || !isValid}>
            {submitting ? 'Добавляю…' : <><Plus size={16} /> Добавить</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// Колесо аукциона — геометрия секторов. Угол 0° = верх (12 часов), растёт по часовой стрелке.
function wheelPolarPoint(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

function wheelWedgePath(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const p1 = wheelPolarPoint(cx, cy, r, startAngle);
  const p2 = wheelPolarPoint(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx},${cy} L ${p1.x.toFixed(2)},${p1.y.toFixed(2)} A ${r},${r} 0 ${largeArc} 1 ${p2.x.toFixed(2)},${p2.y.toFixed(2)} Z`;
}

const wheelSectorPalette = ['#4a2338', '#33263f', '#26283f', '#3a2a20', '#2c2f22', '#2a2138'];

function WheelCircle({ sectors, rotation, spinning }: { sectors: WheelParticipant[]; rotation: number; spinning: boolean }) {
  const cx = 150;
  const cy = 150;
  const r = 148;
  const n = Math.max(sectors.length, 1);
  const sectorAngle = 360 / n;
  return (
    <div className="wheel-circle-wrap">
      <div className="wheel-pointer" aria-hidden="true" />
      <div
        className="wheel-circle"
        style={{ transform: `rotate(${rotation}deg)`, transition: spinning ? 'transform 4.6s cubic-bezier(.15,.65,.2,1)' : 'none' }}
      >
        <svg viewBox="0 0 300 300" className="wheel-svg">
          {sectors.map((participant, index) => {
            const start = index * sectorAngle;
            const end = start + sectorAngle;
            return (
              <path
                key={participant.id}
                d={wheelWedgePath(cx, cy, r, start, end)}
                fill={wheelSectorPalette[index % wheelSectorPalette.length]}
                className="wheel-sector"
              />
            );
          })}
          <circle cx={cx} cy={cy} r={r} className="wheel-circle-outline" />
        </svg>
        {sectors.map((participant, index) => {
          const mid = index * sectorAngle + sectorAngle / 2;
          const cssAngle = mid - 90;
          const fullTitle = `${participant.artist ? participant.artist + ' — ' : ''}${participant.title} · ${participant.amount.toLocaleString('ru-RU')} ₽`;
          return (
            <div key={participant.id} className="wheel-sector-label" style={{ transform: `rotate(${cssAngle}deg) translateX(112px)` }}>
              <span className="wheel-sector-label-inner" style={{ transform: `rotate(${-cssAngle}deg)` }} title={fullTitle}>
                <span className="wheel-sector-label-title">{participant.title}</span>
                <span className="wheel-sector-label-amount">{participant.amount.toLocaleString('ru-RU')} ₽</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AdminWheelPage() {
  const { auctions, user } = useStore();
  const [searchParams] = useSearchParams();
  const rawCategory = searchParams.get('category');
  const category: AuctionCategory = (auctionCategoryOrder as string[]).includes(rawCategory ?? '')
    ? (rawCategory as AuctionCategory)
    : 'album';

  const [session, setSession] = useState<WheelSession | null>(null);
  const [participants, setParticipants] = useState<WheelParticipant[]>([]);
  const [rounds, setRounds] = useState<WheelRound[]>([]);
  const [sectorOrder, setSectorOrder] = useState<WheelParticipant[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>('');
  const sessionIdRef = useRef<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string>('');

  const [spinning, setSpinning] = useState(false);
  const [spinError, setSpinError] = useState<string>('');
  const [wheelRotation, setWheelRotation] = useState(0);

  const [resetBusy, setResetBusy] = useState(false);

  const applyLoadedSession = (
    loadedSession: WheelSession | null,
    loadedParticipants: WheelParticipant[],
    loadedRounds: WheelRound[]
  ) => {
    setSession(loadedSession);
    sessionIdRef.current = loadedSession?.id ?? null;
    setParticipants(loadedParticipants);
    setRounds(loadedRounds);
    setSectorOrder(
      loadedParticipants
        .filter((p) => p.status === 'active')
        .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
    );
  };

  const refreshState = async (mode: 'restore' | 'refetch') => {
    if (!supabase) return;
    setLoading(true);
    setLoadError('');
    try {
      let sessionRow: any = null;
      if (mode === 'refetch' && sessionIdRef.current) {
        const { data, error } = await supabase.from('wheel_sessions').select('*').eq('id', sessionIdRef.current).maybeSingle();
        if (error) throw error;
        sessionRow = data;
      } else {
        const { data, error } = await supabase
          .from('wheel_sessions')
          .select('*')
          .eq('category', category)
          .in('status', ['draft', 'locked'])
          .order('created_at', { ascending: false })
          .limit(1);
        if (error) throw error;
        sessionRow = data?.[0] ?? null;
      }

      if (!sessionRow) {
        applyLoadedSession(null, [], []);
        return;
      }

      const loadedSession = fromDbWheelSession(sessionRow);
      const [participantsResult, roundsResult] = await Promise.all([
        supabase.from('wheel_participants').select('*').eq('session_id', loadedSession.id),
        supabase.from('wheel_rounds').select('*').eq('session_id', loadedSession.id).order('reveal_order', { ascending: true }),
      ]);
      if (participantsResult.error) throw participantsResult.error;
      if (roundsResult.error) throw roundsResult.error;

      applyLoadedSession(
        loadedSession,
        (participantsResult.data ?? []).map(fromDbWheelParticipant),
        (roundsResult.data ?? []).map(fromDbWheelRound)
      );
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Не удалось загрузить состояние колеса');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setWheelRotation(0);
    setSpinning(false);
    setSpinError('');
    setCreateError('');
    refreshState('restore');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  const activeAuctionItems = auctions.filter((item) => item.category === category && item.amount > 0).sort((a, b) => b.amount - a.amount);
  const inactiveAuctionItems = auctions.filter((item) => item.category === category && item.amount <= 0);
  const totalActiveAmount = activeAuctionItems.reduce((sum, item) => sum + item.amount, 0);
  const totalParticipantsAmount = participants.reduce((sum, p) => sum + p.amount, 0);

  const handleLockParticipants = async () => {
    if (!supabase || !user || activeAuctionItems.length < 2) return;
    setCreating(true);
    setCreateError('');
    try {
      const { data: sessionRow, error: sessionError } = await supabase
        .from('wheel_sessions')
        .insert(toDbWheelSession({ category, status: 'draft', createdBy: user.id }))
        .select()
        .single();
      if (sessionError) throw sessionError;

      const sessionId = sessionRow.id as string;
      const { error: participantsError } = await supabase
        .from('wheel_participants')
        .insert(activeAuctionItems.map((item) => toDbWheelParticipant(sessionId, item)));
      if (participantsError) throw participantsError;

      const { error: lockError } = await supabase.rpc('lock_wheel_session', { p_session_id: sessionId });
      if (lockError) throw lockError;

      sessionIdRef.current = sessionId;
      await refreshState('refetch');
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Не удалось зафиксировать участников');
    } finally {
      setCreating(false);
    }
  };

  const handleRetryLock = async () => {
    if (!supabase || !session) return;
    setCreating(true);
    setCreateError('');
    try {
      const { error } = await supabase.rpc('lock_wheel_session', { p_session_id: session.id });
      if (error) throw error;
      await refreshState('refetch');
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Не удалось зафиксировать участников');
    } finally {
      setCreating(false);
    }
  };

  const handleResetSession = async () => {
    if (!supabase || !session) return;
    const isDraft = session.status === 'draft';
    const confirmed = window.confirm(
      isDraft
        ? 'Удалить черновик сессии колеса? Придётся зафиксировать участников заново.'
        : 'Отменить текущую сессию колеса? Прогресс розыгрыша будет потерян — начать можно будет заново.'
    );
    if (!confirmed) return;
    setResetBusy(true);
    try {
      if (isDraft) {
        const { error } = await supabase.from('wheel_sessions').delete().eq('id', session.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('wheel_sessions').update({ status: 'cancelled' }).eq('id', session.id);
        if (error) throw error;
      }
      applyLoadedSession(null, [], []);
      setWheelRotation(0);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Не удалось сбросить сессию');
    } finally {
      setResetBusy(false);
    }
  };

  const finalizeSpin = async (round: WheelRound, participant: WheelParticipant, allRounds: WheelRound[], allSectors: WheelParticipant[]) => {
    if (!supabase || !session) { setSpinning(false); return; }
    try {
      const newRoundNumber = session.currentRound + 1;
      const remainingUnrevealed = allRounds.filter((r) => !r.revealed && r.id !== round.id).length;
      const remainingActiveAfter = allSectors.length - 1;

      const { error: roundError } = await supabase
        .from('wheel_rounds')
        .update({ revealed: true, revealed_at: new Date().toISOString() })
        .eq('id', round.id);
      if (roundError) throw roundError;

      const { error: participantError } = await supabase
        .from('wheel_participants')
        .update({ status: 'eliminated', eliminated_at_round: newRoundNumber })
        .eq('id', participant.id);
      if (participantError) throw participantError;

      let winner: WheelParticipant | undefined;
      if (remainingUnrevealed === 0 && remainingActiveAfter === 1) {
        winner = allSectors.find((p) => p.id !== participant.id);
        if (winner) {
          const { error: winnerError } = await supabase.from('wheel_participants').update({ status: 'winner' }).eq('id', winner.id);
          if (winnerError) throw winnerError;
        }
      }

      const sessionUpdate: Record<string, unknown> = { current_round: newRoundNumber };
      if (winner) {
        sessionUpdate.status = 'finished';
        sessionUpdate.winner_participant_id = winner.id;
        sessionUpdate.finished_at = new Date().toISOString();
      }
      const { data: sessionData, error: sessionUpdateError } = await supabase
        .from('wheel_sessions')
        .update(sessionUpdate)
        .eq('id', session.id)
        .select()
        .maybeSingle();
      if (sessionUpdateError) throw sessionUpdateError;

      setRounds((prev) => prev.map((r) => (r.id === round.id ? { ...r, revealed: true, revealedAt: new Date().toISOString() } : r)));
      setParticipants((prev) => prev.map((p) => {
        if (p.id === participant.id) return { ...p, status: 'eliminated' as WheelParticipantStatus, eliminatedAtRound: newRoundNumber };
        if (winner && p.id === winner.id) return { ...p, status: 'winner' as WheelParticipantStatus };
        return p;
      }));
      setSectorOrder((prev) => prev.filter((p) => p.id !== participant.id));
      if (sessionData) setSession(fromDbWheelSession(sessionData));
      setSpinError('');
    } catch (err) {
      setSpinError(err instanceof Error ? err.message : 'Не удалось завершить раунд');
    } finally {
      setSpinning(false);
    }
  };

  const handleSpin = () => {
    if (!session || session.status !== 'locked' || spinning || sectorOrder.length < 2) return;
    const nextRound = [...rounds].filter((r) => !r.revealed).sort((a, b) => a.revealOrder - b.revealOrder)[0];
    if (!nextRound) return;
    const idx = sectorOrder.findIndex((p) => p.id === nextRound.participantId);
    if (idx === -1) {
      setSpinError('Не удалось определить участника для розыгрыша — нажмите «Обновить».');
      return;
    }

    const sectorAngle = 360 / sectorOrder.length;
    const sectorCenter = (idx + 0.5) * sectorAngle;
    const currentMod = ((wheelRotation % 360) + 360) % 360;
    const targetMod = ((-sectorCenter % 360) + 360) % 360;
    let delta = targetMod - currentMod;
    if (delta <= 0) delta += 360;
    delta += 360 * (4 + Math.floor(Math.random() * 2));
    const newRotation = wheelRotation + delta;

    const roundsSnapshot = rounds;
    const sectorsSnapshot = sectorOrder;
    const participantSnapshot = sectorOrder[idx];

    setSpinError('');
    setSpinning(true);
    setWheelRotation(newRotation);

    window.setTimeout(() => {
      finalizeSpin(nextRound, participantSnapshot, roundsSnapshot, sectorsSnapshot);
    }, 4700);
  };

  const handleNewSession = () => {
    applyLoadedSession(null, [], []);
    setWheelRotation(0);
  };

  if (!supabase) {
    return (
      <main>
        <section className="admin-head">
          <div>
            <Link to="/admin/auctions" className="wheel-back-link"><ArrowLeft size={16} /> Назад к аукциону</Link>
            <h1>Колесо аукциона</h1>
          </div>
        </section>
        <section className="panel">
          <p className="muted">Колесо доступно только с подключённым Supabase.</p>
        </section>
      </main>
    );
  }

  const revealedRounds = [...rounds].filter((r) => r.revealed).sort((a, b) => a.revealOrder - b.revealOrder);
  const participantById = new Map(participants.map((p) => [p.id, p]));
  const chanceOf = (amount: number, total: number) => (total > 0 ? ((amount / total) * 100).toFixed(1) : '0.0');

  const rankedParticipants = [...participants].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  const finishedResults = [...participants].sort((a, b) => {
    if (a.status === 'winner') return -1;
    if (b.status === 'winner') return 1;
    return (b.eliminatedAtRound ?? 0) - (a.eliminatedAtRound ?? 0);
  });
  const winnerParticipant = participants.find((p) => p.status === 'winner');

  return (
    <main className="wheel-page">
      <section className="admin-head">
        <div>
          <Link to="/admin/auctions" className="wheel-back-link"><ArrowLeft size={16} /> Назад к аукциону</Link>
          <h1>Колесо — {auctionCategoryLabel[category]}</h1>
        </div>
        <div className="admin-head-actions">
          <button className="ghost" onClick={() => refreshState('refetch')} disabled={loading}><RefreshCw size={16} /> Обновить</button>
          {session && session.status !== 'finished' && (
            <button className="danger" onClick={handleResetSession} disabled={resetBusy}>
              <Trash2 size={16} /> {session.status === 'draft' ? 'Удалить черновик' : 'Отменить сессию'}
            </button>
          )}
        </div>
      </section>

      {loading && <div className="empty">Загружаем колесо...</div>}
      {loadError && <div className="empty">Ошибка: {loadError}</div>}

      {!loading && !loadError && !session && (
        <section className="panel wheel-prep">
          <h2>Подготовка розыгрыша</h2>
          {activeAuctionItems.length < 2 ? (
            <p className="muted">Нужно минимум 2 позиции с ненулевой суммой в категории «{auctionCategoryLabel[category].toLowerCase()}», чтобы запустить колесо.</p>
          ) : (
            <p className="muted">Участвуют позиции с донатами выше нуля. Шанс на победу пропорционален доле собранной суммы.</p>
          )}

          {activeAuctionItems.length > 0 && (
            <div className="wheel-prep-list">
              {activeAuctionItems.map((item) => (
                <div className="wheel-prep-row" key={item.id}>
                  <div className="wheel-prep-title">
                    {auctionCategoryHasArtist[item.category] && item.artist ? <><b>{item.artist}</b> — {item.title}</> : <b>{item.title}</b>}
                  </div>
                  <div className="wheel-chance">{chanceOf(item.amount, totalActiveAmount)}%</div>
                  <div className="admin-auction-amount">{item.amount.toLocaleString('ru-RU')} ₽</div>
                </div>
              ))}
            </div>
          )}

          {inactiveAuctionItems.length > 0 && (
            <div className="wheel-prep-inactive">
              <p className="muted">Не участвуют — сумма 0:</p>
              <ul>
                {inactiveAuctionItems.map((item) => <li key={item.id}>{item.title}</li>)}
              </ul>
            </div>
          )}

          {createError && <p className="form-error">{createError}</p>}

          <button onClick={handleLockParticipants} disabled={creating || activeAuctionItems.length < 2}>
            {creating ? 'Фиксирую…' : <><RotateCw size={16} /> Зафиксировать участников</>}
          </button>
        </section>
      )}

      {!loading && !loadError && session?.status === 'draft' && (
        <section className="panel">
          <p>Черновик сессии найден, но фиксация участников не завершилась (например, страница перезагрузилась в процессе).</p>
          {createError && <p className="form-error">{createError}</p>}
          <button onClick={handleRetryLock} disabled={creating}>{creating ? 'Фиксирую…' : 'Повторить фиксацию'}</button>
        </section>
      )}

      {!loading && !loadError && session?.status === 'locked' && (
        <section className="wheel-layout">
          <div className="wheel-circle-col">
            <WheelCircle sectors={sectorOrder} rotation={wheelRotation} spinning={spinning} />
            <button
              className="wheel-spin-btn"
              onClick={handleSpin}
              disabled={spinning || rounds.every((r) => r.revealed) || sectorOrder.length < 2}
            >
              {spinning ? 'Крутится…' : <><RotateCw size={18} /> Крутить</>}
            </button>
            {spinError && <p className="form-error">{spinError}</p>}
            {rounds.length > 0 && rounds.every((r) => r.revealed) && (
              <p className="muted">Все раунды раскрыты — нажмите «Обновить», если победитель ещё не появился.</p>
            )}
          </div>
          <div className="wheel-participant-col">
            <h2>Участники</h2>
            <div className="wheel-participant-list">
              {rankedParticipants.map((p) => (
                <div className={`wheel-participant-row${p.status === 'winner' ? ' winner' : ''}${p.status === 'eliminated' ? ' eliminated' : ''}`} key={p.id}>
                  <div className="wheel-participant-main">
                    <strong>{p.artist ? `${p.artist} — ${p.title}` : p.title}</strong>
                    <span className="wheel-participant-status">
                      {p.status === 'winner' && <><Trophy size={14} /> Победитель</>}
                      {p.status === 'eliminated' && `Выбыл на раунде ${p.eliminatedAtRound}`}
                      {p.status === 'active' && 'В игре'}
                    </span>
                  </div>
                  <div className="wheel-chance">{chanceOf(p.amount, totalParticipantsAmount)}%</div>
                  <div className="admin-auction-amount">{p.amount.toLocaleString('ru-RU')} ₽</div>
                </div>
              ))}
            </div>

            {revealedRounds.length > 0 && (
              <div className="wheel-history">
                <h3>История раундов</h3>
                {revealedRounds.map((round) => {
                  const p = participantById.get(round.participantId);
                  return (
                    <div className="wheel-history-row" key={round.id}>
                      <span>Раунд {round.revealOrder}</span>
                      <span>{p ? (p.artist ? `${p.artist} — ${p.title}` : p.title) : 'неизвестный участник'}</span>
                      {round.revealedAt && <span className="muted">{formatMSK(round.revealedAt)}</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {!loading && !loadError && session?.status === 'finished' && (
        <section className="wheel-finished">
          <div className="panel wheel-winner-panel">
            <Trophy size={40} className="wheel-winner-icon" />
            <p className="eyebrow">Победитель розыгрыша</p>
            <h2>{winnerParticipant ? (winnerParticipant.artist ? `${winnerParticipant.artist} — ${winnerParticipant.title}` : winnerParticipant.title) : '—'}</h2>
            {winnerParticipant && <p className="admin-auction-amount wheel-winner-amount">{winnerParticipant.amount.toLocaleString('ru-RU')} ₽</p>}
            <button onClick={handleNewSession}><RotateCw size={16} /> Новая сессия</button>
          </div>
          <div className="panel">
            <h3>Итоги</h3>
            <div className="wheel-participant-list">
              {finishedResults.map((p, index) => (
                <div className={`wheel-participant-row${p.status === 'winner' ? ' winner' : ''}${p.status === 'eliminated' ? ' eliminated' : ''}`} key={p.id}>
                  <div className="wheel-rank">{index + 1}</div>
                  <div className="wheel-participant-main">
                    <strong>{p.artist ? `${p.artist} — ${p.title}` : p.title}</strong>
                    <span className="wheel-participant-status">
                      {p.status === 'winner' ? <><Trophy size={14} /> Победитель</> : `Выбыл на раунде ${p.eliminatedAtRound}`}
                    </span>
                  </div>
                  <div className="admin-auction-amount">{p.amount.toLocaleString('ru-RU')} ₽</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
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
  const editorDraftKey = `${editorDraftPrefix}:${id ? `edit:${id}` : `new:${newItemType}`}`;
  const baseDraft: RatedItem = existing ?? {
    id: crypto.randomUUID(),
    type: newItemType,
    slug: '',
    title: '',
    finalScore: 0,
    scoreMode: newItemType === 'album' ? 'auto' : 'manual',
    published: false,
    tracks: [],
    links: [
      {
        id: crypto.randomUUID(),
        kind: 'reaction',
        platform: 'Boosty',
        url: 'https://boosty.to/r1fmabes2tipa',
        label: 'Реакция R1Fmabes на Бусти',
      },
    ],
    genre: newItemType === 'battle' ? battleGenre : undefined,
    metadata: newItemType === 'battle' ? { battle: createDefaultBattle() } : undefined,
    reviewedAt: todayInMoscow(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const restoredEditorDraft = readEditorDraftBackup(editorDraftKey);
  const [draft, setDraft] = useState<RatedItem>(restoredEditorDraft?.draft ?? baseDraft);
  const [trackText, setTrackText] = useState(restoredEditorDraft?.trackText ?? '');
  const [yandexUrl, setYandexUrl] = useState(restoredEditorDraft?.yandexUrl ?? '');
  const [importStatus, setImportStatus] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState(restoredEditorDraft?.youtubeUrl ?? '');
  const [youtubeImportStatus, setYoutubeImportStatus] = useState('');
  const [isYoutubeImporting, setIsYoutubeImporting] = useState(false);
  const [draftBackupStatus, setDraftBackupStatus] = useState(restoredEditorDraft ? `Восстановлен локальный черновик от ${formatMSK(restoredEditorDraft.savedAt)} МСК.` : '');

  const patch = (value: Partial<RatedItem>) => setDraft((current) => ({ ...current, ...value }));
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (!hasMeaningfulEditorDraft(draft, trackText, yandexUrl, youtubeUrl)) {
        localStorage.removeItem(editorDraftKey);
        return;
      }

      const backup: EditorDraftBackup = {
        draft,
        trackText,
        yandexUrl,
        youtubeUrl,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(editorDraftKey, JSON.stringify(backup));
      setDraftBackupStatus('Локальный черновик автосохранён в этом браузере.');
    }, 600);

    return () => window.clearTimeout(timeout);
  }, [draft, trackText, yandexUrl, youtubeUrl, editorDraftKey]);

  const resetLocalDraft = () => {
    localStorage.removeItem(editorDraftKey);
    setDraft(baseDraft);
    setTrackText('');
    setYandexUrl('');
    setYoutubeUrl('');
    setDraftBackupStatus('');
  };

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
  const toggleBestTrack = (index: number) => {
    const track = draft.tracks[index];
    if (!track) return;
    const bestCount = draft.tracks.filter((item) => item.isBest).length;
    if (!track.isBest && bestCount >= maxBestAlbumTracks) return;
    updateTrack(index, { isBest: !track.isBest });
  };
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
      const importedGenre = normalizeImportedGenre(imported.genre);
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
        genre: importedGenre || draft.genre,
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
      if (draft.type === 'track') {
        const result = await fetchYoutubeTrack(youtubeUrl);
        patch({
          type: 'track',
          title: result.parsed.title || result.title || draft.title,
          artist: result.parsed.artist || result.author || draft.artist,
          coverUrl: draft.coverUrl || result.thumbnailUrl,
          scoreMode: 'manual',
          tracks: [],
          links: [
            ...draft.links,
            {
              id: crypto.randomUUID(),
              kind: 'original',
              platform: 'YouTube',
              url: result.sourceUrl,
              label: 'Трек',
            },
          ],
          metadata: {
            ...draft.metadata,
            youtube: { videoId: result.videoId, sourceUrl: result.sourceUrl },
          },
        });
        setYoutubeImportStatus(`Импортировано: ${result.parsed.artist} — ${result.parsed.title}.`);
        return;
      }

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
  const extractErrorMessage = (error: unknown) => {
    if (error instanceof Error) return error.message;
    if (error && typeof error === 'object') {
      const obj = error as { message?: string; details?: string; hint?: string; code?: string };
      const parts = [obj.message, obj.details, obj.hint, obj.code ? `код ${obj.code}` : null].filter(Boolean);
      if (parts.length) return parts.join(' — ');
    }
    return 'Не удалось сохранить запись';
  };
  const submitItem = async (published: boolean) => {
    setSaveError('');
    try {
      await saveItem({ ...draft, slug: draft.slug || createItemSlug(draft), finalScore: albumScore, published });
      localStorage.removeItem(editorDraftKey);
      navigate('/admin');
    } catch (error) {
      console.error('saveItem failed:', error);
      setSaveError(extractErrorMessage(error));
    }
  };

  const tournamentSuggestions = Array.from(new Set(items.flatMap((item) => item.metadata?.battle?.tournament ? [item.metadata.battle.tournament] : []))).sort();
  const seasonSuggestions = Array.from(new Set(items.flatMap((item) => item.metadata?.battle?.season ? [item.metadata.battle.season] : []))).sort();

  return (
    <main>
      <datalist id="battle-tournament-options">
        {tournamentSuggestions.map((t) => <option key={t} value={t} />)}
      </datalist>
      <datalist id="battle-season-options">
        {seasonSuggestions.map((s) => <option key={s} value={s} />)}
      </datalist>
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

        {(draft.type === 'battle' || draft.type === 'track') && (
          <section className="panel">
            <h2>{draft.type === 'track' ? 'Импорт трека с YouTube' : 'Импорт с YouTube'}</h2>
            <div className="import-row">
              <input
                value={youtubeUrl}
                onChange={(event) => setYoutubeUrl(event.target.value)}
                placeholder={draft.type === 'track' ? 'Вставь ссылку на YouTube-трек или клип' : 'Вставь ссылку на YouTube — Кубок МЦ, Versus, и т.п.'}
              />
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
              const currentGenre = normalizeImportedGenre(draft.genre) || '';
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
                <input
                  value={battle.tournament || ''}
                  onChange={(event) => updateBattle({ tournament: event.target.value })}
                  placeholder="Площадка (Versus, SLOVO, Кубок МЦ, 140 BPM…)"
                  list="battle-tournament-options"
                />
                <input
                  value={battle.season || ''}
                  onChange={(event) => updateBattle({ season: event.target.value })}
                  placeholder="Сезон (Fresh Blood 4, опционально)"
                  list="battle-season-options"
                />
              </>
            )}
            <input value={draft.coverUrl || ''} onChange={(event) => patch({ coverUrl: event.target.value })} placeholder="URL обложки" />
            <label className="field-label">
              <span>Дата оценки</span>
              <input type="date" value={draft.reviewedAt || ''} onChange={(event) => patch({ reviewedAt: event.target.value || undefined })} />
            </label>
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
          <p className="muted">Поставь «-» вместо оценки, если это интро, аутро или скит: трек останется в списке, но не попадёт в среднюю оценку.</p>
          {draft.tracks.map((track, index) => (
            <div className="track-edit" key={track.id}>
              <span>{index + 1}</span>
              <input value={track.title} onChange={(event) => updateTrack(index, { title: event.target.value })} />
              <ScoreInput value={track.score} allowExclude onChange={(next) => updateTrack(index, { score: next })} />
              <button
                type="button"
                className={`best-track-toggle${track.isBest ? ' on' : ''}`}
                disabled={!track.isBest && draft.tracks.filter((item) => item.isBest).length >= maxBestAlbumTracks}
                onClick={() => toggleBestTrack(index)}
                title={track.isBest ? 'Убрать из лучших треков' : `Отметить как лучший трек (до ${maxBestAlbumTracks})`}
              >
                <Star size={15} /> Лучший
              </button>
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
              <ScoreInput value={round.scoreA} onChange={(next) => updateBattleRound(index, { scoreA: numericScoreValue(next) })} placeholder={`Очки: ${battle.sideA || 'A'}`} />
              <ScoreInput value={round.scoreB} onChange={(next) => updateBattleRound(index, { scoreB: numericScoreValue(next) })} placeholder={`Очки: ${battle.sideB || 'B'}`} />
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
            <span className="muted">Победитель по судьям</span>
            <select value={battle.judgeWinner ?? 'unjudged'} onChange={(event) => updateBattle({ judgeWinner: event.target.value as JudgeWinner })}>
              <option value="unjudged">Не судился</option>
              <option value="a">{battle.sideA || 'Сторона A'}</option>
              <option value="b">{battle.sideB || 'Сторона B'}</option>
              <option value="draw">Ничья / спорно</option>
            </select>
            <p>Кто победил по оценке судей баттла. Для отборочных и нестандартных форматов выбери «Не судился».</p>
          </div>
          <div className="battle-winner">
            <span className="muted">Победитель по R1Fmabes</span>
            <select value={battle.finalWinner} onChange={(event) => updateBattle({ finalWinner: event.target.value as BattleSideKey })}>
              <option value="draw">Ничья / спорно</option>
              <option value="a">{battle.sideA || 'Сторона A'}</option>
              <option value="b">{battle.sideB || 'Сторона B'}</option>
            </select>
            <p>Кого R1Fmabes сам считает победителем. Может отличаться от решения судей.</p>
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
              <ScoreInput value={albumScore} disabled={draft.scoreMode === 'auto'} onChange={(next) => patch({ finalScore: typeof next === 'number' ? next : 0 })} />
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
            <button
              type="button"
              className="danger"
              onClick={() => {
                const message = existing
                  ? 'Откатить все правки к последней сохранённой версии? Локальный черновик в этом браузере удалится.'
                  : 'Стереть все поля и начать с чистого листа? Локальный черновик в этом браузере тоже удалится.';
                if (window.confirm(message)) {
                  resetLocalDraft();
                }
              }}
            ><Trash2 size={16} /> {existing ? 'Откатить правки' : 'Стереть всё'}</button>
            <button type="button" className="ghost" onClick={() => submitItem(false)}><Save size={16} /> Сохранить черновик</button>
            <button><Save size={16} /> Сохранить и опубликовать</button>
          </div>
        </section>
      </form>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
