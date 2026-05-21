import http from "node:http";

const PORT = 3001;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// Этот прокси нужен ТОЛЬКО для Яндекс.Музыки: их API геоблокирует не-российские IP,
// и фронт из браузера дёрнуть напрямую не может (нет CORS).
//
// Другие источники импорта (YouTube oEmbed, iTunes Search и т.п.) поддерживают CORS,
// поэтому фронт зовёт их сам, минуя этот прокси.
//
// Если когда-нибудь нужно будет проксировать ещё один сервис с геоблоком — добавляй сюда.

function extractYandexIds(rawUrl) {
  const u = new URL(rawUrl);
  if (!u.hostname.endsWith("music.yandex.ru")) {
    throw new Error("Поддерживаются только ссылки с music.yandex.ru");
  }
  const albumMatch = u.pathname.match(/\/album\/(\d+)/);
  const trackMatch = u.pathname.match(/\/track\/(\d+)/);
  if (!albumMatch) throw new Error("В ссылке не найден album id");
  return { albumId: albumMatch[1], trackId: trackMatch?.[1] };
}

function yandexCoverUrl(uri) {
  if (!uri) return undefined;
  return "https://" + uri.replace("%%", "600x600");
}

function formatDuration(ms) {
  if (!ms) return undefined;
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes + ":" + String(seconds % 60).padStart(2, "0");
}

async function fetchYandexAlbum(albumId) {
  const res = await fetch(`https://api.music.yandex.net/albums/${albumId}/with-tracks`, {
    headers: {
      "accept": "application/json",
      "accept-language": "ru-RU,ru;q=0.9,en;q=0.8",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok) throw new Error(`Яндекс.Музыка вернула HTTP ${res.status}`);
  const data = await res.json();
  if (!data || !data.result) throw new Error("В ответе Яндекса нет поля result");
  return data.result;
}

function parseYandexAlbum(album, sourceUrl, albumId, trackId) {
  if (!album.title) throw new Error("Не удалось найти данные альбома");
  const artists = Array.isArray(album.artists) ? album.artists.map((a) => a.name).filter(Boolean) : [];
  const volumes = Array.isArray(album.volumes) ? album.volumes : [];
  const tracks = volumes.flat().map((t, i) => ({
    id: Number(t.id) || undefined,
    title: t.title || `Трек ${i + 1}`,
    duration: formatDuration(t.durationMs),
    artist: Array.isArray(t.artists) ? t.artists.map((a) => a.name).filter(Boolean).join(", ") : undefined,
  }));

  if (trackId) {
    const selectedTrack = tracks.find((track) => String(track.id) === String(trackId));
    if (!selectedTrack) {
      throw new Error(`В альбоме ${albumId} не найден трек ${trackId}`);
    }

    return {
      albumId,
      trackId,
      title: selectedTrack.title,
      artist: selectedTrack.artist || artists.join(", "),
      year: album.year,
      genre: album.genre,
      coverUrl: yandexCoverUrl(album.coverUri),
      tracks: [selectedTrack],
      sourceUrl,
    };
  }

  const finalTracks = tracks.length > 0 ? tracks : [{
    id: undefined,
    title: album.title,
  }];
  return {
    albumId,
    title: album.title,
    artist: artists.join(", "),
    year: album.year,
    genre: album.genre,
    coverUrl: yandexCoverUrl(album.coverUri),
    tracks: finalTracks,
    sourceUrl,
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/health") {
      res.writeHead(200, { ...corsHeaders, "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "yandex-music-proxy" }));
      return;
    }

    if (url.pathname === "/yandex-music/import") {
      const sourceUrl = url.searchParams.get("url");
      if (!sourceUrl) throw new Error("Не передана ссылка");
      const { albumId, trackId } = extractYandexIds(sourceUrl);
      const album = await fetchYandexAlbum(albumId);
      const result = parseYandexAlbum(album, sourceUrl, albumId, trackId);
      res.writeHead(200, { ...corsHeaders, "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(result));
      return;
    }

    res.writeHead(404, { ...corsHeaders, "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (err) {
    console.error("error:", err.message);
    res.writeHead(500, { ...corsHeaders, "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Yandex proxy listening on http://127.0.0.1:${PORT}`);
});
