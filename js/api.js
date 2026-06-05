/* ─── YouTube Data API v3 wrapper ─────────────────────────────── */

const YTAPI = (() => {

  const BASE = 'https://www.googleapis.com/youtube/v3';

  /* ── Low-level fetch ────────────────────────────────────────── */
  async function get(endpoint, params, apiKey) {
    const url = new URL(`${BASE}/${endpoint}`);
    url.searchParams.set('key', apiKey);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    }
    const res  = await fetch(url.toString());
    const json = await res.json();
    if (!res.ok) {
      const reason = json.error?.errors?.[0]?.reason || '';
      const msg    = json.error?.message || `HTTP ${res.status}`;
      if (reason === 'quotaExceeded')       throw new Error('Cota da API esgotada para hoje. Tente amanhã.');
      if (reason === 'keyInvalid')          throw new Error('API Key inválida. Verifique no Google Cloud Console.');
      if (reason === 'accessNotConfigured') throw new Error('YouTube Data API v3 não está ativada neste projeto.');
      throw new Error(msg);
    }
    return json;
  }

  /* ── Resolve @handle / URL / channel ID ────────────────────── */
  async function resolveChannel(input, apiKey) {
    let h = input.trim();
    const urlMatch = h.match(/youtube\.com\/@([\w.-]+)/i);
    if (urlMatch) h = '@' + urlMatch[1];

    const isId = /^UC[\w-]{22}$/.test(h);

    const params = isId
      ? { part: 'snippet,statistics', id: h, maxResults: 1 }
      : { part: 'snippet,statistics', forHandle: h.replace(/^@/, ''), maxResults: 1 };

    const data = await get('channels', params, apiKey);
    if (!data.items?.length) throw new Error(`Canal "${input}" não encontrado.`);
    return mapChannelItem(data.items[0]);
  }

  function mapChannelItem(item) {
    const s  = item.snippet     || {};
    const st = item.statistics  || {};
    return {
      id:          item.id,
      handle:      s.customUrl  || '',
      name:        s.title      || '',
      thumbnail:   s.thumbnails?.default?.url || '',
      country:     s.country    || '',
      subscribers: Number(st.subscriberCount) || 0,
      viewCount:   Number(st.viewCount)       || 0,
      videoCount:  Number(st.videoCount)      || 0
    };
  }

  /* ── Get video IDs via playlistItems (cheap: 1 unit / 50 IDs) ─ */
  async function getVideoIds(channelId, apiKey, { dateFrom, dateTo, maxResults, onProgress } = {}) {
    // Step 1: get uploads playlist ID (1 unit)
    const chData = await get('channels', { part: 'contentDetails', id: channelId }, apiKey);
    if (!chData.items?.length) throw new Error('Canal não encontrado ao buscar playlist.');
    const uploadsId = chData.items[0].contentDetails.relatedPlaylists.uploads;

    // Step 2: paginate playlistItems (1 unit per page of 50)
    const dateFromISO = dateFrom ? new Date(dateFrom).toISOString() : null;
    const dateToISO   = dateTo   ? new Date(dateTo + 'T23:59:59Z').toISOString() : null;

    const ids = [];
    let pageToken = '';

    while (true) {
      const data = await get('playlistItems', {
        part:       'snippet',
        playlistId: uploadsId,
        maxResults: 50,
        pageToken:  pageToken || undefined
      }, apiKey);

      let stopPagination = false;

      for (const item of (data.items || [])) {
        const pub = item.snippet.publishedAt;
        // playlist is newest-first: stop when we go past dateFrom
        if (dateFromISO && pub < dateFromISO) { stopPagination = true; break; }
        // skip videos newer than dateTo
        if (dateToISO && pub > dateToISO) continue;

        ids.push(item.snippet.resourceId.videoId);
        if (ids.length >= maxResults) { stopPagination = true; break; }
      }

      if (onProgress) onProgress(ids.length);
      if (stopPagination || !data.nextPageToken) break;
      pageToken = data.nextPageToken;
    }

    return ids;
  }

  /* ── Fetch video details in batches of 50 (1 unit per batch) ── */
  async function getVideoDetails(ids, apiKey, parts) {
    if (!ids.length) return [];
    const results = [];
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50).join(',');
      const data  = await get('videos', { part: parts.join(','), id: batch }, apiKey);
      results.push(...(data.items || []));
    }
    return results;
  }

  /* ── Which API part each field requires ────────────────────── */
  const FIELD_PART = {
    'Canal':              null,            // from channel meta (free)
    'Handle':             null,
    'Título':             'snippet',
    'ID do Vídeo':        null,
    'URL':                null,
    'Thumbnail':          'snippet',
    'Descrição':          'snippet',
    'Publicado em':       'snippet',
    'Publicado em (ISO)': 'snippet',
    'Views':              'statistics',
    'Likes':              'statistics',
    'Comentários':        'statistics',
    'Inscritos do Canal': null,
    'Duração':            'contentDetails',
    'Duração (seg)':      'contentDetails',
    'Qualidade':          'contentDetails',
    'Tem Legenda':        'contentDetails',
    'Projeção':           'contentDetails',
    'Tags':               'snippet',
    'Categoria ID':       'snippet',
    'Idioma':             'snippet',
    'Privacidade':        'status',
    'Para Crianças':      'status',
    'Licença':            'status'
  };

  /* ── Build parts list from selected fields ──────────────────── */
  function buildParts(selectedFields, needContentDetails) {
    const parts = new Set(['snippet']); // snippet always needed
    for (const f of selectedFields) {
      const p = FIELD_PART[f];
      if (p) parts.add(p);
    }
    if (needContentDetails) parts.add('contentDetails'); // for duration filter
    return [...parts];
  }

  /* ── Extract one field value from a raw video item ──────────── */
  function extractField(field, video, ch) {
    const s  = video.snippet        || {};
    const st = video.statistics     || {};
    const cd = video.contentDetails || {};
    const ss = video.status         || {};
    switch (field) {
      case 'Canal':              return ch.name;
      case 'Handle':             return ch.handle ? '@' + ch.handle.replace(/^@/, '') : '';
      case 'Título':             return s.title || '';
      case 'ID do Vídeo':        return video.id;
      case 'URL':                return `https://youtube.com/watch?v=${video.id}`;
      case 'Thumbnail':          return s.thumbnails?.medium?.url || '';
      case 'Descrição':          return (s.description || '').substring(0, 500);
      case 'Publicado em':       return s.publishedAt ? new Date(s.publishedAt).toLocaleDateString('pt-BR') : '';
      case 'Publicado em (ISO)': return s.publishedAt || '';
      case 'Views':              return Number(st.viewCount)    || 0;
      case 'Likes':              return Number(st.likeCount)    || 0;
      case 'Comentários':        return Number(st.commentCount) || 0;
      case 'Inscritos do Canal': return ch.subscribers;
      case 'Duração':            return parseDuration(cd.duration || '');
      case 'Duração (seg)':      return parseDurationSec(cd.duration || '');
      case 'Qualidade':          return (cd.definition || '').toUpperCase();
      case 'Tem Legenda':        return cd.caption === 'true' ? 'Sim' : 'Não';
      case 'Projeção':           return cd.projection || '';
      case 'Tags':               return (s.tags || []).join(', ');
      case 'Categoria ID':       return s.categoryId || '';
      case 'Idioma':             return s.defaultLanguage || s.defaultAudioLanguage || '';
      case 'Privacidade':        return ss.privacyStatus || '';
      case 'Para Crianças':      return ss.madeForKids ? 'Sim' : 'Não';
      case 'Licença':            return ss.license || '';
      default:                   return '';
    }
  }

  /* ── Duration helpers ───────────────────────────────────────── */
  function parseDurationSec(iso) {
    if (!iso) return 0;
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return 0;
    return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
  }

  function parseDuration(iso) {
    const s = parseDurationSec(iso);
    if (!s && iso) return iso;
    const h  = Math.floor(s / 3600);
    const mi = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    if (h > 0) return `${h}:${String(mi).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
    return `${mi}:${String(ss).padStart(2,'0')}`;
  }

  /* ── Main extraction entry point ────────────────────────────── */
  // Quando há filtro de duração, paginamos página-por-página aplicando
  // o filtro a cada batch, até atingir maxResults OU esgotar o canal.
  // Isso garante "30 vídeos LONGOS mais recentes" em vez de
  // "30 mais recentes filtrados a posteriori".
  async function extractVideos(channels, apiKey, options, callbacks = {}) {
    const {
      selectedFields,
      dateFrom, dateTo,
      maxResults,
      durationMin, durationMax
    } = options;

    const { onChannelStart, onProgress, onChannelDone, onError } = callbacks;

    const hasDurFilter = durationMin !== null || durationMax !== null;
    const parts        = buildParts(selectedFields, hasDurFilter);
    const allRows      = [];

    const dateFromISO  = dateFrom ? new Date(dateFrom).toISOString() : null;
    const dateToISO    = dateTo   ? new Date(dateTo + 'T23:59:59Z').toISOString() : null;

    // Limite de segurança pra evitar runaway em canais com muitos vídeos
    const MAX_VIDEOS_SCANNED = 2000;

    for (let ci = 0; ci < channels.length; ci++) {
      const ch = channels[ci];
      try {
        if (onChannelStart) onChannelStart(ch, ci, channels.length);

        // 1. Pega o ID da playlist de uploads
        const chData = await get('channels',
          { part: 'contentDetails', id: ch.id }, apiKey);
        if (!chData.items?.length) throw new Error('Canal não encontrado.');
        const uploadsId = chData.items[0].contentDetails.relatedPlaylists.uploads;

        // 2. Pagina o feed de uploads, batch por batch
        const channelRows = [];
        let pageToken = '';
        let scanned   = 0;
        let stop      = false;

        while (!stop && channelRows.length < maxResults) {
          // 2a. Pega uma página de 50 IDs (mais novos primeiro)
          const pageData = await get('playlistItems', {
            part:       'snippet',
            playlistId: uploadsId,
            maxResults: 50,
            pageToken:  pageToken || undefined,
          }, apiKey);

          // 2b. Filtra por data e coleta IDs desta página
          const pageIds = [];
          for (const item of (pageData.items || [])) {
            const pub = item.snippet.publishedAt;
            if (dateFromISO && pub < dateFromISO) { stop = true; break; }
            if (dateToISO   && pub > dateToISO)   continue;
            pageIds.push(item.snippet.resourceId.videoId);
          }

          // 2c. Busca detalhes deste batch (1 quota unit)
          if (pageIds.length) {
            const data = await get('videos',
              { part: parts.join(','), id: pageIds.join(',') }, apiKey);

            for (const item of (data.items || [])) {
              if (channelRows.length >= maxResults) { stop = true; break; }

              // Aplica filtro de duração
              if (hasDurFilter) {
                const sec = parseDurationSec(item.contentDetails?.duration || '');
                if (durationMin !== null && sec < durationMin) continue;
                if (durationMax !== null && sec > durationMax) continue;
              }

              const row = {};
              for (const f of selectedFields) row[f] = extractField(f, item, ch);
              channelRows.push(row);
            }
          }

          scanned += pageIds.length;

          if (onProgress) {
            const msg = hasDurFilter
              ? `${channelRows.length}/${maxResults} aceitos (${scanned} vasculhados)`
              : `${channelRows.length}/${maxResults} coletados`;
            onProgress(ch, msg, ci, channels.length, Math.min(channelRows.length / maxResults, 0.9));
          }

          // Sai se não tem mais páginas, ou se passou do limite de segurança
          if (!pageData.nextPageToken) break;
          if (scanned >= MAX_VIDEOS_SCANNED) {
            if (onProgress) onProgress(ch, `Limite de ${MAX_VIDEOS_SCANNED} vídeos analisados atingido.`, ci, channels.length, 1);
            break;
          }
          pageToken = pageData.nextPageToken;
        }

        allRows.push(...channelRows);
        if (onChannelDone) onChannelDone(ch, channelRows.length, scanned);

      } catch (err) {
        if (onError) onError(ch, err);
      }
    }

    return allRows;
  }

  return { resolveChannel, extractVideos };

})();
