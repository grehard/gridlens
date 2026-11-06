// Everything kept between visits. Every storage call can throw (private mode, blocked site data,
// full quota), so failures are reported as return values and the app simply carries on in memory.
(function () {
  'use strict';
  const PREFIX = 'gridlens.';
  const KEYS = { views: `${PREFIX}views`, recent: `${PREFIX}recent`, session: `${PREFIX}session`, theme: `${PREFIX}theme`, seeded: `${PREFIX}seeded` };
  const FILE_PREFIX = `${PREFIX}file.`;
  const MAX_RECENT = 8;
  /** localStorage holds about 5 million characters, so only small files are worth remembering. */
  const MAX_REMEMBERED_CHARS = 1500000;

  function read(key) {
    try { return window.localStorage.getItem(key); } catch (error) { return null; }
  }

  function write(key, value) {
    try { window.localStorage.setItem(key, value); return true; } catch (error) { return false; }
  }

  function remove(key) {
    try { window.localStorage.removeItem(key); } catch (error) { /* nothing to clean up if storage is blocked */ }
  }

  function readJson(key, fallback) {
    const raw = read(key);
    if (raw === null) return fallback;
    try { return JSON.parse(raw); } catch (error) { return fallback; }
  }

  function isValidView(view) {
    return !!view && typeof view === 'object' && typeof view.id === 'string' && typeof view.name === 'string' &&
      view.name.trim() !== '' && typeof view.datasetKey === 'string';
  }

  function normalizeView(view) {
    return {
      id: view.id,
      name: view.name.trim().slice(0, 80),
      datasetKey: view.datasetKey,
      datasetName: typeof view.datasetName === 'string' ? view.datasetName : view.datasetKey,
      state: GL.viewState.sanitize(view.state),
    };
  }

  function loadViews() {
    const stored = readJson(KEYS.views, []);
    return Array.isArray(stored) ? stored.filter(isValidView).map(normalizeView) : [];
  }

  function saveViews(views) { return write(KEYS.views, JSON.stringify(views)); }

  function isValidRecent(entry) {
    return !!entry && typeof entry === 'object' && typeof entry.id === 'string' && typeof entry.name === 'string' &&
      Number.isFinite(entry.size) && Number.isFinite(entry.rows) && Number.isFinite(entry.openedAt);
  }

  function loadRecent() {
    const stored = readJson(KEYS.recent, []);
    if (!Array.isArray(stored)) return [];
    return stored.filter(isValidRecent).filter((entry) => read(FILE_PREFIX + entry.id) !== null);
  }

  function saveRecentIndex(list) { return write(KEYS.recent, JSON.stringify(list)); }

  /**
   * Remembers a file, evicting the oldest ones if the quota is full.
   * Returns { kept: true } or { kept: false, reason } so the UI can say what happened.
   */
  function rememberFile(entry, text) {
    if (text === null || text === undefined || text.length > MAX_REMEMBERED_CHARS) {
      return { kept: false, reason: 'too large' };
    }
    const list = loadRecent().filter((item) => item.id !== entry.id);
    remove(FILE_PREFIX + entry.id);
    const evicted = [];
    while (!write(FILE_PREFIX + entry.id, text)) {
      const oldest = list.pop();
      if (!oldest) return { kept: false, reason: 'storage full', evicted };
      remove(FILE_PREFIX + oldest.id);
      evicted.push(oldest.name);
    }
    list.unshift(entry);
    while (list.length > MAX_RECENT) {
      const dropped = list.pop();
      remove(FILE_PREFIX + dropped.id);
      evicted.push(dropped.name);
    }
    if (!saveRecentIndex(list)) {
      remove(FILE_PREFIX + entry.id);
      return { kept: false, reason: 'storage full', evicted };
    }
    return { kept: true, evicted };
  }

  function touchRecent(id) {
    const list = loadRecent();
    const entry = list.find((item) => item.id === id);
    if (!entry) return;
    entry.openedAt = Date.now();
    saveRecentIndex([entry].concat(list.filter((item) => item !== entry)));
  }

  function readFile(id) { return read(FILE_PREFIX + id); }

  function forgetFile(id) {
    const text = readFile(id);
    const list = loadRecent();
    const entry = list.find((item) => item.id === id) || null;
    remove(FILE_PREFIX + id);
    saveRecentIndex(list.filter((item) => item.id !== id));
    return { entry, text };
  }

  function restoreFile(entry, text) {
    if (!write(FILE_PREFIX + entry.id, text)) return false;
    return saveRecentIndex([entry].concat(loadRecent().filter((item) => item.id !== entry.id)));
  }

  function loadSession() {
    const session = readJson(KEYS.session, null);
    if (!session || typeof session !== 'object' || typeof session.key !== 'string') return null;
    return { key: session.key, state: GL.viewState.sanitize(session.state), activeViewId: typeof session.activeViewId === 'string' ? session.activeViewId : null };
  }

  function saveSession(key, state, activeViewId) {
    return write(KEYS.session, JSON.stringify({ key, state, activeViewId }));
  }

  function loadTheme() {
    const theme = read(KEYS.theme);
    return theme === 'light' || theme === 'dark' ? theme : null;
  }

  function saveTheme(theme) { write(KEYS.theme, theme); }

  /** Characters this app is using, for the meter in the Data panel. */
  function usedChars() {
    let total = 0;
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key.startsWith(PREFIX)) total += (read(key) || '').length;
      }
    } catch (error) { return 0; }
    return total;
  }

  function isSeeded() { return read(KEYS.seeded) === '1'; }
  function markSeeded() { write(KEYS.seeded, '1'); }

  /** Removes all app data except the theme, which is a preference rather than data. */
  function clearData() {
    const keys = [];
    try {
      for (let i = 0; i < window.localStorage.length; i++) keys.push(window.localStorage.key(i));
    } catch (error) { return; }
    for (const key of keys) if (key.startsWith(PREFIX) && key !== KEYS.theme) remove(key);
  }

  GL.store = {
    MAX_REMEMBERED_CHARS, loadViews, saveViews, normalizeView, isValidView, loadRecent, rememberFile, touchRecent, readFile, forgetFile,
    restoreFile, loadSession, saveSession, loadTheme, saveTheme, usedChars, isSeeded, markSeeded, clearData,
  };
})();
