/* ─── Transcript fetcher (Invidious + Piped public instances) ──
   Browser-side download of YouTube captions for arbitrary videos
   (no OAuth needed). Goes through public proxy instances since
   the official YouTube API blocks captions.download for non-owned
   videos.

   Strategy: try ALL Invidious instances first; if none return
   captions, fall back to Piped (different infrastructure with
   different blocklists). Only declare "no captions" when every
   provider fails consistently.
─────────────────────────────────────────────────────────────── */

const Transcripts = (() => {

  // Invidious instances with API enabled (https://api.invidious.io/)
  const INVIDIOUS = [
    'https://yewtu.be',
    'https://invidious.nerdvpn.de',
    'https://inv.nadeko.net',
    'https://invidious.privacydev.net',
    'https://invidious.flokinet.to',
    'https://iv.melmac.space',
    'https://invidious.lunar.icu',
    'https://yt.cdaut.de',
  ];

  // Piped instances (different infrastructure → different blocklist)
  const PIPED = [
    'https://pipedapi.kavin.rocks',
    'https://api-piped.mha.fi',
    'https://piped-api.lunar.icu',
    'https://pipedapi.adminforge.de',
    'https://piped-api.privacydev.net',
    'https://pipedapi.r4fo.com',
  ];

  // Track per-instance failure score so we deprioritize unreliable ones
  const failureScore = {};
  [...INVIDIOUS, ...PIPED].forEach(i => failureScore[i] = 0);

  function ranked(list) {
    return [...list].sort((a, b) => failureScore[a] - failureScore[b]);
  }

  /* ── HTTP with timeout ───────────────────────────────────────── */
  async function fetchWithTimeout(url, ms = 9000) {
    const ctrl = new AbortController();
    const t    = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  }

  /* ── Caption track picker ────────────────────────────────────── */
  function pickCaption(captions, langPref) {
    if (!captions?.length) return null;
    if (langPref === 'any') return captions[0];

    const code = c => (c.languageCode || c.code || '').toLowerCase();

    // Exact match (e.g. "pt-BR")
    const exact = captions.find(c => code(c) === langPref.toLowerCase());
    if (exact) return exact;

    // Base language (e.g. "pt-BR" → "pt")
    const base  = langPref.split('-')[0].toLowerCase();
    const baseM = captions.find(c => code(c).startsWith(base));
    if (baseM) return baseM;

    // Cascade through common backups
    for (const lang of ['pt', 'en', 'es']) {
      const f = captions.find(c => code(c).startsWith(lang));
      if (f) return f;
    }
    return captions[0];
  }

  /* ── VTT / SRT → plain text ──────────────────────────────────── */
  function captionToText(raw) {
    if (!raw) return '';

    // Some endpoints return JSON3 transcripts (Google's format)
    if (raw.trim().startsWith('{')) {
      try {
        const j = JSON.parse(raw);
        if (j.events) {
          return j.events
            .map(e => (e.segs || []).map(s => s.utf8 || '').join(''))
            .join('\n')
            .replace(/\n{2,}/g, '\n')
            .trim();
        }
      } catch { /* fall through to text parser */ }
    }

    // XML format (legacy YouTube timedtext)
    if (raw.trim().startsWith('<')) {
      return raw
        .replace(/<text[^>]*>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
        .replace(/\n{2,}/g, '\n')
        .trim();
    }

    // VTT / SRT
    return raw
      .replace(/^WEBVTT.*$/m,                          '')
      .replace(/^NOTE.*$/gm,                           '')
      .replace(/^X-TIMESTAMP-MAP.*$/gm,                '')
      .replace(/^\s*\d+\s*$/gm,                        '')
      .replace(/^\d{1,2}:\d{2}:[\d.,]+\s*-->\s*.*$/gm, '')
      .replace(/<[^>]+>/g,                             '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
      .replace(/\r/g, '')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .join('\n');
  }

  /* ── Try one Invidious instance ──────────────────────────────── */
  async function tryInvidious(instance, videoId, langPref) {
    const listRes = await fetchWithTimeout(`${instance}/api/v1/captions/${videoId}`);
    if (!listRes.ok) throw new Error(`HTTP ${listRes.status}`);
    const list = await listRes.json();
    const captions = list.captions || [];
    if (!captions.length) return null;  // empty — try next provider

    const chosen = pickCaption(captions, langPref);
    if (!chosen) return null;

    const url = chosen.url?.startsWith('http') ? chosen.url : `${instance}${chosen.url}`;
    const capRes = await fetchWithTimeout(url);
    if (!capRes.ok) throw new Error(`VTT HTTP ${capRes.status}`);
    const raw  = await capRes.text();
    const text = captionToText(raw);
    if (!text || text.length < 10) return null;

    return {
      ok: true, text, rawVtt: raw,
      language: chosen.languageCode,
      label:    chosen.label,
      source:   `invidious:${instance.replace(/^https?:\/\//, '')}`,
    };
  }

  /* ── Try one Piped instance ──────────────────────────────────── */
  async function tryPiped(instance, videoId, langPref) {
    const res = await fetchWithTimeout(`${instance}/streams/${videoId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const subs = data.subtitles || [];
    if (!subs.length) return null;

    // Piped fields: { url, mimeType, name, code, autoGenerated }
    const chosen = pickCaption(subs, langPref);
    if (!chosen) return null;

    const url    = chosen.url;
    const capRes = await fetchWithTimeout(url);
    if (!capRes.ok) throw new Error(`VTT HTTP ${capRes.status}`);
    const raw  = await capRes.text();
    const text = captionToText(raw);
    if (!text || text.length < 10) return null;

    return {
      ok: true, text, rawVtt: raw,
      language: chosen.code,
      label:    chosen.name + (chosen.autoGenerated ? ' (auto)' : ''),
      source:   `piped:${instance.replace(/^https?:\/\//, '')}`,
    };
  }

  /* ── Public API: fetch transcript for one video ──────────────── */
  // Returns { ok, text, rawVtt, language, label, source, error, attempts }
  async function fetchTranscript(videoId, langPref = 'pt-BR') {
    const errors = [];

    // Phase 1: Invidious instances
    for (const inst of ranked(INVIDIOUS)) {
      try {
        const result = await tryInvidious(inst, videoId, langPref);
        if (result) {
          failureScore[inst] = Math.max(0, failureScore[inst] - 1);
          return { ...result, attempts: errors.length + 1 };
        }
        // null = empty list, not an instance failure → still increment lightly
        failureScore[inst] += 0.3;
        errors.push(`invidious ${inst}: vazio`);
      } catch (e) {
        failureScore[inst] += 2;
        errors.push(`invidious ${inst}: ${e.message}`);
      }
    }

    // Phase 2: Piped instances
    for (const inst of ranked(PIPED)) {
      try {
        const result = await tryPiped(inst, videoId, langPref);
        if (result) {
          failureScore[inst] = Math.max(0, failureScore[inst] - 1);
          return { ...result, attempts: errors.length + 1 };
        }
        failureScore[inst] += 0.3;
        errors.push(`piped ${inst}: vazio`);
      } catch (e) {
        failureScore[inst] += 2;
        errors.push(`piped ${inst}: ${e.message}`);
      }
    }

    // Diagnostic: log first failure for debugging
    if (errors.length) console.warn(`[transcripts] ${videoId}:`, errors.slice(0, 3));

    // Distinguish "video genuinely has no captions" from "all providers failed"
    const allEmpty = errors.every(e => e.endsWith('vazio'));
    return {
      ok:    false,
      error: allEmpty ? 'sem legendas (nenhuma instância encontrou)' : 'todas as instâncias falharam',
      attempts: errors.length,
      details:  errors.slice(0, 3).join(' | '),
    };
  }

  return { fetchTranscript, INSTANCES: [...INVIDIOUS, ...PIPED] };

})();
