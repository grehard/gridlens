// The right-hand inspector's tab switcher, and the status bar under the workspace.
(function () {
  'use strict';
  const { h, byId, plural, formatBytes } = GL.ui;
  const model = GL.model;
  const TABS = ['profile', 'filters', 'columns', 'views', 'data'];
  const NAMES = { profile: 'Profile', filters: 'Filters', columns: 'Columns', views: 'Views', data: 'Data' };
  let current = 'profile';

  function focusTab(name) { byId(`inspector-tab-${name}`).focus(); }

  function show(name, { reveal = true } = {}) {
    current = name;
    for (const tab of TABS) {
      const isOn = tab === name;
      const button = byId(`inspector-tab-${tab}`);
      button.setAttribute('aria-selected', isOn ? 'true' : 'false');
      button.tabIndex = isOn ? 0 : -1;
      byId(`panel-${tab}`).hidden = !isOn;
    }
    // On a phone the inspector sits under the workspace, so bring it into view.
    if (reveal && window.matchMedia('(max-width: 900px)').matches) byId('inspector').scrollIntoView({ block: 'start' });
  }

  function onTabKeydown(event) {
    const index = TABS.indexOf(current);
    let next = null;
    if (event.key === 'ArrowRight') next = TABS[(index + 1) % TABS.length];
    if (event.key === 'ArrowLeft') next = TABS[(index - 1 + TABS.length) % TABS.length];
    if (!next) return;
    event.preventDefault();
    show(next, { reveal: false });
    focusTab(next);
  }

  function badge(name, count) {
    const button = byId(`inspector-tab-${name}`);
    button.replaceChildren(document.createTextNode(NAMES[name]));
    if (count) button.append(h('span', { class: 'tab-badge', text: String(count) }));
  }

  function refreshBadges() {
    badge('filters', model.view.filters.length);
    badge('views', GL.viewsPanel ? GL.viewsPanel.countForDataset() : 0);
  }

  function init() {
    const bar = byId('inspector-tabs');
    for (const name of TABS) {
      bar.append(h('button', {
        id: `inspector-tab-${name}`, class: 'inspector-tab', type: 'button', role: 'tab', 'aria-controls': `panel-${name}`,
        'aria-selected': 'false', tabindex: '-1', text: NAMES[name], onclick: () => show(name),
      }));
    }
    bar.addEventListener('keydown', onTabKeydown);
    show('profile', { reveal: false });
    model.on('dataset', refreshBadges);
    model.on('rows', refreshBadges);
  }

  GL.inspector = { init, show, refreshBadges };

  const DELIMITER_NAMES = { ',': 'comma', ';': 'semicolon', '\t': 'tab' };

  function warningsText(warnings) {
    const parts = [];
    if (warnings.shortRows) parts.push(`${plural(warnings.shortRows, 'short row')} padded`);
    if (warnings.longRows) parts.push(`${plural(warnings.longRows, 'extra column')} added for long rows`);
    if (warnings.unterminated) parts.push('unterminated quote read to end of file');
    if (warnings.strayQuote) parts.push(`${plural(warnings.strayQuote, 'stray quote')} kept as text`);
    return parts.join(', ');
  }

  function parseSummary() {
    const { parsed, info, note } = model.dataset;
    const mode = info.mode === 'worker' ? 'Parsed in a background worker' : 'Parsed on the main thread';
    const parts = [`${mode} in ${info.ms.toLocaleString('en-US')} ms`, `${DELIMITER_NAMES[parsed.delimiter] || 'custom'} delimited`];
    const warnings = warningsText(parsed.warnings);
    if (warnings) parts.push(warnings);
    if (note) parts.push(note);
    return parts.join(' · ');
  }

  function refreshStatus() {
    if (!model.dataset) return;
    byId('status-parse').textContent = parseSummary();
    byId('status-cell').textContent = '';
    const { parsed, name, size } = model.dataset;
    byId('dataset-name').textContent = name;
    byId('dataset-name').title = name;
    byId('dataset-meta').textContent = `${plural(parsed.rowCount, 'row')} · ${plural(model.columns.length, 'column')} · ${formatBytes(size)}`;
  }

  function refreshRowCount() {
    if (!model.dataset) return;
    const total = model.dataset.parsed.rowCount;
    const shown = model.rowIndex.length;
    byId('row-count').textContent = shown === total ? plural(total, 'row') : `${shown.toLocaleString('en-US')} of ${plural(total, 'row')}`;
  }

  GL.statusBar = {
    init() {
      model.on('dataset', () => { refreshStatus(); refreshRowCount(); });
      model.on('columns', refreshStatus);
      model.on('rows', refreshRowCount);
    },
    showCell(columnName, rowNumber, text) {
      byId('status-cell').textContent = `Row ${rowNumber.toLocaleString('en-US')} · ${columnName}: ${text === '' ? '(empty)' : text}`;
    },
    setMessage(text) {
      byId('status-parse').textContent = text;
    },
  };
})();
