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
    tokenClient.requestAccessToken({ prompt: '' });
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
      subscribers: Number(item.statistics?.subscriberCount) || 0
    };
    return channelCache;
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

  return { initOAuth, signIn, signOut, isSignedIn, getMyChannel,
           getTrafficSources, getGeography, getDemographics, getDevices };

})();
