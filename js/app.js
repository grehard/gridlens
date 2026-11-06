// Startup and the top-level controls: opening datasets, tabs, search, export, theme, drag and drop.
(function () {
  'use strict';
  const { h, byId, debounce, plural, icon } = GL.ui;
  const model = GL.model;
  const WORKSPACE_TABS = ['table', 'pivot', 'chart'];
  const EXPORT_LABELS = { table: 'Export CSV', pivot: 'Export pivot', chart: 'Export PNG' };
  const sampleCache = new Map();
  let openToken = 0;

  function setBusy(text) {
    const node = byId('busy');
    node.hidden = !text;
    byId('busy-text').textContent = text || '';
  }

  function progressReporter(name, token) {
    return (share) => {
      if (token === openToken) setBusy(`Reading ${name}: ${Math.round(share * 100)}%`);
    };
  }

  function nextFrame() { return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))); }

  async function openSample(id, state, viewId) {
    const entry = GL.samples.CATALOG.find((c) => c.id === id);
    if (!entry) return false;
    const token = ++openToken;
    setBusy(`Generating ${entry.label.toLowerCase()}`);
    await nextFrame();
    try {
      let cached = sampleCache.get(id);
      if (!cached) {
        const text = GL.samples.sampleCsv(id);
        const { parsed, info } = await GL.loader.parse({ text, keepTextUpTo: 0 }, progressReporter(entry.name, token));
        cached = { parsed, info, size: text.length };
        sampleCache.set(id, cached);
      }
      if (token !== openToken) return false;
      model.open({ key: `sample:${id}`, name: entry.name, source: 'sample', size: cached.size, parsed: cached.parsed, info: cached.info },
        state || GL.seeds.defaultState(id), viewId || null);
    } finally {
      if (token === openToken) setBusy('');
    }
    return true;
  }

  function reportOpenError(name, error) {
    GL.statusBar.setMessage(`Could not open ${name}: ${error.message}`);
    GL.ui.toast(`Could not open ${name}: ${error.message}`, { kind: 'error', ms: 9000 });
  }

  function rememberNote(result) {
    if (result.kept) {
      return result.evicted && result.evicted.length ? `Removed ${result.evicted.join(', ')} from recent files to make room` : '';
    }
    return result.reason === 'too large'
      ? 'Too large to remember between visits; open for this session only'
      : 'Browser storage is full, so this file is open for this session only';
  }

  async function openFile(file) {
    const rejection = GL.loader.rejectionFor(file);
    if (rejection) { reportOpenError(file.name, new Error(rejection.replace(`${file.name} `, 'it '))); return; }
    const token = ++openToken;
    setBusy(`Reading ${file.name}`);
    try {
      const { parsed, info } = await GL.loader.parse({ file }, progressReporter(file.name, token));
      if (token !== openToken) return;
      const id = GL.loader.fileKey(file.name, file.size);
      const remembered = GL.store.rememberFile(
        { id, name: file.name, size: file.size, rows: parsed.rowCount, openedAt: Date.now() }, parsed.sourceText);
      model.open({ key: `file:${id}`, name: file.name, source: 'file', size: file.size, parsed, info, note: rememberNote(remembered) }, GL.viewState.blankState());
      if (!remembered.kept) GL.ui.toast(rememberNote(remembered), { kind: 'info', ms: 8000 });
      else GL.ui.toast(`Opened ${file.name}: ${plural(parsed.rowCount, 'row')}. It stayed in this browser.`);
    } catch (error) {
      reportOpenError(file.name, error);
    } finally {
      if (token === openToken) setBusy('');
    }
  }

  async function openRecent(id, state, viewId) {
    const text = GL.store.readFile(id);
    const entry = GL.store.loadRecent().find((item) => item.id === id);
    if (text === null || !entry) {
      GL.ui.toast('That file is no longer stored in this browser.', { kind: 'error' });
      if (model.dataset) GL.dataPanel.render();
      return false;
    }
    const token = ++openToken;
    setBusy(`Reading ${entry.name}`);
    try {
      const { parsed, info } = await GL.loader.parse({ text, keepTextUpTo: 0 }, progressReporter(entry.name, token));
      if (token !== openToken) return false;
      GL.store.touchRecent(id);
      model.open({ key: `file:${id}`, name: entry.name, source: 'file', size: entry.size, parsed, info }, state || GL.viewState.blankState(), viewId || null);
      return true;
    } catch (error) {
      reportOpenError(entry.name, error);
      return false;
    } finally {
      if (token === openToken) setBusy('');
    }
  }

  /** Opens whatever a key points at; used by session restore and by views for other datasets. */
  function openKey(key, view, stateOverride) {
    const state = view ? view.state : stateOverride;
    const viewId = view ? view.id : null;
    if (key.startsWith('sample:')) return openSample(key.slice(7), state, viewId);
    if (key.startsWith('file:')) return openRecent(key.slice(5), state, viewId);
    return Promise.resolve(false);
  }

  function resetDemo() {
    GL.store.clearData();
    seedViews();
    byId('search').value = '';
    openSample('sales').then(() => {
      GL.inspector.show('profile', { reveal: false });
      GL.ui.toast('Demo data restored.');
    });
  }

  function seedViews() {
    GL.viewsPanel.replaceAll(GL.seeds.views());
    GL.store.markSeeded();
  }

  function exportBase() {
    return model.dataset.name.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_') || 'gridlens';
  }

  function exportTable() {
    if (!model.rowIndex.length || !model.visibleColumns.length) {
      GL.ui.toast('There are no rows to export with the current filters.', { kind: 'error' });
      return;
    }
    const blob = new Blob([model.toCsv()], { type: 'text/csv;charset=utf-8' });
    GL.ui.download(`${exportBase()}-filtered.csv`, blob);
    GL.ui.toast(`Exported ${plural(model.rowIndex.length, 'row')} as CSV.`);
  }

  function onExport() {
    if (model.view.tab === 'pivot') GL.pivotView.exportCsv();
    else if (model.view.tab === 'chart') GL.chartView.exportPng();
    else exportTable();
  }

  function syncWorkspace() {
    const { tab } = model.view;
    for (const name of WORKSPACE_TABS) {
      const button = byId(`workspace-tab-${name}`);
      const isOn = name === tab;
      button.setAttribute('aria-selected', isOn ? 'true' : 'false');
      button.tabIndex = isOn ? 0 : -1;
      byId(`tab-${name}`).hidden = !isOn;
    }
    byId('export-label').textContent = EXPORT_LABELS[tab];
  }

  function selectWorkspace(tab) {
    if (model.view.tab !== tab) model.setTab(tab);
    syncWorkspace();
    if (tab === 'pivot') GL.pivotView.refresh();
    if (tab === 'chart') GL.chartView.refresh();
    if (tab === 'table') GL.table.refresh();
  }

  function buildWorkspaceTabs() {
    const bar = byId('workspace-tabs');
    const labels = { table: 'Table', pivot: 'Pivot', chart: 'Chart' };
    for (const name of WORKSPACE_TABS) {
      bar.append(h('button', {
        id: `workspace-tab-${name}`, class: 'workspace-tab', type: 'button', role: 'tab', 'aria-controls': `tab-${name}`,
        'aria-selected': 'false', onclick: () => selectWorkspace(name),
      }, icon(name, 15), h('span', { text: labels[name] })));
    }
    bar.addEventListener('keydown', (event) => {
      const index = WORKSPACE_TABS.indexOf(model.view.tab);
      let next = null;
      if (event.key === 'ArrowRight') next = WORKSPACE_TABS[(index + 1) % 3];
      if (event.key === 'ArrowLeft') next = WORKSPACE_TABS[(index + 2) % 3];
      if (!next) return;
      event.preventDefault();
      selectWorkspace(next);
      byId(`workspace-tab-${next}`).focus();
    });
  }

  function currentTheme() {
    const explicit = document.documentElement.getAttribute('data-theme');
    if (explicit) return explicit;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function syncThemeButton() {
    const button = byId('theme-toggle');
    const dark = currentTheme() === 'dark';
    button.replaceChildren(icon(dark ? 'sun' : 'moon'));
    button.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    button.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
  }

  function toggleTheme() {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    GL.store.saveTheme(next);
    syncThemeButton();
    GL.chartView.repaint();
  }

  function initTheme() {
    const saved = GL.store.loadTheme();
    if (saved) document.documentElement.setAttribute('data-theme', saved);
    syncThemeButton();
    byId('theme-toggle').addEventListener('click', toggleTheme);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      syncThemeButton();
      GL.chartView.repaint();
    });
  }

  function hasFiles(event) {
    return event.dataTransfer && Array.from(event.dataTransfer.types || []).includes('Files');
  }

  function initDragAndDrop() {
    const overlay = byId('drop-overlay');
    let depth = 0;
    window.addEventListener('dragenter', (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth++;
      overlay.hidden = false;
    });
    window.addEventListener('dragover', (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) overlay.hidden = true;
    });
    window.addEventListener('drop', (event) => {
      event.preventDefault();
      depth = 0;
      overlay.hidden = true;
      const files = event.dataTransfer ? event.dataTransfer.files : null;
      if (files && files.length) openFile(files[0]);
    });
  }

  function initToolbar() {
    const fileInput = byId('file-input');
    byId('open-file').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const [file] = fileInput.files;
      fileInput.value = '';
      if (file) openFile(file);
    });
    const search = byId('search');
    const applySearch = debounce(() => model.setSearch(search.value), 140);
    search.addEventListener('input', applySearch);
    byId('export-btn').addEventListener('click', onExport);
    byId('save-view-btn').addEventListener('click', () => GL.viewsPanel.focusSave());
  }

  function buildToolbarIcons() {
    byId('open-file').prepend(icon('upload', 15));
    byId('export-btn').prepend(icon('download', 15));
    byId('save-view-btn').prepend(icon('save', 15));
    byId('search-icon').append(icon('search', 15));
    byId('privacy').prepend(icon('lock', 14));
  }

  function syncOnDataset() {
    byId('search').value = model.view.search;
    syncWorkspace();
  }

  async function restoreOrOpenDefault() {
    if (!GL.store.isSeeded()) seedViews();
    const session = GL.store.loadSession();
    if (session) {
      const opened = await openKey(session.key, session.activeViewId ? { state: session.state, id: session.activeViewId } : null, session.state);
      if (opened) return;
      if (session.key.startsWith('file:')) GL.ui.toast('The last file was too large to remember, so the sales sample is open instead.');
    }
    await openSample('sales');
  }

  function init() {
    buildToolbarIcons();
    buildWorkspaceTabs();
    model.on('dataset', syncOnDataset);
    GL.inspector.init();
    GL.statusBar.init();
    GL.table.init();
    GL.profilePanel.init();
    GL.filtersPanel.init();
    GL.columnsPanel.init();
    GL.viewsPanel.init();
    GL.dataPanel.init();
    GL.pivotView.init();
    GL.chartView.init();
    initTheme();
    initToolbar();
    initDragAndDrop();
    restoreOrOpenDefault().catch((error) => {
      GL.statusBar.setMessage(`Could not start: ${error.message}`);
    });
    window.addEventListener('beforeunload', () => {
      if (model.dataset) GL.store.saveSession(model.dataset.key, model.view, model.activeViewId);
    });
  }

  GL.app = { openSample, openRecent, openKey, resetDemo, exportBase };

  init();
})();
