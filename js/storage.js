/* ─── Storage helpers ──────────────────────────────────────────
   Persists everything in localStorage under the 'yte_' namespace
──────────────────────────────────────────────────────────────── */

const Storage = (() => {

  const KEY_API           = 'yte_apikey';
  const KEY_LISTS         = 'yte_lists';
  const KEY_CLIENT_ID     = 'yte_oauth_client_id';
  const KEY_PRESETS       = 'yte_analytics_presets';
  const KEY_WORKER_URL    = 'yte_transcript_worker_url';
  const KEY_SUPADATA_KEY  = 'yte_supadata_api_key';
  const KEY_PROJECT_PATH  = 'yte_python_project_path';
  const KEY_HANDLES_STATE = 'yte_handles_resolver';
  const KEY_VIDIQ_TRENDING = 'yte_vidiq_trending';

  // Caminho padrão pra pasta python-transcript-downloader (ajustável via UI)
  const DEFAULT_PROJECT_PATH = 'C:\\Users\\RenatoSantiagoDeOliv\\OneDrive - EQI Investimentos\\Área de Trabalho\\git_\\youtube-extractor\\python-transcript-downloader';

  /* ── API Key ───────────────────────────────────────────────── */
  function saveApiKey(key) { localStorage.setItem(KEY_API, key); }
  function loadApiKey()    { return localStorage.getItem(KEY_API) || ''; }

  /* ── OAuth Client ID ───────────────────────────────────────── */
  function saveClientId(id) { localStorage.setItem(KEY_CLIENT_ID, id); }
  function loadClientId()   { return localStorage.getItem(KEY_CLIENT_ID) || ''; }

  /* ── Cloudflare Worker URL (transcripts) ───────────────────── */
  function saveWorkerUrl(url) { localStorage.setItem(KEY_WORKER_URL, url); }
  function loadWorkerUrl()    { return localStorage.getItem(KEY_WORKER_URL) || ''; }

  /* ── Supadata API key (transcripts) ────────────────────────── */
  function saveSupadataKey(k) { localStorage.setItem(KEY_SUPADATA_KEY, k); }
  function loadSupadataKey()  { return localStorage.getItem(KEY_SUPADATA_KEY) || ''; }

  /* ── Python script project path ─────────────────────────────── */
  function saveProjectPath(p) { localStorage.setItem(KEY_PROJECT_PATH, p); }
  function loadProjectPath()  { return localStorage.getItem(KEY_PROJECT_PATH) || DEFAULT_PROJECT_PATH; }

  /* ── Handles resolver state (Anbima list etc.) ──────────────── */
  function loadHandlesState() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY_HANDLES_STATE));
      return s || { names: [], results: {}, dailyLimit: 5, history: {} };
    } catch {
      return { names: [], results: {}, dailyLimit: 5, history: {} };
    }
  }
  function saveHandlesState(state) {
    localStorage.setItem(KEY_HANDLES_STATE, JSON.stringify(state));
  }

  /* ── Lists ─────────────────────────────────────────────────── */
  function loadLists() {
    try { return JSON.parse(localStorage.getItem(KEY_LISTS)) || []; }
    catch { return []; }
  }

  function saveLists(lists) {
    localStorage.setItem(KEY_LISTS, JSON.stringify(lists));
  }

  function createList(name) {
    const lists = loadLists();
    const list = {
      id: crypto.randomUUID(),
      name: name.trim(),
      createdAt: new Date().toISOString(),
      channels: []
    };
    lists.push(list);
    saveLists(lists);
    return list;
  }

  function updateList(id, patch) {
    const lists = loadLists();
    const idx = lists.findIndex(l => l.id === id);
    if (idx === -1) return null;
    lists[idx] = { ...lists[idx], ...patch };
    saveLists(lists);
    return lists[idx];
  }

  function deleteList(id) {
    const lists = loadLists().filter(l => l.id !== id);
    saveLists(lists);
  }

  function duplicateList(id) {
    const lists = loadLists();
    const orig = lists.find(l => l.id === id);
    if (!orig) return null;
    const copy = {
      ...JSON.parse(JSON.stringify(orig)),
      id: crypto.randomUUID(),
      name: orig.name + ' (cópia)',
      createdAt: new Date().toISOString()
    };
    lists.push(copy);
    saveLists(lists);
    return copy;
  }

  function addChannelToList(listId, channel) {
    const lists = loadLists();
    const list = lists.find(l => l.id === listId);
    if (!list) return false;
    if (list.channels.find(c => c.id === channel.id)) return false; // already there
    list.channels.push(channel);
    saveLists(lists);
    return true;
  }

  function removeChannelFromList(listId, channelId) {
    const lists = loadLists();
    const list = lists.find(l => l.id === listId);
    if (!list) return;
    list.channels = list.channels.filter(c => c.id !== channelId);
    saveLists(lists);
  }

  /* ── VidIQ Trending (resultados importados) ─────────────────── */
  function loadVidiqTrending() {
    try { return JSON.parse(localStorage.getItem(KEY_VIDIQ_TRENDING)) || null; }
    catch { return null; }
  }
  function saveVidiqTrending(data) {
    localStorage.setItem(KEY_VIDIQ_TRENDING, JSON.stringify(data));
  }

  /* ── Analytics presets ─────────────────────────────────────── */
  function loadAnalyticsPresets() {
    try { return JSON.parse(localStorage.getItem(KEY_PRESETS)) || []; }
    catch { return []; }
  }
  function saveAnalyticsPresets(arr) {
    localStorage.setItem(KEY_PRESETS, JSON.stringify(arr));
  }
  function saveAnalyticsPreset(preset) {
    const arr = loadAnalyticsPresets();
    const idx = arr.findIndex(p => p.name === preset.name);
    if (idx >= 0) arr[idx] = preset;
    else           arr.push(preset);
    saveAnalyticsPresets(arr);
    return preset;
  }
  function deleteAnalyticsPreset(name) {
    saveAnalyticsPresets(loadAnalyticsPresets().filter(p => p.name !== name));
  }

  return {
    saveApiKey, loadApiKey,
    saveClientId, loadClientId,
    saveWorkerUrl, loadWorkerUrl,
    saveSupadataKey, loadSupadataKey,
    saveProjectPath, loadProjectPath,
    loadHandlesState, saveHandlesState,
    loadVidiqTrending, saveVidiqTrending,
    loadLists, saveLists,
    createList, updateList, deleteList, duplicateList,
    addChannelToList, removeChannelFromList,
    loadAnalyticsPresets, saveAnalyticsPreset, deleteAnalyticsPreset
  };
})();
