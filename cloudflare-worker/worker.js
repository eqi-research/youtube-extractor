/* ─── YouTube Transcript Worker (Cloudflare) ────────────────────
   Versão 4 (2026): combina 3 estratégias em sequência.
   YouTube apertou o cerco com PoToken (anti-bot) em 2024-2025,
   então usamos múltiplos caminhos:

   1) timedtext direto (sem auth) — funciona p/ muitos vídeos
   2) WEB_EMBEDDED_PLAYER — único cliente Innertube que ainda escapa
   3) Scrape da página /watch — última tentativa
────────────────────────────────────────────────────────────── */

const COMMON_LANG_TRIES = ['pt-BR', 'pt', 'en', 'en-US', 'es', 'es-419'];

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url      = new URL(request.url);
    const videoId  = url.searchParams.get('id');
    const langPref = url.searchParams.get('lang') || 'pt-BR';
    const debug    = url.searchParams.get('debug') === '1';

    if (!videoId || !/^[\w-]{6,15}$/.test(videoId)) {
      return jsonRes({ ok: false, error: 'invalid or missing id' }, 400);
    }

    const errors = [];

    // ───── Estratégia 1: timedtext direto (sem precisar do player)
    // Tenta o idioma preferido primeiro, depois cascata de comuns.
    const tryLangs = [...new Set([langPref, ...COMMON_LANG_TRIES])];
    for (const lang of tryLangs) {
      // 1a — legenda manual (kind vazio)
      try {
        const r = await tryTimedText(videoId, lang, false);
        if (r) return jsonRes({ ...r, strategy: 'timedtext_manual' });
      } catch (e) {
        errors.push(`timedtext ${lang} (manual): ${e.message}`);
      }
      // 1b — auto-geradas (kind=asr)
      try {
        const r = await tryTimedText(videoId, lang, true);
        if (r) return jsonRes({ ...r, strategy: 'timedtext_asr' });
      } catch (e) {
        errors.push(`timedtext ${lang} (asr): ${e.message}`);
      }
    }

    // ───── Estratégia 2: WEB_EMBEDDED_PLAYER (Innertube)
    // Sem PoToken, esse é dos poucos clientes que ainda passa.
    try {
      const r = await tryEmbeddedPlayer(videoId, langPref);
      if (r) return jsonRes({ ...r, strategy: 'embedded_player' });
    } catch (e) {
      errors.push(`embedded_player: ${e.message}`);
    }

    // ───── Estratégia 3: Scrape da página /watch
    try {
      const r = await tryWatchPageScrape(videoId, langPref);
      if (r) return jsonRes({ ...r, strategy: 'watch_scrape' });
    } catch (e) {
      errors.push(`watch_scrape: ${e.message}`);
    }

    return jsonRes({
      ok:      false,
      error:   'todas as estratégias falharam',
      details: errors.slice(0, 8).join(' | '),
    });
  },
};

/* ─── Estratégia 1: timedtext direto ─────────────────────────── */
async function tryTimedText(videoId, lang, asr) {
  const params = new URLSearchParams({
    v:    videoId,
    lang: lang,
    fmt:  'json3',
  });
  if (asr) { params.set('kind', 'asr'); params.set('caps', 'asr'); }

  const url = `https://www.youtube.com/api/timedtext?${params}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const body = await res.text();
  if (!body || body.length < 50) return null;  // vazio

  let text = '';
  try {
    const data = JSON.parse(body);
    text = (data.events || [])
      .map(e => (e.segs || []).map(s => s.utf8 || '').join(''))
      .join('\n')
      .replace(/\n+/g, '\n')
      .trim();
  } catch {
    return null;
  }

  if (!text || text.length < 10) return null;

  return {
    ok:       true,
    text,
    language: lang,
    label:    asr ? `${lang} (auto)` : lang,
    kind:     asr ? 'asr' : 'manual',
  };
}

/* ─── Estratégia 2: WEB_EMBEDDED_PLAYER ──────────────────────── */
async function tryEmbeddedPlayer(videoId, langPref) {
  const body = {
    context: {
      client: {
        clientName:    'WEB_EMBEDDED_PLAYER',
        clientVersion: '1.20240126.00.00',
        clientScreen:  'EMBED',
        hl: 'en', gl: 'US',
      },
      thirdParty: { embedUrl: `https://www.youtube.com/embed/${videoId}` },
    },
    videoId,
    contentCheckOk: true,
    racyCheckOk:    true,
    playbackContext: {
      contentPlaybackContext: {
        html5Preference: 'HTML5_PREF_WANTS',
        signatureTimestamp: 19825,
      },
    },
  };

  const res = await fetch('https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8&prettyPrint=false', {
    method:  'POST',
    headers: {
      'Content-Type':              'application/json',
      'User-Agent':                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'X-YouTube-Client-Name':     '56',
      'X-YouTube-Client-Version':  '1.20240126.00.00',
      'Origin':                    'https://www.youtube.com',
      'Referer':                   `https://www.youtube.com/embed/${videoId}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const player = await res.json();

  const status = player?.playabilityStatus?.status;
  if (status && status !== 'OK') {
    throw new Error(`${status} (${player.playabilityStatus.reason || ''})`);
  }

  const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks?.length) throw new Error('sem captionTracks');

  return await fetchFromTrack(pickLang(tracks, langPref));
}

/* ─── Estratégia 3: Scrape da página /watch ──────────────────── */
async function tryWatchPageScrape(videoId, langPref) {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
    headers: {
      'User-Agent':      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const match = html.match(/"captionTracks":(\[.*?\])/);
  if (!match) throw new Error('captionTracks não encontrado');

  const tracks = JSON.parse(match[1].replace(/\\u0026/g, '&'));
  return await fetchFromTrack(pickLang(tracks, langPref));
}

/* ─── Comum: baixa o conteúdo de um caption track ─────────────── */
async function fetchFromTrack(chosen) {
  if (!chosen?.baseUrl) throw new Error('idioma indisponível');
  const captionUrl = chosen.baseUrl + '&fmt=json3';
  const capRes = await fetch(captionUrl);
  if (!capRes.ok) throw new Error(`caption HTTP ${capRes.status}`);
  const capData = await capRes.json();

  const text = (capData.events || [])
    .map(e => (e.segs || []).map(s => s.utf8 || '').join(''))
    .join('\n')
    .replace(/\n+/g, '\n')
    .trim();

  if (!text || text.length < 10) throw new Error('transcrição vazia');

  return {
    ok:       true,
    text,
    language: chosen.languageCode,
    label:    chosen.name?.simpleText
           || chosen.name?.runs?.[0]?.text
           || chosen.languageCode,
    kind:     chosen.kind || '',
  };
}

function pickLang(tracks, pref) {
  if (!tracks.length) return null;
  if (pref === 'any') return tracks[0];

  let m = tracks.find(t => t.languageCode === pref);
  if (m) return m;
  const base = pref.split('-')[0].toLowerCase();
  m = tracks.find(t => t.languageCode?.toLowerCase().startsWith(base));
  if (m) return m;
  for (const lang of ['pt', 'en', 'es']) {
    m = tracks.find(t => t.languageCode?.toLowerCase().startsWith(lang));
    if (m) return m;
  }
  return tracks[0];
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control':                'public, max-age=86400',
  };
}

function jsonRes(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(),
    },
  });
}
