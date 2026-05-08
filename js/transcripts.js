/* ─── Transcript fetcher (Invidious public instances) ───────────
   Browser-side download of YouTube captions for arbitrary videos
   (no OAuth needed). Goes through public Invidious instances since
   the official YouTube API blocks captions.download for non-owned
   videos.

   Reliability note: public instances come and go. We try several
   and fall back. If one fails for a video, we try the next.
─────────────────────────────────────────────────────────────── */

const Transcripts = (() => {

  // Public Invidious instances with API enabled (April 2026 list).
  // Updated occasionally — replace if stale (https://api.invidious.io/).
  const INSTANCES = [
    'https://yewtu.be',
    'https://invidious.nerdvpn.de',
    'https://inv.nadeko.net',
    'https://invidious.privacydev.net',
    'https://invidious.flokinet.to',
    'https://iv.melmac.space',
    'https://invidious.lunar.icu',
  ];

  // Track per-instance failure score so we deprioritize unreliable ones
  const failureScore = {};
  INSTANCES.forEach(i => failureScore[i] = 0);

  function rankedInstances() {
    return [...INSTANCES].sort((a, b) => failureScore[a] - failureScore[b]);
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

    // Try exact match first (e.g. "pt-BR")
    const exact = captions.find(c => c.languageCode?.toLowerCase() === langPref.toLowerCase());
    if (exact) return exact;

    // Try base language (e.g. "pt-BR" → "pt")
    const base = langPref.split('-')[0].toLowerCase();
    const baseMatch = captions.find(c => c.languageCode?.toLowerCase().startsWith(base));
    if (baseMatch) return baseMatch;

    // Cascade: common backup languages
    const cascade = ['pt', 'en', 'es'];
    for (const lang of cascade) {
      const found = captions.find(c => c.languageCode?.toLowerCase().startsWith(lang));
      if (found) return found;
    }

    // Last resort: first available
    return captions[0];
  }

  /* ── VTT / SRT → plain text ──────────────────────────────────── */
  function captionToText(raw) {
    if (!raw) return '';
    return raw
      .replace(/^WEBVTT.*$/m,                        '')   // VTT header
      .replace(/^NOTE.*$/gm,                         '')   // VTT comments
      .replace(/^X-TIMESTAMP-MAP.*$/gm,              '')   // VTT timestamp maps
      .replace(/^\s*\d+\s*$/gm,                      '')   // SRT cue numbers
      .replace(/^\d{1,2}:\d{2}:[\d.,]+\s*-->\s*.*$/gm, '') // VTT/SRT timestamps
      .replace(/<[^>]+>/g,                           '')   // tags <c>, <i>, etc
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
      .replace(/\r/g, '')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .join('\n');
  }

  /* ── Public: fetch transcript for a single video ─────────────── */
  // Returns { ok, text, rawVtt, language, label, source, error }
  async function fetchTranscript(videoId, langPref = 'pt-BR') {
    let lastError = '';

    for (const instance of rankedInstances()) {
      try {
        // 1) List available captions
        const listRes = await fetchWithTimeout(`${instance}/api/v1/captions/${videoId}`);
        if (!listRes.ok) {
          failureScore[instance] += 1;
          lastError = `HTTP ${listRes.status}`;
          continue;
        }
        const list = await listRes.json();
        const captions = list.captions || [];

        if (!captions.length) {
          // Video genuinely has no captions — no point trying other instances
          return { ok: false, error: 'sem legendas disponíveis', source: instance };
        }

        const chosen = pickCaption(captions, langPref);
        if (!chosen) {
          return { ok: false, error: 'idioma não disponível', source: instance };
        }

        // 2) Fetch the actual caption content
        const url = chosen.url?.startsWith('http')
          ? chosen.url
          : `${instance}${chosen.url}`;
        const capRes = await fetchWithTimeout(url);
        if (!capRes.ok) {
          failureScore[instance] += 1;
          lastError = `HTTP ${capRes.status} ao baixar VTT`;
          continue;
        }
        const raw  = await capRes.text();
        const text = captionToText(raw);

        if (!text || text.length < 10) {
          // Try next instance — content was empty/garbage
          failureScore[instance] += 1;
          lastError = 'conteúdo vazio';
          continue;
        }

        // Reset failure score on success (instance is healthy)
        failureScore[instance] = Math.max(0, failureScore[instance] - 1);

        return {
          ok:       true,
          text,
          rawVtt:   raw,
          language: chosen.languageCode,
          label:    chosen.label,
          source:   instance,
        };

      } catch (e) {
        failureScore[instance] += 2;  // network/timeout failures are worse
        lastError = e.message || 'erro';
        continue;
      }
    }

    return { ok: false, error: lastError || 'todas as instâncias falharam', source: null };
  }

  return { fetchTranscript, INSTANCES };

})();
