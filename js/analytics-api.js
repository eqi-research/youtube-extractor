/* ─── YouTube Analytics API + OAuth ──────────────────────────── */

const AnalyticsAPI = (() => {

  const ANA_BASE  = 'https://youtubeanalytics.googleapis.com/v2';
  const DATA_BASE = 'https://www.googleapis.com/youtube/v3';

  let accessToken  = null;
  let tokenClient  = null;
  let channelCache = null;
  let onSignInCb   = null;
  let onErrorCb    = null;

  /* ── OAuth ──────────────────────────────────────────────────── */
  function initOAuth(clientId, onSignIn, onError) {
    onSignInCb = onSignIn;
    onErrorCb  = onError;

    if (!window.google?.accounts?.oauth2) {
      // GIS script may still be loading — retry once after a delay
      setTimeout(() => initOAuth(clientId, onSignIn, onError), 1500);
      return;
    }

    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: [
        'https://www.googleapis.com/auth/youtube.readonly',
        'https://www.googleapis.com/auth/yt-analytics.readonly'
      ].join(' '),
      callback: async (resp) => {
        if (resp.error) {
          if (onErrorCb) onErrorCb(resp.error_description || resp.error);
          return;
        }
        accessToken  = resp.access_token;
        channelCache = null;
        try {
          const ch = await getMyChannel();
          if (onSignInCb) onSignInCb(ch);
        } catch (e) {
          if (onErrorCb) onErrorCb(e.message);
        }
      }
    });
  }

  function signIn()  {
    if (!tokenClient) { if (onErrorCb) onErrorCb('Client ID não configurado ou Google ainda carregando.'); return; }
    // 'select_account' força o Google a mostrar o seletor de contas/canais
    // toda vez — essencial para quem tem brand accounts (múltiplos canais).
    tokenClient.requestAccessToken({ prompt: 'select_account' });
  }

  function signOut() {
    if (accessToken) google.accounts.oauth2.revoke(accessToken, () => {});
    accessToken  = null;
    channelCache = null;
  }

  function isSignedIn() { return !!accessToken; }

  /* ── HTTP helpers ───────────────────────────────────────────── */
  async function authFetch(url) {
    const res  = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const json = await res.json();
    if (!res.ok) {
      if (res.status === 401) accessToken = null;
      const msg = json.error?.message || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return json;
  }

  async function analyticsGet(params) {
    const url = new URL(`${ANA_BASE}/reports`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    return authFetch(url.toString());
  }

  async function dataGet(endpoint, params) {
    const url = new URL(`${DATA_BASE}/${endpoint}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    return authFetch(url.toString());
  }

  /* ── Channel info ───────────────────────────────────────────── */
  async function getMyChannel() {
    if (channelCache) return channelCache;
    const data = await dataGet('channels', { part: 'snippet,statistics', mine: true });
    if (!data.items?.length) throw new Error('Nenhum canal encontrado para esta conta.');
    const item = data.items[0];
    channelCache = {
      id:          item.id,
      name:        item.snippet.title,
      thumbnail:   item.snippet.thumbnails?.default?.url || '',
      subscribers: Number(item.statistics?.subscriberCount) || 0,
      videoCount:  Number(item.statistics?.videoCount)      || 0,
    };
    return channelCache;
  }

  /* ── Get uploads playlist id (cached on channelCache) ─────── */
  async function getUploadsPlaylistId() {
    if (channelCache?.uploads) return channelCache.uploads;
    const data = await dataGet('channels', { part: 'contentDetails', mine: true });
    const uploads = data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (channelCache) channelCache.uploads = uploads;
    return uploads;
  }

  /* ── Count videos published in [startDate, endDate] ─────────
     If durationMin/durationMax are provided, only videos within that
     duration range are counted (uses the cached durations).            */
  async function getVideosPublishedInPeriod(startDate, endDate, durationMin = null, durationMax = null) {
    const start = new Date(startDate + 'T00:00:00Z').getTime();
    const end   = new Date(endDate   + 'T23:59:59Z').getTime();

    // Need publishedAt for each video → walk uploads playlist
    const uploads = await getUploadsPlaylistId();
    if (!uploads) return 0;

    // Build a duration lookup if filter is active
    const hasDurationFilter = (durationMin != null || durationMax != null);
    let durationById = null;
    if (hasDurationFilter) {
      const all = await getAllVideosWithDuration();
      durationById = Object.fromEntries(all.map(v => [v.id, v.durationSec]));
    }

    let count = 0;
    let pageToken = '';
    let stop = false;
    while (!stop) {
      const params = { part: 'contentDetails', playlistId: uploads, maxResults: 50 };
      if (pageToken) params.pageToken = pageToken;
      const data = await dataGet('playlistItems', params);

      for (const it of (data.items || [])) {
        const id = it.contentDetails?.videoId;
        const t  = new Date(it.contentDetails?.videoPublishedAt || 0).getTime();
        if (!t) continue;
        if (t < start) { stop = true; continue; }
        if (t > end)   continue;

        if (hasDurationFilter) {
          const d = durationById[id] || 0;
          if (durationMin != null && d < durationMin) continue;
          if (durationMax != null && d > durationMax) continue;
        }
        count++;
      }
      if (!data.nextPageToken) stop = true;
      pageToken = data.nextPageToken;
    }
    return count;
  }

  /* ── Parse Analytics response to row objects ────────────────── */
  function toRows(data) {
    if (!data.rows?.length) return [];
    const headers = data.columnHeaders.map(h => h.name);
    return data.rows.map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    });
  }

  /* ── Enrich video IDs with titles ───────────────────────────── */
  async function enrichVideoTitles(rows, idField) {
    const ids = [...new Set(rows.map(r => r[idField]).filter(Boolean))];
    if (!ids.length) return rows;
    const map = {};
    for (let i = 0; i < ids.length; i += 50) {
      const data = await dataGet('videos', { part: 'snippet', id: ids.slice(i, i + 50).join(',') });
      for (const item of (data.items || [])) map[item.id] = item.snippet.title;
    }
    return rows.map(r => ({ ...r, _title: map[r[idField]] || r[idField] }));
  }

  /* ── Labels ─────────────────────────────────────────────────── */
  const TRAFFIC_LABELS = {
    'YT_SEARCH':          'Busca no YouTube',
    'SUGGESTED_VIDEO':    'Vídeo sugerido',
    'EXTERNAL':           'Externo',
    'DIRECT':             'Acesso direto',
    'YT_CHANNEL':         'Página do canal',
    'PLAYLIST':           'Playlist',
    'YT_SHORT':           'Shorts',
    'SHORTS_CONTAINER':   'Feed de Shorts',
    'NOTIFICATION':       'Notificação',
    'END_SCREEN':         'Tela final',
    'CARD':               'Cards',
    'NO_LINK_OTHER':      'Sem link (outros)',
    'YT_BROWSE_FEATURES': 'Início / Explorar',
    'HASHTAG':            'Hashtag',
    'SUBSCRIBER':         'Feed de inscrições',
    'ADVERTISING':        'Publicidade',
    'CAMPAIGN_CARD':      'Card de campanha',
  };

  const AGE_LABELS = {
    'AGE_13_17': '13–17', 'AGE_18_24': '18–24', 'AGE_25_34': '25–34',
    'AGE_35_44': '35–44', 'AGE_45_54': '45–54', 'AGE_55_64': '55–64', 'AGE_65_': '65+'
  };

  const GENDER_LABELS = {
    'male': 'Masculino', 'female': 'Feminino', 'user_specified': 'Não informado'
  };

  const DEVICE_LABELS = {
    'DESKTOP': 'Desktop', 'MOBILE': 'Mobile', 'TABLET': 'Tablet',
    'TV': 'TV', 'GAME_CONSOLE': 'Console', 'UNKNOWN_PLATFORM': 'Desconhecido'
  };

  const SUBSCRIBED_LABELS = { 'SUBSCRIBED': 'Inscrito', 'UNSUBSCRIBED': 'Não inscrito' };
  const LIVE_LABELS       = { 'LIVE': 'Ao vivo', 'ON_DEMAND': 'Sob demanda' };

  const CONTENT_TYPE_LABELS = {
    'VIDEO_ON_DEMAND': 'Vídeo Longo',
    'SHORTS':          'Short',
    'LIVE_STREAM':     'Ao vivo',
    'STORY':           'Story',
    'UNSPECIFIED':     'Não especificado',
  };

  const METRIC_LABELS = {
    views:                        'Views',
    estimatedMinutesWatched:      'Minutos Assistidos',
    averageViewDuration:          'Duração Média (s)',
    averageViewPercentage:        '% Médio Assistido',
    subscribersGained:            'Inscritos Ganhos',
    subscribersLost:              'Inscritos Perdidos',
    likes:                        'Likes',
    dislikes:                     'Dislikes',
    shares:                       'Compartilhamentos',
    comments:                     'Comentários',
    uniqueViewers:                'Espectadores Únicos',
    cardClickRate:                'CTR de Cards (%)',
    cardImpressions:              'Impressões de Cards',
    viewerPercentage:             '% de Espectadores',
    // Synthetic (computed locally, not from Analytics API)
    videosPublishedInPeriod:      'Vídeos Publicados no Período',
    totalChannelVideos:           'Total de Vídeos do Canal (geral)',
    engagements:                  'Engajamentos',
  };

  const DIMENSION_LABELS = {
    video:                    'Vídeo',
    day:                      'Dia',
    month:                    'Mês',
    country:                  'País',
    ageGroup:                 'Faixa Etária',
    gender:                   'Gênero',
    deviceType:               'Dispositivo',
    operatingSystem:          'Sistema Operacional',
    insightTrafficSourceType: 'Fonte de Tráfego',
    sharingService:           'Serviço Compartilhamento',
    subscribedStatus:         'Status de Inscrição',
    liveOrOnDemand:           'Ao vivo / Sob demanda',
    creatorContentType:       'Tipo de Conteúdo',
  };

  // Given a dimension key and raw value, return a human-readable label (pt-BR).
  function translateDimValue(dim, val) {
    if (val == null) return val;
    switch (dim) {
      case 'country':                  return COUNTRY_NAMES[val]    || val;
      case 'ageGroup':                 return AGE_LABELS[val]       || val;
      case 'gender':                   return GENDER_LABELS[val]    || val;
      case 'deviceType':               return DEVICE_LABELS[val]    || val;
      case 'insightTrafficSourceType': return TRAFFIC_LABELS[val]   || val;
      case 'subscribedStatus':         return SUBSCRIBED_LABELS[val]|| val;
      case 'liveOrOnDemand':           return LIVE_LABELS[val]      || val;
      case 'creatorContentType':       return CONTENT_TYPE_LABELS[val] || val;
      default:                         return val;
    }
  }

  const COUNTRY_NAMES = {
    'BR':'Brasil','US':'EUA','MX':'México','AR':'Argentina','CO':'Colômbia','CL':'Chile',
    'PE':'Peru','VE':'Venezuela','PT':'Portugal','ES':'Espanha','FR':'França','DE':'Alemanha',
    'IT':'Itália','GB':'Reino Unido','CA':'Canadá','AU':'Austrália','JP':'Japão',
    'KR':'Coreia do Sul','CN':'China','IN':'Índia','RU':'Rússia','BO':'Bolívia',
    'EC':'Equador','PY':'Paraguai','UY':'Uruguai','GT':'Guatemala','HN':'Honduras',
    'SV':'El Salvador','NI':'Nicarágua','CR':'Costa Rica','PA':'Panamá','CU':'Cuba',
    'DO':'Rep. Dominicana','PR':'Porto Rico','NL':'Países Baixos','BE':'Bélgica',
    'CH':'Suíça','AT':'Áustria','PL':'Polônia','SE':'Suécia','NO':'Noruega',
    'DK':'Dinamarca','FI':'Finlândia','IE':'Irlanda','ZA':'África do Sul',
    'NG':'Nigéria','EG':'Egito','AO':'Angola','MZ':'Moçambique','TR':'Turquia',
    'SA':'Arábia Saudita','ID':'Indonésia','PH':'Filipinas','TH':'Tailândia',
    'VN':'Vietnã','MY':'Malásia','PK':'Paquistão','BD':'Bangladesh','NZ':'Nova Zelândia',
    'GH':'Gana','KE':'Quênia','TZ':'Tanzânia','ET':'Etiópia','MA':'Marrocos',
  };

  /* ── Reports ─────────────────────────────────────────────────── */

  async function getTrafficSources({ startDate, endDate, byVideo, onProgress }) {
    if (onProgress) onProgress('Buscando fontes de tráfego…', 0.3);

    const data = await analyticsGet({
      ids:        'channel==MINE',
      startDate,
      endDate,
      metrics:    'views,estimatedMinutesWatched',
      dimensions: byVideo ? 'video,insightTrafficSourceType' : 'insightTrafficSourceType',
      sort:       '-views',
      maxResults: 200
    });

    let rows = toRows(data);
    if (!rows.length) return [];

    if (byVideo) {
      if (onProgress) onProgress('Buscando títulos dos vídeos…', 0.6);
      rows = await enrichVideoTitles(rows, 'video');
    }

    if (onProgress) onProgress('Concluído', 1);

    return rows.map(r => {
      const out = {};
      if (byVideo) {
        out['Título']       = r._title || r.video;
        out['ID do Vídeo']  = r.video;
      }
      out['Fonte de Tráfego']    = TRAFFIC_LABELS[r.insightTrafficSourceType] || r.insightTrafficSourceType;
      out['Views']               = Number(r.views) || 0;
      out['Minutos Assistidos']  = Math.round(Number(r.estimatedMinutesWatched) || 0);
      return out;
    });
  }

  async function getGeography({ startDate, endDate, onProgress }) {
    if (onProgress) onProgress('Buscando dados por país…', 0.5);
    const data = await analyticsGet({
      ids: 'channel==MINE', startDate, endDate,
      metrics:    'views,estimatedMinutesWatched,subscribersGained,subscribersLost',
      dimensions: 'country',
      sort:       '-views',
      maxResults: 250
    });
    if (onProgress) onProgress('Concluído', 1);
    return toRows(data).map(r => ({
      'País':                COUNTRY_NAMES[r.country] || r.country,
      'Código':              r.country,
      'Views':               Number(r.views) || 0,
      'Minutos Assistidos':  Math.round(Number(r.estimatedMinutesWatched) || 0),
      'Inscritos Ganhos':    Number(r.subscribersGained) || 0,
      'Inscritos Perdidos':  Number(r.subscribersLost)   || 0,
    }));
  }

  async function getDemographics({ startDate, endDate, onProgress }) {
    if (onProgress) onProgress('Buscando dados demográficos…', 0.5);
    const data = await analyticsGet({
      ids: 'channel==MINE', startDate, endDate,
      metrics:    'viewerPercentage',
      dimensions: 'ageGroup,gender',
      sort:       '-viewerPercentage'
    });
    if (onProgress) onProgress('Concluído', 1);
    return toRows(data).map(r => ({
      'Faixa Etária':          AGE_LABELS[r.ageGroup]    || r.ageGroup,
      'Gênero':                GENDER_LABELS[r.gender]   || r.gender,
      '% de Espectadores':     Number((r.viewerPercentage || 0).toFixed(2)),
    }));
  }

  async function getDevices({ startDate, endDate, onProgress }) {
    if (onProgress) onProgress('Buscando dados de dispositivos…', 0.5);
    const data = await analyticsGet({
      ids: 'channel==MINE', startDate, endDate,
      metrics:    'views,estimatedMinutesWatched',
      dimensions: 'deviceType',
      sort:       '-views'
    });
    if (onProgress) onProgress('Concluído', 1);
    return toRows(data).map(r => ({
      'Dispositivo':         DEVICE_LABELS[r.deviceType] || r.deviceType,
      'Views':               Number(r.views) || 0,
      'Minutos Assistidos':  Math.round(Number(r.estimatedMinutesWatched) || 0),
    }));
  }

  /* ── Synthetic metrics (computed locally, not from Analytics API) ── */
  // Per-period: same value for every row (channel-wide)
  const PER_PERIOD_SYNTHETIC = ['videosPublishedInPeriod', 'totalChannelVideos'];
  // Per-row: computed from real metrics in the same row
  const PER_ROW_SYNTHETIC    = ['engagements'];
  const SYNTHETIC_METRICS    = [...PER_PERIOD_SYNTHETIC, ...PER_ROW_SYNTHETIC];

  /* ── Video durations cache (for duration filter) ─────────────
     Walking the uploads playlist + videos.list once per session.
     Keys: 'all' → [{id, durationSec, publishedAt}, …]                  */
  let videoDurationsCache = null;

  function parseISODuration(iso) {
    if (!iso) return 0;
    const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
    if (!m) return 0;
    return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
  }

  async function getAllVideosWithDuration(onProgress) {
    if (videoDurationsCache) return videoDurationsCache;
    const uploads = await getUploadsPlaylistId();
    if (!uploads) return [];

    // 1) Walk uploads playlist to collect all video IDs (newest first)
    const ids = [];
    let pageToken = '';
    let pageCount = 0;
    while (true) {
      const params = { part: 'contentDetails', playlistId: uploads, maxResults: 50 };
      if (pageToken) params.pageToken = pageToken;
      const data = await dataGet('playlistItems', params);
      for (const it of (data.items || [])) {
        const id = it.contentDetails?.videoId;
        if (id) ids.push(id);
      }
      pageCount++;
      if (onProgress) onProgress(`Listando vídeos do canal (${ids.length} encontrados)…`, 0.05);
      if (!data.nextPageToken) break;
      pageToken = data.nextPageToken;
      if (pageCount > 200) break;  // safety: 10000 videos max
    }

    // 2) Fetch durations in batches of 50
    const result = [];
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const data = await dataGet('videos', { part: 'contentDetails', id: batch.join(',') });
      for (const it of (data.items || [])) {
        result.push({
          id:           it.id,
          durationSec:  parseISODuration(it.contentDetails?.duration),
        });
      }
      if (onProgress) onProgress(`Lendo durações (${result.length}/${ids.length})…`, 0.1);
    }

    videoDurationsCache = result;
    return result;
  }

  async function getVideoIdsByDuration(minSec, maxSec, onProgress) {
    const all = await getAllVideosWithDuration(onProgress);
    return all
      .filter(v => (minSec == null || v.durationSec >= minSec)
                && (maxSec == null || v.durationSec <= maxSec))
      .map(v => v.id);
  }

  /* ── Custom report (à la carte metrics + dimensions) ───────── */
  // Returns { rows, rawRows } — `rows` is localized output; `rawRows` is the original
  // analytics response enriched with _title so the comparison join can use stable keys.
  // If `dimensions` is empty, the API returns a single aggregate row (channel total).
  async function runCustomReport({ startDate, endDate, metrics, dimensions, sort, maxResults, durationMin, durationMax, onProgress, _label = '' }) {
    if (!metrics?.length) throw new Error('Selecione ao menos uma métrica.');
    dimensions = dimensions || [];

    // Separate real vs synthetic metrics
    const apiMetrics       = metrics.filter(m => !SYNTHETIC_METRICS.includes(m));
    const syntheticMetrics = metrics.filter(m =>  SYNTHETIC_METRICS.includes(m));

    if (!apiMetrics.length && !dimensions.length && !syntheticMetrics.length) {
      throw new Error('Selecione ao menos uma métrica.');
    }

    // Build duration-based video ID filter, if any
    let videoIdFilter = null;
    if (durationMin != null || durationMax != null) {
      if (onProgress) onProgress(`Filtrando vídeos por duração${_label ? ' — '+_label : ''}…`, 0.05);
      const ids = await getVideoIdsByDuration(durationMin, durationMax, onProgress);
      if (!ids.length) {
        return { rows: [], rawRows: [], meta: { matchedVideos: 0 } };
      }
      // YouTube Analytics filter URL has a length limit (~500 IDs ≈ 6KB).
      // Truncate by recency (uploads playlist is newest-first).
      videoIdFilter = ids.slice(0, 500);
    }

    if (onProgress) onProgress(`Consultando YouTube Analytics${_label ? ' — '+_label : ''}…`, 0.2);

    // For 'engagements' synthetic, ensure likes/dislikes/comments are fetched
    const apiMetricsToFetch = new Set(apiMetrics);
    if (syntheticMetrics.includes('engagements')) {
      ['likes', 'dislikes', 'comments'].forEach(m => apiMetricsToFetch.add(m));
    }
    const apiMetricsArray = [...apiMetricsToFetch];

    let rawRows = [];
    if (apiMetricsArray.length) {
      const params = {
        ids:        'channel==MINE',
        startDate,
        endDate,
        metrics:    apiMetricsArray.join(','),
        maxResults: maxResults || 200,
      };
      if (dimensions.length) params.dimensions = dimensions.join(',');
      if (sort && apiMetricsArray.includes(sort.replace(/^-/, ''))) params.sort = sort;
      if (videoIdFilter)     params.filters    = `video==${videoIdFilter.join(',')}`;

      const data = await analyticsGet(params);
      rawRows    = toRows(data);
    } else if (!dimensions.length) {
      // Only synthetic metrics requested in aggregate mode → single placeholder row
      rawRows = [{}];
    }

    if (!rawRows.length) return { rows: [], rawRows: [] };

    // If 'video' is a dimension, enrich with titles
    if (dimensions.includes('video') && rawRows[0].video) {
      if (onProgress) onProgress(`Buscando títulos dos vídeos${_label ? ' — '+_label : ''}…`, 0.55);
      rawRows = await enrichVideoTitles(rawRows, 'video');
    }

    // Compute synthetic metric values (once for the whole period)
    const syntheticValues = {};
    if (syntheticMetrics.includes('videosPublishedInPeriod')) {
      if (onProgress) onProgress(`Contando vídeos publicados no período${_label ? ' — '+_label : ''}…`, 0.75);
      syntheticValues.videosPublishedInPeriod = await getVideosPublishedInPeriod(startDate, endDate, durationMin, durationMax);
    }
    if (syntheticMetrics.includes('totalChannelVideos')) {
      // If duration filter is active, "total of channel" means the count after filtering
      if (durationMin != null || durationMax != null) {
        const matched = await getVideoIdsByDuration(durationMin, durationMax);
        syntheticValues.totalChannelVideos = matched.length;
      } else {
        const ch = await getMyChannel();
        syntheticValues.totalChannelVideos = ch.videoCount || 0;
      }
    }

    if (onProgress) onProgress('Concluído', 1);

    // Build output rows: dimensions first (translated), then metrics
    const rows = rawRows.map(r => {
      const out = {};
      for (const dim of dimensions) {
        const label = DIMENSION_LABELS[dim] || dim;
        if (dim === 'video') {
          out['Título']      = r._title || r.video;
          out['ID do Vídeo'] = r.video;
        } else {
          out[label] = translateDimValue(dim, r[dim]);
          if (dim === 'country') out['Código do País'] = r[dim];
        }
      }
      // If no dimensions, label the single row as channel-wide total
      if (!dimensions.length) out['Escopo'] = 'Canal (total)';

      for (const m of metrics) {
        const label = METRIC_LABELS[m] || m;
        let v;
        if (m === 'engagements') {
          v = (Number(r.likes) || 0) + (Number(r.dislikes) || 0) + (Number(r.comments) || 0);
        } else if (PER_PERIOD_SYNTHETIC.includes(m)) {
          v = syntheticValues[m];
        } else {
          v = Number(r[m]);
          v = Number.isFinite(v) ? Number(v.toFixed(4)) : 0;
        }
        out[label] = v ?? 0;
      }
      return out;
    });

    return { rows, rawRows };
  }

  /* ── Comparison report (current period vs same-length previous period) ─ */
  async function runComparisonReport(opts) {
    const { startDate, endDate, metrics, dimensions, onProgress } = opts;

    // Calculate previous period of the same length, ending the day before startDate
    const dayMs     = 86400000;
    const startMs   = new Date(startDate + 'T00:00:00Z').getTime();
    const endMs     = new Date(endDate   + 'T00:00:00Z').getTime();
    const lengthMs  = endMs - startMs + dayMs;   // inclusive
    const prevEnd   = new Date(startMs - dayMs);
    const prevStart = new Date(prevEnd.getTime() - lengthMs + dayMs);
    const fmt = d => d.toISOString().slice(0, 10);

    // Build join key: raw dimension values (from rawRows), joined with |
    const keyOf = raw => dimensions.map(d => raw[d] ?? '').join('|');

    if (onProgress) onProgress('Consultando período atual…', 0.15);
    const cur = await runCustomReport({ ...opts, _label: 'atual',   onProgress: (m,f) => onProgress && onProgress(m, 0.15 + f*0.35) });

    if (onProgress) onProgress('Consultando período anterior…', 0.55);
    const prev = await runCustomReport({
      ...opts,
      startDate: fmt(prevStart),
      endDate:   fmt(prevEnd),
      _label:    'anterior',
      onProgress: (m, f) => onProgress && onProgress(m, 0.55 + f * 0.4),
    });

    // Index previous rows by join key
    const prevByKey = {};
    prev.rawRows.forEach((raw, i) => { prevByKey[keyOf(raw)] = prev.rows[i]; });

    // Merge: for each current row, append "(ant.)" and "Δ%" for each metric
    const merged = cur.rows.map((row, i) => {
      const key     = keyOf(cur.rawRows[i]);
      const prevRow = prevByKey[key];
      const out     = { ...row };
      for (const m of metrics) {
        const label    = METRIC_LABELS[m] || m;
        const curVal   = Number(row[label])        || 0;
        const prevVal  = prevRow ? Number(prevRow[label]) || 0 : 0;
        out[`${label} (ant.)`] = prevVal;
        out[`${label} Δ%`]     = prevVal === 0
          ? (curVal === 0 ? 0 : null)   // null will render as "—"
          : Number((((curVal - prevVal) / prevVal) * 100).toFixed(2));
      }
      delete prevByKey[key]; // mark consumed
      return out;
    });

    // Append rows that existed only in the previous period (brand new losses)
    const orphanKeys = Object.keys(prevByKey);
    for (const k of orphanKeys) {
      const prevRow = prevByKey[k];
      const out     = { ...prevRow };
      for (const m of metrics) {
        const label   = METRIC_LABELS[m] || m;
        const prevVal = Number(prevRow[label]) || 0;
        out[label]              = 0;          // current period has no data
        out[`${label} (ant.)`]  = prevVal;
        out[`${label} Δ%`]      = prevVal === 0 ? 0 : -100;
      }
      merged.push(out);
    }

    if (onProgress) onProgress('Concluído', 1);

    return {
      rows: merged,
      meta: {
        currentFrom:  startDate, currentTo: endDate,
        previousFrom: fmt(prevStart), previousTo: fmt(prevEnd),
      }
    };
  }

  return { initOAuth, signIn, signOut, isSignedIn, getMyChannel,
           getTrafficSources, getGeography, getDemographics, getDevices,
           runCustomReport, runComparisonReport,
           METRIC_LABELS, DIMENSION_LABELS };

})();
