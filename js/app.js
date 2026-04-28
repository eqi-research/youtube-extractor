/* ─── App controller ──────────────────────────────────────────── */

;(function () {

  /* ── State ──────────────────────────────────────────────────── */
  let activeListId    = null;
  let pendingChannel  = null;
  let tableInstance   = null;
  let openCurrentView = 'table';   // 'table' | 'gallery' (Open tab)

  const $ = id => document.getElementById(id);

  /* ─────────────────────────────────────────────────────────────
     MODAL  (substitui prompt/confirm, que são bloqueados em iframe)
  ───────────────────────────────────────────────────────────────*/
  function showModal({ message, withInput = false, inputDefault = '', confirmLabel = 'OK', dangerConfirm = false }) {
    return new Promise(resolve => {
      const overlay    = $('modalOverlay');
      const msgEl      = $('modalMessage');
      const inputEl    = $('modalInput');
      const confirmBtn = $('modalConfirm');
      const cancelBtn  = $('modalCancel');

      msgEl.textContent          = message;
      confirmBtn.textContent     = confirmLabel;
      confirmBtn.className       = `btn btn-sm ${dangerConfirm ? 'btn-danger' : 'btn-accent'}`;
      inputEl.style.display      = withInput ? 'block' : 'none';
      if (withInput) { inputEl.value = inputDefault; setTimeout(() => inputEl.focus(), 50); }

      overlay.style.display = 'flex';

      function done(val) {
        overlay.style.display = 'none';
        confirmBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        inputEl.removeEventListener('keydown', onKey);
        resolve(val);
      }
      function onOk()     { done(withInput ? inputEl.value : true); }
      function onCancel() { done(null); }
      function onKey(e)   { if (e.key === 'Enter') onOk(); if (e.key === 'Escape') onCancel(); }

      confirmBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      if (withInput) inputEl.addEventListener('keydown', onKey);
    });
  }

  /* ─────────────────────────────────────────────────────────────
     TOAST
  ───────────────────────────────────────────────────────────────*/
  function toast(msg, type = 'info', duration = 3500) {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    $('toastContainer').appendChild(el);
    setTimeout(() => el.remove(), duration);
  }

  /* ─────────────────────────────────────────────────────────────
     API KEY
  ───────────────────────────────────────────────────────────────*/
  function initApiKey() {
    const saved = Storage.loadApiKey();
    if (saved) { $('apiKeyInput').value = saved; setApiKeyStatus(true); }

    $('saveApiKey').addEventListener('click', () => {
      const key = $('apiKeyInput').value.trim();
      if (!key) { toast('Cole sua API Key antes de salvar.', 'error'); return; }
      Storage.saveApiKey(key);
      setApiKeyStatus(true);
      toast('API Key salva!', 'success');
    });

    $('toggleApiKey').addEventListener('click', () => {
      const inp = $('apiKeyInput');
      inp.type = inp.type === 'password' ? 'text' : 'password';
    });
  }

  function setApiKeyStatus(ok) {
    const el = $('apiKeyStatus');
    el.textContent = ok ? '● Salva' : '';
    el.className   = ok ? 'ok' : '';
  }

  function getApiKey() {
    const k = Storage.loadApiKey();
    if (!k) { toast('Configure sua API Key primeiro.', 'error'); return null; }
    return k;
  }

  /* ─────────────────────────────────────────────────────────────
     FIELD CHECKBOXES  (master toggle + expand/collapse)
  ───────────────────────────────────────────────────────────────*/
  function initFieldToggles() {

    // Expand / collapse a group body
    document.querySelectorAll('.fg-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const group = btn.dataset.group;
        const body  = $(`fg-body-${group}`);
        const open  = btn.classList.contains('open');
        body.style.display = open ? 'none' : 'flex';
        btn.classList.toggle('open',   !open);
        btn.classList.toggle('closed',  open);
      });
    });

    // Master checkbox: check/uncheck all children
    document.querySelectorAll('.fg-master').forEach(master => {
      master.addEventListener('change', () => {
        const group    = master.dataset.group;
        const children = document.querySelectorAll(`.fi[data-group="${group}"]`);
        children.forEach(cb => { cb.checked = master.checked; });
        syncMaster(master);
      });
    });

    // Individual checkbox: sync master state
    document.querySelectorAll('.fi').forEach(cb => {
      cb.addEventListener('change', () => {
        const master = document.querySelector(`.fg-master[data-group="${cb.dataset.group}"]`);
        if (master) syncMaster(master);
        updateQuotaEstimate();
      });
    });

    // Initial sync
    document.querySelectorAll('.fg-master').forEach(syncMaster);
  }

  // Set master to checked / unchecked / indeterminate
  function syncMaster(master) {
    const group    = master.dataset.group;
    const children = [...document.querySelectorAll(`.fi[data-group="${group}"]`)];
    const checked  = children.filter(c => c.checked).length;
    master.indeterminate = checked > 0 && checked < children.length;
    master.checked       = checked === children.length;
  }

  /* ─────────────────────────────────────────────────────────────
     LISTS SIDEBAR
  ───────────────────────────────────────────────────────────────*/
  function renderLists() {
    const lists     = Storage.loadLists();
    const container = $('listItems');
    container.innerHTML = '';

    if (!lists.length) {
      container.innerHTML = '<div style="padding:14px;font-size:12px;color:var(--muted2);text-align:center">Nenhuma lista ainda</div>';
      return;
    }

    lists.forEach(list => {
      const el = document.createElement('div');
      el.className = 'list-item' + (list.id === activeListId ? ' active' : '');
      el.innerHTML = `
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(list.name)}</span>
        <span class="list-item-count">${list.channels.length}</span>
      `;
      el.addEventListener('click', () => activateList(list.id));
      container.appendChild(el);
    });
  }

  function activateList(id) {
    activeListId = id;
    renderLists();
    const list = Storage.loadLists().find(l => l.id === id);
    if (!list) return;

    $('activeListName').textContent   = list.name;
    $('listActions').style.display    = 'flex';
    $('addChannelArea').style.display = 'block';
    $('filtersPanel').style.display   = list.channels.length ? 'block' : 'none';

    renderChannels(list);
    updateQuotaEstimate();
  }

  function renderChannels(list) {
    const container = $('channelList');
    container.innerHTML = '';

    if (!list.channels.length) {
      container.innerHTML = '<div class="channel-empty">Nenhum canal nesta lista. Adicione usando o campo acima.</div>';
      return;
    }

    list.channels.forEach(ch => {
      const card = document.createElement('div');
      card.className = 'channel-card';
      card.innerHTML = `
        <img class="channel-card-thumb" src="${esc(ch.thumbnail)}" alt="" onerror="this.style.display='none'">
        <div class="channel-card-info">
          <span class="channel-card-name">${esc(ch.name)}</span>
          <span class="channel-card-meta">${esc(ch.handle ? '@'+ch.handle.replace('@','') : ch.id)}  ·  ${fmtNum(ch.subscribers)} inscritos</span>
        </div>
        <button class="btn btn-sm btn-danger">Remover</button>
      `;
      card.querySelector('button').addEventListener('click', () => {
        Storage.removeChannelFromList(activeListId, ch.id);
        activateList(activeListId);
        toast(`${ch.name} removido.`, 'info');
      });
      container.appendChild(card);
    });
  }

  /* ─────────────────────────────────────────────────────────────
     LIST ACTIONS  (new / rename / duplicate / delete / import / export)
  ───────────────────────────────────────────────────────────────*/
  function initListActions() {

    $('newListBtn').addEventListener('click', async () => {
      const name = await showModal({ message: 'Nome da nova lista:', withInput: true });
      if (!name?.trim()) return;
      const list = Storage.createList(name);
      renderLists();
      activateList(list.id);
      toast(`Lista "${list.name}" criada.`, 'success');
    });

    $('renameListBtn').addEventListener('click', async () => {
      const list = Storage.loadLists().find(l => l.id === activeListId);
      if (!list) return;
      const name = await showModal({ message: 'Novo nome:', withInput: true, inputDefault: list.name });
      if (!name?.trim()) return;
      Storage.updateList(activeListId, { name: name.trim() });
      $('activeListName').textContent = name.trim();
      renderLists();
      toast('Lista renomeada.', 'success');
    });

    $('duplicateListBtn').addEventListener('click', () => {
      const copy = Storage.duplicateList(activeListId);
      if (!copy) return;
      renderLists();
      activateList(copy.id);
      toast(`Lista duplicada como "${copy.name}".`, 'success');
    });

    $('deleteListBtn').addEventListener('click', async () => {
      const list = Storage.loadLists().find(l => l.id === activeListId);
      if (!list) return;
      const ok = await showModal({ message: `Excluir "${list.name}"? Isso não pode ser desfeito.`, confirmLabel: 'Excluir', dangerConfirm: true });
      if (!ok) return;
      Storage.deleteList(activeListId);
      activeListId = null;
      $('activeListName').textContent = '← Selecione ou crie uma lista';
      ['listActions','filtersPanel','tablePanel'].forEach(id => $( id).style.display = 'none');
      $('addChannelArea').style.display = 'none';
      $('channelList').innerHTML = '';
      renderLists();
      toast('Lista excluída.', 'info');
    });

    $('exportListBtn').addEventListener('click', () => {
      const list = Storage.loadLists().find(l => l.id === activeListId);
      if (!list) return;
      downloadJSON(list, `lista-${slug(list.name)}.json`);
      toast('Lista exportada.', 'success');
    });

    $('importListBtn').addEventListener('click', () => $('importListFile').click());
    $('importListFile').addEventListener('change', e => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const data = JSON.parse(ev.target.result);
          if (!data.name || !Array.isArray(data.channels)) throw new Error('Formato inválido');
          const lists = Storage.loadLists();
          const imported = { ...data, id: crypto.randomUUID(), name: data.name, createdAt: new Date().toISOString() };
          lists.push(imported);
          Storage.saveLists(lists);
          renderLists();
          activateList(imported.id);
          toast(`"${imported.name}" importada com ${imported.channels.length} canais.`, 'success');
        } catch (err) { toast('Arquivo inválido: ' + err.message, 'error'); }
      };
      reader.readAsText(file);
      e.target.value = '';
    });
  }

  /* ─────────────────────────────────────────────────────────────
     ADD CHANNEL
  ───────────────────────────────────────────────────────────────*/
  function initAddChannel() {
    $('addChannelBtn').addEventListener('click', searchChannel);
    $('channelInput').addEventListener('keydown', e => { if (e.key === 'Enter') searchChannel(); });
    $('confirmAddChannel').addEventListener('click', () => {
      if (!pendingChannel || !activeListId) return;
      const added = Storage.addChannelToList(activeListId, pendingChannel);
      if (!added) toast(`${pendingChannel.name} já está na lista.`, 'error');
      else        { toast(`${pendingChannel.name} adicionado!`, 'success'); activateList(activeListId); }
      hidePreview();
    });
    $('cancelAddChannel').addEventListener('click', hidePreview);
  }

  async function searchChannel() {
    const key   = getApiKey(); if (!key) return;
    const input = $('channelInput').value.trim();
    if (!input) { toast('Digite um @handle ou URL do canal.', 'error'); return; }

    const btn = $('addChannelBtn');
    btn.disabled    = true;
    btn.textContent = 'Buscando...';
    hidePreview();

    try {
      const ch = await YTAPI.resolveChannel(input, key);
      pendingChannel = ch;
      $('previewThumb').src          = ch.thumbnail;
      $('previewName').textContent   = ch.name;
      $('previewHandle').textContent = ch.handle ? '@' + ch.handle.replace('@','') : ch.id;
      $('previewSubs').textContent   = fmtNum(ch.subscribers) + ' inscritos';
      $('channelPreview').style.display = 'flex';
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Buscar canal';
    }
  }

  function hidePreview() {
    $('channelPreview').style.display = 'none';
    $('channelInput').value           = '';
    pendingChannel                    = null;
  }

  /* ─────────────────────────────────────────────────────────────
     QUOTA ESTIMATE
  ───────────────────────────────────────────────────────────────*/
  function updateQuotaEstimate() {
    if (!activeListId) return;
    const list = Storage.loadLists().find(l => l.id === activeListId);
    if (!list) return;
    const n      = list.channels.length;
    const max    = parseInt($('maxResults').value) || 500;
    const pages  = Math.ceil(max / 50);
    // playlistItems: 1 unit/page, videos.list: 1 unit/batch of 50, channels: 1 unit
    const est    = n * (1 + pages + Math.ceil(max / 50));
    $('quotaEstimate').textContent = `~${fmtNum(est)} unidades (${n} canal × ${max} vídeos máx.)`;
  }

  $('maxResults').addEventListener('input', updateQuotaEstimate);

  /* ─────────────────────────────────────────────────────────────
     FETCH DATA
  ───────────────────────────────────────────────────────────────*/
  function initFetch() {
    $('fetchBtn').addEventListener('click', fetchData);
  }

  function getSelectedFields() {
    // Scope to the Open tab's field list so we don't pick up the Private tab's checkboxes
    return [...document.querySelectorAll('#fieldsList .fi:checked')].map(cb => cb.dataset.field);
  }

  async function fetchData() {
    const key = getApiKey(); if (!key) return;
    if (!activeListId) { toast('Selecione uma lista primeiro.', 'error'); return; }

    const list = Storage.loadLists().find(l => l.id === activeListId);
    if (!list?.channels?.length) { toast('Adicione canais à lista antes de buscar.', 'error'); return; }

    const selectedFields = getSelectedFields();
    if (!selectedFields.length) { toast('Selecione ao menos um campo.', 'error'); return; }

    const durationMinVal = $('durationMin').value;
    const durationMaxVal = $('durationMax').value;

    const options = {
      selectedFields,
      dateFrom:    $('dateFrom').value  || null,
      dateTo:      $('dateTo').value    || null,
      maxResults:  Math.max(1, parseInt($('maxResults').value) || 500),
      durationMin: durationMinVal !== '' ? Number(durationMinVal) : null,
      durationMax: durationMaxVal !== '' ? Number(durationMaxVal) : null
    };

    const fetchBtn = $('fetchBtn');
    fetchBtn.disabled = true;
    $('progressArea').style.display = 'flex';
    setProgress(0, 'Iniciando...');

    try {
      const rows = await YTAPI.extractVideos(list.channels, key, options, {
        onChannelStart: (ch, ci, total) => {
          setProgress(ci / total, `Canal ${ci + 1}/${total}: ${ch.name}`);
        },
        onProgress: (ch, msg, ci, total, frac) => {
          setProgress((ci / total) + frac / total, `${ch.name} — ${msg}`);
        },
        onChannelDone: (ch, kept, total) => {
          toast(`${ch.name}: ${kept} vídeos${kept < total ? ` (${total - kept} filtrados por duração)` : ''}.`, 'info', 4000);
        },
        onError: (ch, err) => {
          toast(`Erro em ${ch.name}: ${err.message}`, 'error', 7000);
        }
      });

      setProgress(1, `Concluído — ${rows.length} vídeos`);

      if (!rows.length) { toast('Nenhum vídeo encontrado com os filtros aplicados.', 'info'); }
      else              { renderTable(rows); toast(`${fmtNum(rows.length)} vídeos carregados.`, 'success'); }

    } catch (err) {
      toast('Erro na extração: ' + err.message, 'error', 7000);
      setProgress(0, 'Erro.');
    } finally {
      fetchBtn.disabled = false;
    }
  }

  function setProgress(frac, text) {
    $('progressFill').style.width = Math.round(Math.min(frac, 1) * 100) + '%';
    $('progressText').textContent = text;
  }

  /* ─────────────────────────────────────────────────────────────
     TABLE
  ───────────────────────────────────────────────────────────────*/
  function buildColumn(key, firstRow) {
    const isNum      = typeof firstRow[key] === 'number';
    const isThumbnail = key === 'Thumbnail';
    const isURL      = key === 'URL';

    const col = {
      field:        key,
      headerFilter: isThumbnail ? false : 'input',
      sorter:       isNum ? 'number' : isThumbnail ? false : 'string',
      hozAlign:     isNum ? 'right' : 'left',
      minWidth:     70
    };

    // ── Cell formatter ──────────────────────────────────────────
    if (isThumbnail) {
      col.formatter = cell => {
        const url = cell.getValue();
        return url
          ? `<img src="${url}" style="height:38px;border-radius:3px;display:block;object-fit:cover;" onerror="this.style.display='none'">`
          : '';
      };
      col.width = 90;
    } else if (isURL) {
      col.formatter = cell =>
        `<a href="${cell.getValue()}" target="_blank" style="color:#2563eb;text-decoration:none;">↗ Abrir</a>`;
      col.width = 80;
    } else if (isNum) {
      col.formatter = cell => (cell.getValue() ?? 0).toLocaleString('pt-BR');
      col.width = 110;
    } else {
      col.width =
        key === 'Título'    ? 300 :
        key === 'Descrição' ? 300 :
        key === 'Tags'      ? 200 : undefined;
    }

    // ── Title (header) ──────────────────────────────────────────
    if (isThumbnail) {
      col.title = 'Thumbnail'; // fallback text
      col.titleFormatter = () => {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;align-items:center;gap:6px;';

        const label = document.createElement('span');
        label.textContent = 'Thumbnail';

        const btn = document.createElement('button');
        btn.className = 'th-zip-btn';
        btn.title = 'Baixar todas as thumbnails visíveis como ZIP';
        btn.innerHTML = '&#11015; ZIP';
        btn.addEventListener('click', e => { e.stopPropagation(); downloadThumbnailsZip(); });

        wrap.appendChild(label);
        wrap.appendChild(btn);
        return wrap;
      };
    } else {
      col.title = key;
    }

    return col;
  }

  function renderTable(rows) {
    if (!rows.length) return;
    const firstRow = rows[0];
    const columns  = Object.keys(firstRow).map(k => buildColumn(k, firstRow));

    $('tablePanel').style.display = 'block';
    $('tableStats').textContent   = `${fmtNum(rows.length)} vídeo${rows.length !== 1 ? 's' : ''}`;

    // reset "show all" button
    const showAllBtn = $('showAllRowsBtn');
    showAllBtn.textContent = 'Mostrar todas as linhas';
    showAllBtn.classList.remove('btn-accent');
    showAllBtn.classList.add('btn-ghost');

    if (tableInstance) {
      tableInstance.setColumns(columns);
      tableInstance.setData(rows);
    } else {
      tableInstance = new Tabulator('#dataTable', {
        data:           rows,
        columns,
        layout:         'fitDataFill',
        pagination:     'local',
        paginationSize: 50,
        paginationSizeSelector: [25, 50, 100, 250],
        movableColumns: true,
        height:         '520px',
        placeholder:    'Nenhum dado',
        rowHeight:      48
      });
    }

    setTimeout(() => $('tablePanel').scrollIntoView({ behavior: 'smooth' }), 200);

    // Re-render gallery se estiver visível
    if (openCurrentView === 'gallery') renderGallery();
  }

  /* ─────────────────────────────────────────────────────────────
     DOWNLOAD THUMBNAILS AS ZIP
  ───────────────────────────────────────────────────────────────*/
  async function downloadThumbnailsZip() {
    if (!tableInstance) return;

    // Use only the currently filtered/visible rows
    const data  = tableInstance.getData('active');
    const items = data.filter(row => row['Thumbnail']);

    if (!items.length) {
      toast('Nenhuma thumbnail disponível nas linhas visíveis.', 'error');
      return;
    }

    toast(`Preparando ${items.length} thumbnails…`, 'info', 20000);

    const zip    = new JSZip();
    const folder = zip.folder('thumbnails');

    // Fetch in batches of 8 to avoid overwhelming the browser
    const BATCH = 8;
    let done = 0, failed = 0;

    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH);
      await Promise.all(batch.map(async (row, bi) => {
        const url = row['Thumbnail'];
        const idx = i + bi;
        // Build filename: prefer ID, fall back to index
        const id    = row['ID do Vídeo'] || String(idx + 1).padStart(4, '0');
        const fname = `${id}.jpg`;
        try {
          const res  = await fetch(url);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const blob = await res.blob();
          folder.file(fname, blob);
          done++;
        } catch {
          failed++;
        }
      }));
    }

    if (!done) { toast('Não foi possível baixar nenhuma thumbnail.', 'error'); return; }

    toast(`Gerando ZIP de ${done} thumbnails…`, 'info', 10000);

    const content = await zip.generateAsync({ type: 'blob' });
    const a = Object.assign(document.createElement('a'), {
      href:     URL.createObjectURL(content),
      download: `thumbnails-${dateTag()}.zip`
    });
    a.click();
    URL.revokeObjectURL(a.href);

    const msg = failed
      ? `ZIP gerado: ${done} thumbnails (${failed} falharam).`
      : `ZIP gerado com ${done} thumbnails!`;
    toast(msg, 'success');
  }

  /* ─────────────────────────────────────────────────────────────
     EXPORT
  ───────────────────────────────────────────────────────────────*/
  function initExport() {
    $('exportCsvBtn').addEventListener('click',  () => { if (tableInstance) tableInstance.download('csv',  `youtube-data-${dateTag()}.csv`,  { bom: true }); });
    $('exportXlsxBtn').addEventListener('click', () => { if (tableInstance) tableInstance.download('xlsx', `youtube-data-${dateTag()}.xlsx`, { sheetName: 'Dados YT' }); });
    $('exportPdfBtn').addEventListener('click',  () => {
      // Despacha conforme a view atual
      if (openCurrentView === 'gallery') exportGalleryToPDF();
      else                               exportTabulatorToPDF(tableInstance, `youtube-data-${dateTag()}.pdf`, 'Dados YouTube — Open');
    });
  }

  /* ─────────────────────────────────────────────────────────────
     GALLERY VIEW (Open tab)
  ───────────────────────────────────────────────────────────────*/
  function initGalleryToggle() {
    $('openViewTableBtn').addEventListener('click',   () => applyOpenView('table'));
    $('openViewGalleryBtn').addEventListener('click', () => applyOpenView('gallery'));
    $('gallerySortBy').addEventListener('change', renderGallery);
  }

  function applyOpenView(view) {
    openCurrentView = view;
    $('openViewTableBtn').classList.toggle('active',   view === 'table');
    $('openViewGalleryBtn').classList.toggle('active', view === 'gallery');
    $('dataTable').style.display      = view === 'table'   ? '' : 'none';
    $('dataGallery').style.display    = view === 'gallery' ? '' : 'none';
    $('gallerySortBy').style.display  = view === 'gallery' ? '' : 'none';
    $('showAllRowsBtn').style.display = view === 'table'   ? '' : 'none';
    if (view === 'gallery') renderGallery();
  }

  function renderGallery() {
    const container = $('dataGallery');
    if (!container) return;
    container.innerHTML = '';
    if (!tableInstance) {
      container.innerHTML = '<div class="gallery-empty">Gere uma busca primeiro para ver os vídeos.</div>';
      return;
    }

    // Use rows currently visible in the Tabulator (respects header filters)
    let rows = tableInstance.getData('active');
    if (!rows.length) {
      container.innerHTML = '<div class="gallery-empty">Nenhum vídeo nessa filtragem.</div>';
      return;
    }

    // Verifica se o campo Thumbnail foi extraído
    const hasThumb = rows.some(r => r['Thumbnail']);
    if (!hasThumb) {
      container.innerHTML = `
        <div class="gallery-empty">
          ⚠️ Marque o campo <strong>"Thumbnail (URL)"</strong> em <em>Identificação</em> e clique em <strong>Buscar dados</strong> de novo.<br>
          A galeria precisa do link da thumbnail pra exibir as imagens.
        </div>`;
      return;
    }

    rows = sortGalleryRows(rows, $('gallerySortBy').value);

    rows.forEach((r, i) => {
      const card = document.createElement('div');
      card.className = 'gallery-card';

      const thumb     = esc(r['Thumbnail'] || '');
      const title     = esc(r['Título']    || '(sem título)');
      const channel   = esc(r['Canal']     || '');
      const date      = esc(r['Publicado em'] || r['Publicado em (ISO)'] || '');
      const views     = Number(r['Views']) || 0;
      const likes     = Number(r['Likes']) || 0;
      const comments  = Number(r['Comentários']) || 0;
      const duration  = esc(r['Duração'] || '');
      const url       = esc(r['URL'] || '');

      card.innerHTML = `
        <div class="gallery-rank">#${i + 1}</div>
        <img class="gallery-thumb" src="${thumb}" alt="" loading="lazy" onerror="this.style.background='var(--bg4)';this.src=''">
        <div class="gallery-info">
          <h3 class="gallery-title">${title}</h3>
          <div class="gallery-meta">
            ${channel  ? `<span class="gallery-channel">${channel}</span>`         : ''}
            ${date     ? `<span>${date}</span>`                                    : ''}
            ${duration ? `<span>⏱ ${duration}</span>`                              : ''}
          </div>
          <div class="gallery-stats">
            <span class="gallery-views">▶ ${fmtNum(views)} views</span>
            ${likes    ? `<span>👍 ${fmtNum(likes)}</span>`    : ''}
            ${comments ? `<span>💬 ${fmtNum(comments)}</span>` : ''}
          </div>
          ${url ? `<a class="gallery-link" href="${url}" target="_blank">Abrir no YouTube ↗</a>` : ''}
        </div>
      `;
      container.appendChild(card);
    });
  }

  function sortGalleryRows(rows, sort) {
    const arr = [...rows];
    const getDate = r => {
      const s = r['Publicado em (ISO)'] || r['Publicado em'] || '';
      const t = new Date(s).getTime();
      return Number.isFinite(t) ? t : 0;
    };
    switch (sort) {
      case 'views-desc': arr.sort((a, b) => (Number(b.Views) || 0) - (Number(a.Views) || 0)); break;
      case 'views-asc':  arr.sort((a, b) => (Number(a.Views) || 0) - (Number(b.Views) || 0)); break;
      case 'channel':    arr.sort((a, b) => (a.Canal || '').localeCompare(b.Canal || '', 'pt-BR')); break;
      case 'date-desc':  arr.sort((a, b) => getDate(b) - getDate(a)); break;
      case 'date-asc':   arr.sort((a, b) => getDate(a) - getDate(b)); break;
      case 'likes-desc': arr.sort((a, b) => (Number(b.Likes) || 0) - (Number(a.Likes) || 0)); break;
    }
    return arr;
  }

  // PDF export of the gallery (visual snapshot via html2canvas)
  async function exportGalleryToPDF() {
    const target = $('dataGallery');
    if (!target || !target.children.length) { toast('Galeria vazia.', 'error'); return; }
    if (typeof html2canvas !== 'function' || !window.jspdf) {
      toast('Bibliotecas de PDF ainda carregando, tente em 2 segundos.', 'error'); return;
    }

    toast('Capturando galeria… isso leva alguns segundos.', 'info', 8000);

    const canvas = await html2canvas(target, {
      scale: 2,
      backgroundColor: '#ffffff',
      logging: false,
      windowWidth: target.scrollWidth,
      useCORS: true,
    });

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 8;
    const headerSpace = 16;

    const imgW = pageW - margin * 2;
    const imgH = (canvas.height * imgW) / canvas.width;

    const drawHeader = () => {
      pdf.setFontSize(13); pdf.setTextColor(20);
      pdf.text('Galeria de Thumbnails — YouTube Extractor', margin, 8);
      pdf.setFontSize(9);  pdf.setTextColor(80);
      pdf.text(`Ordenação: ${$('gallerySortBy').selectedOptions[0]?.text || ''} · Gerado em ${new Date().toLocaleString('pt-BR')}`, margin, 13);
    };

    const imgData = canvas.toDataURL('image/jpeg', 0.85);

    let heightLeft = imgH;
    let position   = headerSpace;

    drawHeader();
    pdf.addImage(imgData, 'JPEG', margin, position, imgW, imgH);
    heightLeft -= (pageH - position - margin);

    while (heightLeft > 0) {
      pdf.addPage();
      drawHeader();
      position = headerSpace - (imgH - heightLeft);
      pdf.addImage(imgData, 'JPEG', margin, position, imgW, imgH);
      heightLeft -= (pageH - headerSpace - margin);
    }

    pdf.save(`galeria-thumbnails-${dateTag()}.pdf`);
    toast('PDF gerado!', 'success');
  }

  /* ─────────────────────────────────────────────────────────────
     HELPERS
  ───────────────────────────────────────────────────────────────*/
  function esc(str) {
    return String(str || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function fmtNum(n) {
    const v = Number(n) || 0;
    if (v >= 1e9) return (v/1e9).toFixed(1) + 'B';
    if (v >= 1e6) return (v/1e6).toFixed(1) + 'M';
    if (v >= 1e3) return (v/1e3).toFixed(1) + 'k';
    return v.toLocaleString('pt-BR');
  }

  function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
  function dateTag() { return new Date().toISOString().slice(0,10); }

  function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a    = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
    a.click(); URL.revokeObjectURL(a.href);
  }

  /* ─────────────────────────────────────────────────────────────
     INIT
  ───────────────────────────────────────────────────────────────*/
  /* ─────────────────────────────────────────────────────────────
     SIDEBAR COLLAPSE
  ───────────────────────────────────────────────────────────────*/
  function initSidebarToggle() {
    const sidebar = $('sidebar');
    const btn     = $('sidebarToggle');
    let collapsed = false;

    btn.addEventListener('click', () => {
      collapsed = !collapsed;
      sidebar.classList.toggle('collapsed', collapsed);
      btn.classList.toggle('collapsed', collapsed);
      btn.innerHTML = collapsed ? '&#9654;' : '&#9664;';
      btn.title     = collapsed ? 'Expandir menu' : 'Colapsar menu';
    });
  }

  /* ─────────────────────────────────────────────────────────────
     SHOW ALL ROWS
  ───────────────────────────────────────────────────────────────*/
  function initShowAllRows() {
    const btn = $('showAllRowsBtn');
    let showingAll = false;

    btn.addEventListener('click', () => {
      if (!tableInstance) return;
      showingAll = !showingAll;
      if (showingAll) {
        tableInstance.setMaxHeight(false);
        tableInstance.setPageSize(tableInstance.getData().length || 9999);
        btn.textContent = 'Paginar';
        btn.classList.replace('btn-ghost', 'btn-accent');
      } else {
        tableInstance.setPageSize(50);
        tableInstance.setMaxHeight('520px');
        btn.textContent = 'Mostrar todas as linhas';
        btn.classList.replace('btn-accent', 'btn-ghost');
      }
    });
  }

  /* ─────────────────────────────────────────────────────────────
     TABS
  ───────────────────────────────────────────────────────────────*/
  function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(b  => b.classList.toggle('active', b.dataset.tab === tab));
        document.querySelectorAll('.tab-pane').forEach(p => p.style.display = p.id === `tab-${tab}` ? '' : 'none');
        $('apikeyArea').style.display = tab === 'open' ? 'flex' : 'none';
      });
    });
  }

  /* ─────────────────────────────────────────────────────────────
     PRIVATE TAB
  ───────────────────────────────────────────────────────────────*/
  let analyticsTableInstance = null;
  let lastReportData = null;          // { rows, metrics, dimensions, hasComparison }
  let currentView    = (localStorage.getItem('yte_view_preference') || 'table'); // 'table' | 'panel'

  function initPrivateTab() {
    const saved = Storage.loadClientId();
    if (saved) { $('oauthClientId').value = saved; tryInitOAuth(saved); }

    $('saveClientId').addEventListener('click', () => {
      const id = $('oauthClientId').value.trim();
      if (!id) { toast('Cole o Client ID primeiro.', 'error'); return; }
      Storage.saveClientId(id);
      toast('Client ID salvo!', 'success');
      tryInitOAuth(id);
    });

    $('signInBtn').addEventListener('click',  () => AnalyticsAPI.signIn());
    $('signOutBtn').addEventListener('click', () => { AnalyticsAPI.signOut(); setAuthStatus(null); });

    // Date presets (botões 7/28/90/365)
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const days = parseInt(btn.dataset.days);
        applyRelativePeriod(days);
        $('analyticsRelative').value = String(days);
      });
    });

    // Período relativo (dropdown)
    $('analyticsRelative').addEventListener('change', () => {
      const v = $('analyticsRelative').value;
      if (v) applyRelativePeriod(parseInt(v));
    });

    // Quando usuário edita as datas manualmente, limpa o "relativo"
    ['analyticsDateFrom','analyticsDateTo'].forEach(id => {
      $(id).addEventListener('input', () => { $('analyticsRelative').value = ''; });
    });

    // Presets do usuário
    $('savePresetBtn').addEventListener('click',   onSavePreset);
    $('loadPresetBtn').addEventListener('click',   onLoadPreset);
    $('deletePresetBtn').addEventListener('click', onDeletePreset);
    renderPresetSelect();

    // View toggle (Tabela / Painel)
    $('viewTableBtn').addEventListener('click', () => applyView('table'));
    $('viewPanelBtn').addEventListener('click', () => applyView('panel'));
    applyView(currentView, /* skipRender */ true);  // initial UI state

    // Recipes: pre-select metric + dimension combos
    document.querySelectorAll('.recipe-btn').forEach(btn => {
      btn.addEventListener('click', () => applyRecipe(btn.dataset.recipe));
    });

    // When analytics checkboxes change, refresh the "sort by" dropdown
    document.querySelectorAll('.afi').forEach(cb => cb.addEventListener('change', refreshSortOptions));

    $('runReportBtn').addEventListener('click', runReport);
    refreshSortOptions();

    $('analyticsCsvBtn').addEventListener('click',  () => {
      if (analyticsTableInstance) analyticsTableInstance.download('csv',  `analytics-${dateTag()}.csv`,  { bom: true });
    });
    $('analyticsXlsxBtn').addEventListener('click', () => {
      if (analyticsTableInstance) analyticsTableInstance.download('xlsx', `analytics-${dateTag()}.xlsx`, { sheetName: 'Analytics' });
    });
    $('analyticsPdfBtn').addEventListener('click',  () => exportAnalyticsToPDF());

    // Show all rows toggle
    let anaShowingAll = false;
    $('analyticsShowAllBtn').addEventListener('click', () => {
      if (!analyticsTableInstance) return;
      anaShowingAll = !anaShowingAll;
      if (anaShowingAll) {
        analyticsTableInstance.setMaxHeight(false);
        analyticsTableInstance.setPageSize(analyticsTableInstance.getData().length || 9999);
        $('analyticsShowAllBtn').textContent = 'Paginar';
        $('analyticsShowAllBtn').classList.replace('btn-ghost', 'btn-accent');
      } else {
        analyticsTableInstance.setPageSize(50);
        analyticsTableInstance.setMaxHeight('520px');
        $('analyticsShowAllBtn').textContent = 'Mostrar todas as linhas';
        $('analyticsShowAllBtn').classList.replace('btn-accent', 'btn-ghost');
      }
    });

    // Default: last 28 days
    const today = new Date();
    $('analyticsDateTo').value   = today.toISOString().slice(0, 10);
    $('analyticsDateFrom').value = new Date(today.getTime() - 28 * 86400000).toISOString().slice(0, 10);
  }

  function tryInitOAuth(clientId) {
    AnalyticsAPI.initOAuth(clientId,
      ch  => setAuthStatus(ch),
      err => {
        $('authStatus').innerHTML = `<span class="auth-err">&#10005; ${esc(err)}</span>`;
        toast('Erro de autenticação: ' + err, 'error', 6000);
      }
    );
  }

  function setAuthStatus(channel) {
    if (channel) {
      $('signInBtn').textContent    = 'Reconectar';
      $('signOutBtn').style.display = 'inline-flex';
      $('authStatus').innerHTML     = `
        <img src="${esc(channel.thumbnail)}" style="width:32px;height:32px;border-radius:50%;vertical-align:middle;margin-right:8px" onerror="this.style.display='none'">
        <span class="auth-ok">
          Conectado como <strong>${esc(channel.name)}</strong>
          <span style="color:var(--muted2);font-size:12px;margin-left:6px">
            · ${fmtNum(channel.subscribers)} inscritos
            · ID <code style="background:var(--bg3);padding:1px 5px;border-radius:3px">${esc(channel.id)}</code>
            · <a href="https://www.youtube.com/channel/${esc(channel.id)}" target="_blank" style="color:#2563eb;text-decoration:none">abrir no YouTube ↗</a>
          </span>
        </span>`;
      $('reportConfigPanel').style.display = 'block';
    } else {
      $('signInBtn').textContent    = 'Entrar com Google';
      $('signOutBtn').style.display = 'none';
      $('authStatus').innerHTML     = '';
      $('reportConfigPanel').style.display   = 'none';
      $('analyticsTablePanel').style.display = 'none';
    }
  }

  /* ── Receitas prontas ─────────────────────────────────────── */
  const RECIPES = {
    totalChannel:       { m: ['views','estimatedMinutesWatched','averageViewDuration','averageViewPercentage','subscribersGained','subscribersLost','likes','comments','shares','engagements','videosPublishedInPeriod','totalChannelVideos'], d: [] },
    geography:    { m: ['views','estimatedMinutesWatched','subscribersGained','subscribersLost'], d: ['country'] },
    demographics: { m: ['viewerPercentage'], d: ['ageGroup','gender'] },
    devices:      { m: ['views','estimatedMinutesWatched'], d: ['deviceType'] },
    trafficVideo: { m: ['views','estimatedMinutesWatched'], d: ['video','insightTrafficSourceType'] },
    trafficTotal: { m: ['views','estimatedMinutesWatched'], d: ['insightTrafficSourceType'] },
    byDay:        { m: ['views','estimatedMinutesWatched','subscribersGained'], d: ['day'] },
    byMonth:      { m: ['views','estimatedMinutesWatched','subscribersGained'], d: ['month'] },
    topVideos:    { m: ['views','estimatedMinutesWatched','likes','comments','shares'], d: ['video'] },
    clear:        { m: [], d: [] },
  };

  function applyRecipe(name) {
    const r = RECIPES[name]; if (!r) return;
    document.querySelectorAll('.afi').forEach(cb => { cb.checked = r.m.includes(cb.dataset.key); });
    document.querySelectorAll('.adi').forEach(cb => { cb.checked = r.d.includes(cb.dataset.key); });
    // Sync masters
    document.querySelectorAll('.fg-master[data-group="ana-metrics"], .fg-master[data-group="ana-dims"]').forEach(syncMaster);
    refreshSortOptions();
  }

  function getSelectedAnalytics() {
    const metrics    = [...document.querySelectorAll('.afi:checked')].map(cb => cb.dataset.key);
    const dimensions = [...document.querySelectorAll('.adi:checked')].map(cb => cb.dataset.key);
    return { metrics, dimensions };
  }

  function refreshSortOptions() {
    const sel = $('analyticsSortBy'); if (!sel) return;
    const { metrics } = getSelectedAnalytics();
    const prev = sel.value;
    sel.innerHTML = '<option value="">(primeira métrica, decrescente)</option>' +
      metrics.map(m => `<option value="${m}">${AnalyticsAPI.METRIC_LABELS[m] || m}</option>`).join('');
    if (metrics.includes(prev)) sel.value = prev;
  }

  /* ── Período relativo ─────────────────────────────────────── */
  function applyRelativePeriod(days) {
    const to   = new Date();
    const from = new Date(to.getTime() - days * 86400000);
    $('analyticsDateTo').value   = to.toISOString().slice(0, 10);
    $('analyticsDateFrom').value = from.toISOString().slice(0, 10);
  }

  /* ── Presets ──────────────────────────────────────────────── */
  function getCurrentPresetState() {
    const { metrics, dimensions } = getSelectedAnalytics();
    return {
      metrics, dimensions,
      sortBy:      $('analyticsSortBy').value,
      sortDir:     $('analyticsSortDir').value,
      maxResults:  parseInt($('analyticsMaxResults').value) || 200,
      compare:     $('analyticsCompare').checked,
      relative:    $('analyticsRelative').value,
      dateFrom:    $('analyticsDateFrom').value,
      dateTo:      $('analyticsDateTo').value,
      durationMin: $('analyticsDurationMin').value,
      durationMax: $('analyticsDurationMax').value,
      view:        currentView,
    };
  }

  function applyPresetState(p) {
    document.querySelectorAll('.afi').forEach(cb => { cb.checked = (p.metrics    || []).includes(cb.dataset.key); });
    document.querySelectorAll('.adi').forEach(cb => { cb.checked = (p.dimensions || []).includes(cb.dataset.key); });
    document.querySelectorAll('.fg-master[data-group="ana-metrics"], .fg-master[data-group="ana-dims"]').forEach(syncMaster);

    $('analyticsSortDir').value     = p.sortDir     || 'desc';
    $('analyticsMaxResults').value  = p.maxResults  || 200;
    $('analyticsCompare').checked   = !!p.compare;
    $('analyticsRelative').value    = p.relative    || '';
    $('analyticsDurationMin').value = p.durationMin != null ? p.durationMin : '';
    $('analyticsDurationMax').value = p.durationMax != null ? p.durationMax : '';

    refreshSortOptions();
    if (p.sortBy) $('analyticsSortBy').value = p.sortBy;

    if (p.relative) {
      applyRelativePeriod(parseInt(p.relative));
    } else {
      if (p.dateFrom) $('analyticsDateFrom').value = p.dateFrom;
      if (p.dateTo)   $('analyticsDateTo').value   = p.dateTo;
    }

    if (p.view) applyView(p.view, /* skipRender */ true);
  }

  function renderPresetSelect() {
    const sel = $('presetSelect'); if (!sel) return;
    const presets = Storage.loadAnalyticsPresets();
    const cur = sel.value;
    sel.innerHTML = '<option value="">— escolha um preset salvo —</option>' +
      presets.map(p => `<option value="${esc(p.name)}">${esc(p.name)}${p.relative ? ` · últimos ${p.relative}d` : ''}</option>`).join('');
    if (presets.find(p => p.name === cur)) sel.value = cur;
  }

  async function onSavePreset() {
    const state = getCurrentPresetState();
    if (!state.metrics.length) {
      toast('Selecione pelo menos uma métrica antes de salvar o preset.', 'error');
      return;
    }
    const name = await showModal({ message: 'Nome do preset (ex: R_Follow_UP):', withInput: true, inputDefault: $('presetSelect').value || '' });
    if (!name?.trim()) return;

    // Confirmar sobrescrita
    const existing = Storage.loadAnalyticsPresets().find(p => p.name === name.trim());
    if (existing) {
      const ok = await showModal({ message: `Já existe um preset chamado "${name.trim()}". Sobrescrever?`, confirmLabel: 'Sobrescrever', dangerConfirm: true });
      if (!ok) return;
    }

    const preset = { name: name.trim(), createdAt: new Date().toISOString(), ...state };
    Storage.saveAnalyticsPreset(preset);
    renderPresetSelect();
    $('presetSelect').value = preset.name;
    toast(`Preset "${preset.name}" salvo.`, 'success');
  }

  function onLoadPreset() {
    const name = $('presetSelect').value;
    if (!name) { toast('Escolha um preset na lista primeiro.', 'error'); return; }
    const preset = Storage.loadAnalyticsPresets().find(p => p.name === name);
    if (!preset) return;
    applyPresetState(preset);
    toast(`Preset "${name}" carregado.`, 'success');
  }

  async function onDeletePreset() {
    const name = $('presetSelect').value;
    if (!name) { toast('Escolha um preset na lista primeiro.', 'error'); return; }
    const ok = await showModal({ message: `Excluir preset "${name}"?`, confirmLabel: 'Excluir', dangerConfirm: true });
    if (!ok) return;
    Storage.deleteAnalyticsPreset(name);
    renderPresetSelect();
    toast(`Preset "${name}" excluído.`, 'info');
  }

  async function runReport() {
    if (!AnalyticsAPI.isSignedIn()) { toast('Faça login primeiro.', 'error'); return; }

    const startDate = $('analyticsDateFrom').value;
    const endDate   = $('analyticsDateTo').value;
    if (!startDate || !endDate) { toast('Selecione o período.', 'error'); return; }
    if (new Date(startDate) > new Date(endDate)) { toast('Data inicial maior que a final.', 'error'); return; }

    const { metrics, dimensions } = getSelectedAnalytics();
    if (!metrics.length) { toast('Selecione ao menos uma métrica.', 'error'); return; }
    // dimensions pode ser vazio → relatório agregado (Total do canal)
    if (!dimensions.length) {
      toast('Sem dimensão: gerando totais do canal no período.', 'info', 4000);
    }

    // Build sort parameter
    const sortBy  = $('analyticsSortBy').value || metrics[0];
    const sortDir = $('analyticsSortDir').value === 'asc' ? '' : '-';
    const sort    = `${sortDir}${sortBy}`;

    const maxResults  = Math.max(1, parseInt($('analyticsMaxResults').value) || 200);
    const compare     = $('analyticsCompare').checked;

    const durMinVal   = $('analyticsDurationMin').value;
    const durMaxVal   = $('analyticsDurationMax').value;
    const durationMin = durMinVal !== '' ? Number(durMinVal) : null;
    const durationMax = durMaxVal !== '' ? Number(durMaxVal) : null;

    // Warn if comparing with day/month dimension (dates won't align)
    if (compare && (dimensions.includes('day') || dimensions.includes('month'))) {
      toast('Comparação não faz sentido com dimensão "Dia" ou "Mês" (as datas mudam entre períodos). Desmarque a comparação ou remova essa dimensão.', 'error', 8000);
      return;
    }

    const runBtn = $('runReportBtn');
    runBtn.disabled = true;
    $('analyticsProgress').style.display = 'flex';
    setAnaProgress(0, 'Iniciando…');

    try {
      const reportOpts = {
        startDate, endDate, metrics, dimensions, sort, maxResults,
        durationMin, durationMax,
        onProgress: (msg, frac) => setAnaProgress(frac, msg)
      };

      let rows;
      if (compare) {
        const res = await AnalyticsAPI.runComparisonReport(reportOpts);
        rows = res.rows;
        if (rows?.length) {
          toast(`Comparando ${res.meta.currentFrom} → ${res.meta.currentTo} com ${res.meta.previousFrom} → ${res.meta.previousTo}.`, 'info', 6000);
        }
      } else {
        const res = await AnalyticsAPI.runCustomReport(reportOpts);
        rows = res.rows;
      }

      if (!rows?.length) {
        const hint = (durationMin != null || durationMax != null)
          ? ' Verifique se o filtro de duração não está excluindo todos os vídeos.'
          : '';
        toast('Nenhum dado encontrado para o período.' + hint, 'info', 6000);
        return;
      }

      // Show an info about the duration filter result
      if (durationMin != null || durationMax != null) {
        const range = `${durationMin != null ? '≥'+durationMin+'s' : ''}${durationMin != null && durationMax != null ? ' e ' : ''}${durationMax != null ? '≤'+durationMax+'s' : ''}`;
        toast(`Filtro de duração ativo: ${range}.`, 'info', 4000);
      }

      lastReportData = { rows, metrics, dimensions, hasComparison: compare };
      renderAnalyticsTable(rows);
      renderAnalyticsPanel(rows, metrics, dimensions, compare);
      applyView(currentView);
      toast(`Relatório gerado: ${fmtNum(rows.length)} linhas.`, 'success');

    } catch (err) {
      // Many errors from the Analytics API are about invalid metric+dimension combos
      const hint = /metric|dimension|combination|not supported/i.test(err.message)
        ? ' — verifique se as métricas e dimensões escolhidas são compatíveis (ex: "% de Espectadores" só vai com Faixa etária/Gênero).'
        : '';
      toast('Erro: ' + err.message + hint, 'error', 9000);
    } finally {
      runBtn.disabled = false;
      $('analyticsProgress').style.display = 'none';
    }
  }

  function setAnaProgress(frac, text) {
    $('analyticsProgressFill').style.width = Math.round(Math.min(frac, 1) * 100) + '%';
    $('analyticsProgressText').textContent = text;
  }

  function renderAnalyticsTable(rows) {
    // Pick a row that has the most keys defined (in case orphan rows lack some fields)
    const firstRow = rows.reduce((a, b) => Object.keys(b).length > Object.keys(a).length ? b : a, rows[0]);
    const columns  = Object.keys(firstRow).map(key => {
      const sample  = rows.find(r => r[key] != null)?.[key];
      const isNum   = typeof sample === 'number';
      const isDelta = / Δ%$/.test(key);

      let formatter;
      if (isDelta) {
        formatter = cell => {
          const v = cell.getValue();
          if (v == null) return '<span style="color:var(--muted2)">—</span>';
          const color = v > 0 ? '#16a34a' : v < 0 ? '#dc2626' : 'var(--muted2)';
          const arrow = v > 0 ? '▲' : v < 0 ? '▼' : '•';
          return `<span style="color:${color};font-weight:600">${arrow} ${v.toLocaleString('pt-BR')}%</span>`;
        };
      } else if (isNum) {
        formatter = cell => (cell.getValue() ?? 0).toLocaleString('pt-BR');
      }

      return {
        title: key, field: key,
        headerFilter: 'input',
        sorter:    isNum || isDelta ? 'number' : 'string',
        hozAlign:  isNum || isDelta ? 'right'  : 'left',
        formatter,
        width:     key === 'Título' ? 300 : key === 'País' ? 160 : isDelta ? 110 : isNum ? 140 : undefined,
        minWidth:  80
      };
    });

    $('analyticsTablePanel').style.display = 'block';
    $('analyticsTableStats').textContent   = `${fmtNum(rows.length)} linha${rows.length !== 1 ? 's' : ''}`;
    $('analyticsShowAllBtn').textContent   = 'Mostrar todas as linhas';
    $('analyticsShowAllBtn').classList.remove('btn-accent');
    $('analyticsShowAllBtn').classList.add('btn-ghost');

    if (analyticsTableInstance) {
      analyticsTableInstance.setColumns(columns);
      analyticsTableInstance.setData(rows);
    } else {
      analyticsTableInstance = new Tabulator('#analyticsTable', {
        data: rows, columns,
        layout: 'fitDataFill',
        pagination: 'local', paginationSize: 50,
        paginationSizeSelector: [25, 50, 100, 250],
        movableColumns: true, height: '520px', placeholder: 'Nenhum dado'
      });
    }
    setTimeout(() => $('analyticsTablePanel').scrollIntoView({ behavior: 'smooth' }), 200);
  }

  /* ─────────────────────────────────────────────────────────────
     PANEL VIEW (cards)
  ───────────────────────────────────────────────────────────────*/

  // Métricas que NÃO podem ser somadas (são médias / percentuais)
  const NON_ADDITIVE_METRICS = new Set([
    'averageViewDuration', 'averageViewPercentage',
    'viewerPercentage',    'cardClickRate',
  ]);

  // Métricas sintéticas que sempre são "do canal" — nunca quebram por dimensão
  const PER_PERIOD_SYNTHETIC = ['videosPublishedInPeriod', 'totalChannelVideos'];

  function applyView(view, skipRender = false) {
    currentView = view;
    localStorage.setItem('yte_view_preference', view);
    $('viewTableBtn')?.classList.toggle('active', view === 'table');
    $('viewPanelBtn')?.classList.toggle('active', view === 'panel');
    if ($('analyticsTable'))      $('analyticsTable').style.display      = view === 'table' ? '' : 'none';
    if ($('analyticsPanel'))      $('analyticsPanel').style.display      = view === 'panel' ? 'grid' : 'none';
    if ($('analyticsShowAllBtn')) $('analyticsShowAllBtn').style.display = view === 'table' ? '' : 'none';
    if (!skipRender && view === 'panel' && lastReportData) {
      renderAnalyticsPanel(lastReportData.rows, lastReportData.metrics, lastReportData.dimensions, lastReportData.hasComparison);
    }
  }

  function renderAnalyticsPanel(rows, metrics, dimensions, hasComparison) {
    const container = $('analyticsPanel');
    if (!container) return;
    container.innerHTML = '';
    if (!rows?.length || !metrics?.length) return;

    for (const m of metrics) {
      const label = AnalyticsAPI.METRIC_LABELS[m] || m;
      const card  = document.createElement('div');
      card.className = 'metric-card';

      const isPerPeriodSynthetic = PER_PERIOD_SYNTHETIC.includes(m);
      const showSingleValue = !dimensions.length || isPerPeriodSynthetic;

      if (showSingleValue) {
        card.innerHTML = renderSingleValueCard(rows[0] || {}, label, hasComparison);
      } else {
        card.innerHTML = renderBreakdownCard(rows, m, label, dimensions, hasComparison);
      }
      container.appendChild(card);
    }
  }

  function renderSingleValueCard(row, label, hasComparison) {
    const cur  = Number(row[label]) || 0;
    const dPct = hasComparison ? row[`${label} Δ%`] : null;
    const prev = hasComparison ? (Number(row[`${label} (ant.)`]) || 0) : null;

    let html = `
      <div class="metric-card-title">${esc(label)}</div>
      <div class="metric-card-big">${formatNumber(cur)}</div>
    `;
    if (hasComparison) {
      html += renderDeltaBlock(dPct, prev);
    }
    return html;
  }

  function renderBreakdownCard(rows, metricKey, label, dimensions, hasComparison) {
    const isAvg     = NON_ADDITIVE_METRICS.has(metricKey);
    const dimSuffix = 'por ' + dimensions.map(d => AnalyticsAPI.DIMENSION_LABELS[d] || d).join(' × ');
    const MAX_ROWS  = 50;

    // Sort rows by current metric value, descending, for the visualization
    const sorted = [...rows].sort((a, b) => (Number(b[label]) || 0) - (Number(a[label]) || 0));
    const slice   = sorted.slice(0, MAX_ROWS);
    const omitted = sorted.length - slice.length;

    const maxAbs = Math.max(1, ...slice.map(r => Math.abs(Number(r[label]) || 0)));

    let html = `
      <div class="metric-card-title">${esc(label)}</div>
      <div class="metric-card-subtitle">${esc(dimSuffix)}</div>
    `;

    for (const r of slice) {
      const dimLabel = rowDimensionLabel(r, dimensions);
      const v        = Number(r[label]) || 0;
      const dPct     = hasComparison ? r[`${label} Δ%`] : null;
      const widthPct = (v / maxAbs) * 100;
      html += `
        <div class="metric-card-row">
          <span class="metric-card-row-label" title="${esc(dimLabel)}">${esc(dimLabel)}</span>
          <span class="metric-card-row-value">${formatNumber(v)}</span>
          <span class="metric-card-row-delta">${formatDeltaInline(dPct)}</span>
          <div class="metric-card-row-bar"><div style="width:${Math.max(0, widthPct)}%"></div></div>
        </div>
      `;
    }

    if (omitted > 0) {
      html += `<div class="metric-card-omitted">+ ${omitted} outros (use a Tabela para ver todos)</div>`;
    }

    html += `<div class="metric-card-divider"></div>`;
    if (isAvg) {
      html += `<div class="metric-card-total"><span>Total</span><span title="Não somável (é uma média)" style="color:var(--muted2)">—</span></div>`;
    } else {
      const totalCur  = sorted.reduce((s, r) => s + (Number(r[label]) || 0), 0);
      const totalPrev = hasComparison
        ? sorted.reduce((s, r) => s + (Number(r[`${label} (ant.)`]) || 0), 0)
        : null;
      const totalDelta = (totalPrev != null && totalPrev > 0)
        ? ((totalCur - totalPrev) / totalPrev) * 100
        : (totalPrev === 0 && totalCur === 0 ? 0 : null);

      html += `
        <div class="metric-card-total">
          <span>Soma</span>
          <span>${formatNumber(totalCur)}</span>
        </div>
      `;
      if (hasComparison) {
        html += `<div style="text-align:right;margin-top:2px">${formatDeltaInline(totalDelta)}</div>`;
        if (totalPrev != null) {
          html += `<div class="metric-card-prev" style="text-align:right">vs ant. ${formatNumber(totalPrev)}</div>`;
        }
      }
    }
    return html;
  }

  function rowDimensionLabel(row, dimensions) {
    const parts = [];
    for (const d of dimensions) {
      const lbl = AnalyticsAPI.DIMENSION_LABELS[d] || d;
      if (d === 'video')  parts.push(row['Título'] || row['ID do Vídeo'] || '');
      else                parts.push(row[lbl] ?? '');
    }
    return parts.filter(Boolean).join(' — ') || '(sem rótulo)';
  }

  function formatNumber(v) {
    if (v == null || isNaN(v)) return '0';
    const n = Number(v);
    // Mantém duas casas decimais para valores fracionários abaixo de 100
    if (!Number.isInteger(n) && Math.abs(n) < 1000) {
      return n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    }
    return Math.round(n).toLocaleString('pt-BR');
  }

  function renderDeltaBlock(dPct, prevVal) {
    if (dPct == null) {
      return `<div class="metric-card-delta flat">— sem base anterior</div>`;
    }
    const cls = dPct > 0 ? 'up' : dPct < 0 ? 'down' : 'flat';
    const arr = dPct > 0 ? '▲' : dPct < 0 ? '▼' : '•';
    return `
      <div class="metric-card-delta ${cls}">${arr} ${dPct.toLocaleString('pt-BR')}%</div>
      <div class="metric-card-prev">vs ant. ${formatNumber(prevVal)}</div>
    `;
  }

  function formatDeltaInline(dPct) {
    if (dPct == null) return `<span style="color:var(--muted2)">—</span>`;
    const color = dPct > 0 ? 'var(--green)' : dPct < 0 ? 'var(--accent)' : 'var(--muted2)';
    const arr   = dPct > 0 ? '▲' : dPct < 0 ? '▼' : '•';
    return `<span style="color:${color};font-weight:600">${arr} ${dPct.toLocaleString('pt-BR')}%</span>`;
  }

  /* ─────────────────────────────────────────────────────────────
     PDF EXPORT
  ───────────────────────────────────────────────────────────────*/
  // Header info shown at the top of every analytics PDF.
  function buildPdfHeader() {
    const from = $('analyticsDateFrom').value;
    const to   = $('analyticsDateTo').value;
    const dur  = [];
    if ($('analyticsDurationMin').value !== '') dur.push(`≥ ${$('analyticsDurationMin').value}s`);
    if ($('analyticsDurationMax').value !== '') dur.push(`≤ ${$('analyticsDurationMax').value}s`);
    const durTxt = dur.length ? ` · Duração: ${dur.join(' / ')}` : '';
    const cmp    = $('analyticsCompare').checked ? ' · Com comparação período anterior' : '';
    return {
      title:    'YouTube Analytics',
      subtitle: `Período: ${from} → ${to}${durTxt}${cmp}`,
      generated: 'Gerado em ' + new Date().toLocaleString('pt-BR')
    };
  }

  // Tabulator → PDF (uses jspdf-autotable). Used for Open tab AND for the
  // table view of the Private tab.
  function exportTabulatorToPDF(table, filename, title) {
    if (!table) { toast('Sem dados pra exportar.', 'error'); return; }
    table.download('pdf', filename, {
      orientation: 'landscape',
      title:        title,
      autoTable:    {
        styles:     { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [224, 32, 32], textColor: 255 },
        margin:     { top: 18, right: 8, bottom: 10, left: 8 },
      },
    });
    toast('PDF gerado!', 'success');
  }

  // Analytics tab dispatcher: chooses table-PDF or panel-PDF based on view.
  async function exportAnalyticsToPDF() {
    if (currentView === 'table') {
      const hdr = buildPdfHeader();
      exportTabulatorToPDF(analyticsTableInstance, `analytics-${dateTag()}.pdf`, `${hdr.title} — ${hdr.subtitle}`);
    } else {
      await exportPanelToPDF();
    }
  }

  // Panel view → captures the cards grid as image and embeds in a paginated PDF.
  async function exportPanelToPDF() {
    const target = $('analyticsPanel');
    if (!target || !target.children.length) { toast('Painel vazio. Gere um relatório primeiro.', 'error'); return; }
    if (typeof html2canvas !== 'function' || !window.jspdf) {
      toast('Bibliotecas de PDF ainda carregando, tente em 2 segundos.', 'error'); return;
    }

    toast('Capturando painel… isso leva alguns segundos.', 'info', 8000);

    // Render the canvas at 2× for sharper output
    const canvas = await html2canvas(target, {
      scale: 2,
      backgroundColor: '#ffffff',
      logging: false,
      windowWidth:  target.scrollWidth,
      windowHeight: target.scrollHeight,
    });

    const { jsPDF } = window.jspdf;
    const pdf       = new jsPDF('p', 'mm', 'a4');
    const pageW     = pdf.internal.pageSize.getWidth();
    const pageH     = pdf.internal.pageSize.getHeight();
    const margin    = 8;
    const headerSpace = 16;          // top reserved for title + subtitle

    const hdr = buildPdfHeader();

    // Compute final image dimensions (fit to page width)
    const imgW = pageW - margin * 2;
    const imgH = (canvas.height * imgW) / canvas.width;

    // Draw the same image across pages, shifting Y on each subsequent page
    let heightLeft = imgH;
    let position   = headerSpace;
    let firstPage  = true;

    const drawHeader = () => {
      pdf.setFontSize(13);
      pdf.setTextColor(20);
      pdf.text(hdr.title, margin, 8);
      pdf.setFontSize(9);
      pdf.setTextColor(80);
      pdf.text(hdr.subtitle, margin, 13);
    };

    const imgData = canvas.toDataURL('image/png');

    drawHeader();
    pdf.addImage(imgData, 'PNG', margin, position, imgW, imgH);
    heightLeft -= (pageH - position - margin);

    while (heightLeft > 0) {
      pdf.addPage();
      drawHeader();
      // Negative Y "scrolls" the image up so only the next slice shows
      position = headerSpace - (imgH - heightLeft);
      pdf.addImage(imgData, 'PNG', margin, position, imgW, imgH);
      heightLeft -= (pageH - headerSpace - margin);
    }

    // Footer with timestamp on the last page
    pdf.setFontSize(8);
    pdf.setTextColor(140);
    pdf.text(hdr.generated, margin, pageH - 4);

    pdf.save(`analytics-painel-${dateTag()}.pdf`);
    toast('PDF gerado!', 'success');
  }

  /* ─────────────────────────────────────────────────────────────
     INIT
  ───────────────────────────────────────────────────────────────*/
  function init() {
    initApiKey();
    initTabs();
    initSidebarToggle();
    initFieldToggles();
    initListActions();
    initAddChannel();
    initFetch();
    initExport();
    initGalleryToggle();
    initShowAllRows();
    initPrivateTab();
    renderLists();

    const lists = Storage.loadLists();
    if (lists.length) activateList(lists[0].id);
  }

  document.addEventListener('DOMContentLoaded', init);

})();
