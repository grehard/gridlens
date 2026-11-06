// Where datasets come from: bundled samples, remembered files, and the reset control.
(function () {
  'use strict';
  const { h, byId, clear, icon, formatBytes, plural } = GL.ui;
  const model = GL.model;
  const STORAGE_NOTE_LIMIT = 5000000;

  function sampleRow(sample) {
    const key = `sample:${sample.id}`;
    const isOpen = model.dataset.key === key;
    return h('li', { class: `data-row${isOpen ? ' is-active' : ''}` },
      h('button', { class: 'data-open', type: 'button', 'data-sample': sample.id, 'aria-current': isOpen ? 'true' : null, onclick: () => GL.app.openSample(sample.id) },
        h('span', { class: 'data-name', text: sample.label }),
        h('span', { class: 'data-detail', text: sample.detail })));
  }

  function recentRow(entry) {
    const isOpen = model.dataset.key === `file:${entry.id}`;
    return h('li', { class: `data-row${isOpen ? ' is-active' : ''}`, 'data-file': entry.name },
      h('button', { class: 'data-open', type: 'button', 'aria-current': isOpen ? 'true' : null, onclick: () => GL.app.openRecent(entry.id) },
        h('span', { class: 'data-name', text: entry.name }),
        h('span', { class: 'data-detail', text: `${plural(entry.rows, 'row')} · ${formatBytes(entry.size)}` })),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Forget ${entry.name}`, title: 'Forget this file', onclick: () => forget(entry) }, icon('trash', 14)));
  }

  function forget(entry) {
    const removed = GL.store.forgetFile(entry.id);
    render();
    GL.ui.toast(`Removed ${entry.name} from this browser.`, {
      onUndo: () => {
        if (removed.entry && removed.text !== null) GL.store.restoreFile(removed.entry, removed.text);
        render();
      },
    });
  }

  function storageLine() {
    const used = GL.store.usedChars();
    const share = Math.min(100, Math.round((used / STORAGE_NOTE_LIMIT) * 100));
    return h('p', { class: 'muted', id: 'storage-meter', text: `Using ${formatBytes(used)} of about 5 MB of browser storage (${share}%). Files over ${formatBytes(GL.store.MAX_REMEMBERED_CHARS)} are not remembered.` });
  }

  function confirmReset() {
    GL.ui.confirmAction({
      title: 'Reset demo data?',
      message: 'This deletes your saved views and remembered files from this browser, restores the sample views, and reopens the sales sample.',
      confirmLabel: 'Reset demo data',
      onConfirm: GL.app.resetDemo,
    });
  }

  function render() {
    const panel = byId('panel-data');
    clear(panel);
    const recents = GL.store.loadRecent();
    panel.append(
      h('div', { class: 'privacy-card' }, icon('lock', 14),
        h('p', { text: 'Files are read by this page and stay on this device. Gridlens has no server and sends nothing over the network.' })),
      h('h3', { class: 'section-title', text: 'Sample datasets' }),
      h('ul', { class: 'data-list', id: 'sample-list' }, GL.samples.CATALOG.map(sampleRow)),
      h('h3', { class: 'section-title', text: 'Recent files' }),
      recents.length
        ? h('ul', { class: 'data-list', id: 'recent-list' }, recents.map(recentRow))
        : h('p', { class: 'muted', id: 'recent-empty', text: 'Files you open are remembered here if they fit in browser storage.' }),
      storageLine(),
      h('div', { class: 'panel-actions' },
        h('button', { class: 'btn btn-small', type: 'button', id: 'reset-demo', onclick: confirmReset }, icon('refresh', 14), h('span', { text: 'Reset demo data' }))));
  }

  GL.dataPanel = {
    init() { model.on('dataset', render); },
    render,
  };
})();
