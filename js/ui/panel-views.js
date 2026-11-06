// Saved views: named snapshots of filters, sort, columns, pivot and chart settings.
(function () {
  'use strict';
  const { h, byId, clear, icon, download, plural } = GL.ui;
  const model = GL.model;
  const { summarize, clone } = GL.viewState;
  let views = [];
  let query = '';
  let importError = '';
  let idCounter = 0;

  function newId() { return `v${Date.now().toString(36)}${(++idCounter).toString(36)}`; }

  function persist() {
    if (!GL.store.saveViews(views)) GL.ui.toast('Could not save views to this browser. They will last until you close the tab.', { kind: 'error' });
    GL.inspector.refreshBadges();
  }

  function forDataset() { return views.filter((v) => v.datasetKey === model.dataset.key); }
  function forOthers() { return views.filter((v) => v.datasetKey !== model.dataset.key); }

  function matches(view) {
    return !query || view.name.toLowerCase().includes(query.toLowerCase());
  }

  function saveCurrent(name) {
    const view = {
      id: newId(), name, datasetKey: model.dataset.key, datasetName: model.dataset.name,
      state: clone(model.view),
    };
    views.unshift(view);
    model.activeViewId = view.id;
    persist();
    render();
    GL.ui.toast(`Saved view "${name}".`);
  }

  function updateFromCurrent(view) {
    view.state = clone(model.view);
    model.activeViewId = view.id;
    persist();
    render();
    GL.ui.toast(`Updated "${view.name}" with the current settings.`);
  }

  function removeView(view) {
    const index = views.indexOf(view);
    views.splice(index, 1);
    if (model.activeViewId === view.id) model.activeViewId = null;
    persist();
    render();
    GL.ui.toast(`Deleted view "${view.name}".`, {
      onUndo: () => {
        views.splice(index, 0, view);
        persist();
        render();
      },
    });
  }

  /** Reports columns the view needs but this dataset lacks; those conditions show as missing in the Filters panel. */
  function apply(view) {
    if (view.datasetKey !== model.dataset.key) {
      GL.app.openKey(view.datasetKey, view).then((opened) => {
        if (!opened) GL.ui.toast(`Open ${view.datasetName} first: it is not stored in this browser.`, { kind: 'error' });
      });
      return;
    }
    model.applyState(view.state, view.id);
    render();
  }

  function startRename(row, view) {
    const input = h('input', { type: 'text', class: 'rename-input', value: view.name, maxlength: '80', 'aria-label': `New name for ${view.name}` });
    const finish = (commit) => {
      const name = input.value.trim();
      if (commit && name) { view.name = name; persist(); }
      render();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') finish(true);
      if (event.key === 'Escape') { event.stopPropagation(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    row.querySelector('.view-open').replaceWith(input);
    input.focus();
    input.select();
  }

  function viewRow(view) {
    const isActive = view.id === model.activeViewId;
    const row = h('li', { class: `view-row${isActive ? ' is-active' : ''}`, 'data-name': view.name },
      h('button', { class: 'view-open', type: 'button', 'aria-current': isActive ? 'true' : null, onclick: () => apply(view) },
        h('span', { class: 'view-name', text: view.name }),
        h('span', { class: 'view-summary', text: view.datasetKey === model.dataset.key ? summarize(view.state) : view.datasetName })),
      h('span', { class: 'view-actions' },
        view.datasetKey === model.dataset.key
          ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Update ${view.name} with current settings`, title: 'Update with current settings', onclick: () => updateFromCurrent(view) }, icon('refresh', 14))
          : null,
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Rename ${view.name}`, title: 'Rename', onclick: () => startRename(row, view) }, icon('edit', 14)),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Delete ${view.name}`, title: 'Delete', onclick: () => removeView(view) }, icon('trash', 14))));
    return row;
  }

  function saveForm() {
    const input = h('input', { type: 'text', id: 'view-name', placeholder: 'Name this view', 'aria-label': 'Name for the new view', maxlength: '80', autocomplete: 'off' });
    const message = h('p', { class: 'error-note', id: 'view-name-error', role: 'alert', hidden: true });
    const form = h('form', {
      class: 'inline-form', novalidate: true,
      onsubmit: (event) => {
        event.preventDefault();
        const name = input.value.trim();
        if (!name) {
          message.textContent = 'Enter a name for this view.';
          message.hidden = false;
          input.focus();
          return;
        }
        saveCurrent(name);
      },
    }, input, h('button', { class: 'btn btn-small btn-primary', type: 'submit', id: 'view-save', text: 'Save' }));
    return h('div', null, form, message);
  }

  function listSection(title, list, emptyText) {
    const visible = list.filter(matches);
    if (!list.length && !emptyText) return null;
    return h('div', null,
      h('h3', { class: 'section-title', text: title }),
      visible.length
        ? h('ul', { class: 'view-list' }, visible.map(viewRow))
        : h('p', { class: 'muted', text: list.length ? 'No views match that search.' : emptyText }));
  }

  function exportViews() {
    const payload = { app: 'gridlens', kind: 'saved-views', version: 1, views };
    download('gridlens-views.json', new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    GL.ui.toast(`Exported ${plural(views.length, 'view')}.`);
  }

  function parseImport(text) {
    let data;
    try { data = JSON.parse(text); } catch (error) { throw new Error('That file is not valid JSON.'); }
    if (!data || data.app !== 'gridlens' || !Array.isArray(data.views)) throw new Error('That file is not a Gridlens views export.');
    const valid = data.views.filter(GL.store.isValidView);
    if (!valid.length) throw new Error('That file contains no usable views.');
    return { imported: valid.map(GL.store.normalizeView), skipped: data.views.length - valid.length };
  }

  function uniqueName(name, datasetKey) {
    const taken = new Set(views.filter((v) => v.datasetKey === datasetKey).map((v) => v.name));
    if (!taken.has(name)) return name;
    let n = 2;
    while (taken.has(`${name} (${n})`)) n++;
    return `${name} (${n})`;
  }

  async function importViews(file) {
    importError = '';
    try {
      const { imported, skipped } = parseImport(await file.text());
      for (const view of imported) {
        view.id = newId();
        view.name = uniqueName(view.name, view.datasetKey);
        views.push(view);
      }
      persist();
      const suffix = skipped ? `, skipped ${skipped} invalid` : '';
      GL.ui.toast(`Imported ${plural(imported.length, 'view')}${suffix}.`);
    } catch (error) {
      importError = error.message;
    }
    render();
  }

  function transferRow() {
    const fileInput = h('input', {
      type: 'file', id: 'views-import', class: 'sr-only', accept: '.json,application/json', tabindex: '-1', 'aria-label': 'Import views file',
      onchange: (event) => {
        const [file] = event.target.files;
        event.target.value = '';
        if (file) importViews(file);
      },
    });
    return h('div', { class: 'panel-actions' },
      h('button', { class: 'btn btn-small', type: 'button', id: 'views-export', disabled: !views.length, onclick: exportViews }, icon('download', 14), h('span', { text: 'Export' })),
      h('button', { class: 'btn btn-small', type: 'button', id: 'views-import-btn', onclick: () => fileInput.click() }, icon('upload', 14), h('span', { text: 'Import' })),
      fileInput);
  }

  function render() {
    const panel = byId('panel-views');
    clear(panel);
    const parts = [saveForm()];
    if (views.length > 3) {
      parts.push(h('input', {
        type: 'search', class: 'panel-search', placeholder: 'Find a view', 'aria-label': 'Find a view', value: query, id: 'views-search',
        oninput: (event) => {
          query = event.target.value;
          render();
          const again = byId('views-search');
          again.focus();
          again.selectionStart = again.selectionEnd = again.value.length;
        },
      }));
    }
    parts.push(listSection('This dataset', forDataset(), 'No saved views for this dataset yet.'));
    parts.push(listSection('Other datasets', forOthers(), ''));
    parts.push(transferRow());
    if (importError) parts.push(h('p', { class: 'error-note', id: 'views-import-error', role: 'alert', text: importError }));
    panel.append(...parts.filter(Boolean));
  }

  /** The toolbar's Save view button lands here. */
  function focusSave() {
    GL.inspector.show('views');
    byId('view-name').focus();
  }

  GL.viewsPanel = {
    init() {
      views = GL.store.loadViews();
      model.on('dataset', render);
    },
    render, focusSave,
    countForDataset() { return model.dataset ? forDataset().length : 0; },
    /** Replaces everything, used by reset. */
    replaceAll(next) {
      views = next;
      persist();
    },
  };
})();
