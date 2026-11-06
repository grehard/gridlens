// Column profile: counts, range, central values and a distribution for the selected column.
(function () {
  'use strict';
  const { h, byId, clear, select, field, plural, icon } = GL.ui;
  const model = GL.model;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const CHART_WIDTH = 280, CHART_HEIGHT = 84, BAR_GAP = 1;
  const TYPE_OPTIONS = [
    { value: 'number', label: 'Number' }, { value: 'date', label: 'Date' },
    { value: 'boolean', label: 'True or false' }, { value: 'text', label: 'Text' },
  ];

  function statRow(label, value, id) {
    return h('div', { class: 'stat', 'data-stat': id },
      h('dt', { text: label }), h('dd', { text: value === null || value === undefined || value === '' ? '-' : value }));
  }

  function displayStat(value, type) { return GL.types.displayValue(value, type); }

  function percent(part, whole) {
    if (!whole) return '0%';
    const share = (part / whole) * 100;
    return `${share < 10 ? share.toFixed(1) : Math.round(share)}%`;
  }

  function svgNode(tag, attrs, title) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const key of Object.keys(attrs)) node.setAttribute(key, attrs[key]);
    if (title) {
      const titleNode = document.createElementNS(SVG_NS, 'title');
      titleNode.textContent = title;
      node.append(titleNode);
    }
    return node;
  }

  function binLabel(bin, type) {
    return `${displayStat(bin.from, type)} to ${displayStat(bin.to, type)}: ${bin.count.toLocaleString('en-US')}`;
  }

  /** Each bar has a full-height invisible target so short bars can still be hovered. */
  function histogramSvg(bins, type) {
    const svg = svgNode('svg', { viewBox: `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`, class: 'mini-hist', role: 'img', 'aria-label': `Distribution in ${bins.length} bins` });
    const peak = Math.max(...bins.map((b) => b.count), 1);
    const slot = CHART_WIDTH / bins.length;
    svg.append(svgNode('line', { x1: 0, x2: CHART_WIDTH, y1: CHART_HEIGHT - 0.5, y2: CHART_HEIGHT - 0.5, class: 'mini-axis' }));
    bins.forEach((bin, i) => {
      const height = bin.count ? Math.max(1.5, (bin.count / peak) * (CHART_HEIGHT - 4)) : 0;
      const group = svgNode('g', { class: 'mini-bin' }, binLabel(bin, type));
      group.append(svgNode('rect', { x: i * slot, y: 0, width: slot, height: CHART_HEIGHT, fill: 'transparent' }));
      group.append(svgNode('rect', { class: 'mini-bar', x: i * slot + BAR_GAP / 2, y: CHART_HEIGHT - height - 1, width: Math.max(1, slot - BAR_GAP), height }));
      svg.append(group);
    });
    return svg;
  }

  function distribution(stats, type) {
    if (!stats.bins.length) return h('p', { class: 'muted', text: 'No values to chart.' });
    const first = stats.bins[0], last = stats.bins[stats.bins.length - 1];
    return h('div', { class: 'profile-chart' },
      histogramSvg(stats.bins, type),
      h('div', { class: 'mini-range' }, h('span', { text: displayStat(first.from, type) }), h('span', { text: displayStat(last.to, type) })));
  }

  /** Clicking a value filters to it, which is the usual next question after seeing the list. */
  function topValueRow(entry, column, peak, total) {
    const widthPct = peak ? (entry.count / peak) * 100 : 0;
    const bar = h('span', { class: 'top-bar' });
    bar.style.width = `${widthPct}%`;
    return h('li', null, h('button', {
      class: 'top-row', type: 'button', title: `Filter ${column.name} to ${entry.label}`,
      onclick: () => GL.filtersPanel.addValueFilter(column, entry.label),
    },
    h('span', { class: 'top-label', text: entry.label }),
    h('span', { class: 'top-count', text: `${entry.count.toLocaleString('en-US')} · ${percent(entry.count, total)}` }),
    h('span', { class: 'top-track' }, bar)));
  }

  function topValues(stats, column) {
    if (!stats.top.length) return h('p', { class: 'muted', text: 'No values to list.' });
    const peak = stats.top[0].count;
    const present = stats.total - stats.nulls;
    return h('ol', { class: 'top-list' }, stats.top.map((entry) => topValueRow(entry, column, peak, present)));
  }

  function statsFor(stats, column) {
    const { type } = column;
    const rows = [
      statRow('Rows', stats.total.toLocaleString('en-US'), 'rows'),
      statRow('Empty', `${stats.nulls.toLocaleString('en-US')} (${percent(stats.nulls, stats.total)})`, 'nulls'),
      statRow('Unique', stats.unique.toLocaleString('en-US'), 'unique'),
    ];
    if (type !== 'boolean') {
      rows.push(statRow('Min', displayStat(stats.min, type), 'min'), statRow('Max', displayStat(stats.max, type), 'max'));
    }
    if (type === 'number' || type === 'date') {
      rows.push(statRow('Mean', displayStat(stats.mean, type), 'mean'), statRow('Median', displayStat(stats.median, type), 'median'));
    }
    if (type === 'number') rows.push(statRow('Sum', displayStat(stats.sum, type), 'sum'));
    return h('dl', { class: 'stats' }, rows);
  }

  function columnPicker(column) {
    const options = model.columns.map((c) => ({ value: c.name, label: c.name }));
    return field('Column', select(options, column.name, {
      id: 'profile-column',
      onchange: (event) => model.select(event.target.value),
    }));
  }

  function typeControl(column) {
    if (column.computed) {
      return h('p', { class: 'profile-note' }, icon('function', 13), h('span', { text: ` Computed: ${column.expr}` }));
    }
    const control = select(TYPE_OPTIONS, column.type, {
      id: 'profile-type',
      onchange: (event) => model.setType(column.name, event.target.value),
    });
    const overridden = column.type !== column.inferred;
    return h('div', null,
      field('Type', control),
      h('p', { class: 'profile-note', id: 'profile-type-note', text: overridden ? `Detected as ${column.inferred}, changed by you.` : 'Detected from every value in this column.' }));
  }

  function invalidNote(column) {
    if (!column.invalid) return null;
    return h('p', { class: 'warning-note', role: 'status', text: `${plural(column.invalid, 'value')} did not fit this type and count as empty.` });
  }

  function errorNote(column) {
    return column.error ? h('p', { class: 'error-note', role: 'alert', text: column.error }) : null;
  }

  function actions(column) {
    return h('div', { class: 'button-row' },
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => GL.filtersPanel.addFor(column.name), text: 'Filter this column' }),
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => model.setHidden([column.name], !column.hidden), text: column.hidden ? 'Show column' : 'Hide column' }));
  }

  function render() {
    const panel = byId('panel-profile');
    GL.ui.keepFocus(panel, () => fill(panel));
  }

  function fill(panel) {
    clear(panel);
    const column = model.column(model.view.selected);
    if (!column) {
      panel.append(h('p', { class: 'muted', text: 'This dataset has no columns.' }));
      return;
    }
    const stats = GL.stats.profile(column, model.rowIndex);
    const isFiltered = model.rowIndex.length !== model.dataset.parsed.rowCount;
    panel.append(
      h('div', { class: 'profile-pickers' }, columnPicker(column), typeControl(column)),
      invalidNote(column) || '',
      errorNote(column) || '',
      h('h3', { class: 'section-title', text: isFiltered ? 'Summary of filtered rows' : 'Summary' }),
      statsFor(stats, column),
      h('h3', { class: 'section-title', text: stats.bins ? 'Distribution' : 'Top values' }),
      stats.bins ? distribution(stats, column.type) : topValues(stats, column),
      actions(column));
  }

  const renderSoon = GL.ui.debounce(render, 16);

  GL.profilePanel = {
    init() {
      model.on('dataset', render);
      model.on('columns', renderSoon);
      model.on('rows', renderSoon);
      model.on('view', renderSoon);
    },
  };
})();
