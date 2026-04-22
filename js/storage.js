/* ─── Storage helpers ──────────────────────────────────────────
   Persists everything in localStorage under the 'yte_' namespace
──────────────────────────────────────────────────────────────── */

const Storage = (() => {

  const KEY_API       = 'yte_apikey';
  const KEY_LISTS     = 'yte_lists';
  const KEY_CLIENT_ID = 'yte_oauth_client_id';

  /* ── API Key ───────────────────────────────────────────────── */
  function saveApiKey(key) { localStorage.setItem(KEY_API, key); }
  function loadApiKey()    { return localStorage.getItem(KEY_API) || ''; }

  /* ── OAuth Client ID ───────────────────────────────────────── */
  function saveClientId(id) { localStorage.setItem(KEY_CLIENT_ID, id); }
  function loadClientId()   { return localStorage.getItem(KEY_CLIENT_ID) || ''; }

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

  return {
    saveApiKey, loadApiKey,
    saveClientId, loadClientId,
    loadLists, saveLists,
    createList, updateList, deleteList, duplicateList,
    addChannelToList, removeChannelFromList
  };
})();
