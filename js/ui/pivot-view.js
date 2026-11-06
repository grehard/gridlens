// Pivot builder: group by up to two columns, optionally split into columns, with any set of measures.
(function () {
  'use strict';
  const { h, byId, clear, select, field, icon, plural } = GL.ui;
  const model = GL.model;
  const P = GL.pivot;
  const MAX_DISPLAY_ROWS = 2000;
  const MAX_SPLIT_VALUES = 60;
  let sortState = null;
  let lastFlat = null;

  function columnOptions(columns) { return columns.map((c) => ({ value: c.name, label: c.name })); }

  function update(pivot) {
    sortState = null;
    model.setPivot(pivot);
    renderControls();
    renderResult();
  }

  function config() { return model.view.pivot; }

  /** The first short text column makes a sensible first grouping for a new dataset. */
  function defaultRow() {
    const text = model.columns.find((c) => c.type === 'text' && new Set(c.values).size <= 40);
    const column = text || model.columns.find((c) => c.type === 'boolean') || model.columns[0];
    return column ? { col: column.name, bucket: 'month' } : null;
  }

  function ensureDefaults() {
    const pivot = config();
    pivot.rows = pivot.rows.filter((d) => model.column(d.col));
    if (!pivot.rows.length) {
      const row = defaultRow();
      if (row) pivot.rows = [row];
    }
    if (pivot.split && !model.column(pivot.split.col)) pivot.split = null;
  }

  function bucketControl(dimension, label, onChange) {
    const column = model.column(dimension.col);
    if (!column || column.type !== 'date') return null;
    return field(label, select(P.BUCKETS.map((b) => ({ value: b, label: b[0].toUpperCase() + b.slice(1) })), dimension.bucket, {
      onchange: (event) => onChange(event.target.value), 'data-role': 'bucket',
    }));
  }

  function primaryRowControls() {
    const pivot = config();
    const first = pivot.rows[0] || { col: '', bucket: 'month' };
    const groupBy = select(columnOptions(model.columns), first.col, {
      id: 'pivot-row',
      onchange: (event) => update(Object.assign({}, pivot, { rows: [{ col: event.target.value, bucket: first.bucket }].concat(pivot.rows.slice(1)) })),
    });
    return [
      field('Group by', groupBy),
      bucketControl(first, 'Period', (bucket) => update(Object.assign({}, pivot, { rows: [{ col: first.col, bucket }].concat(pivot.rows.slice(1)) }))),
    ];
  }

  function secondRowControls() {
    const pivot = config();
    const second = pivot.rows[1] || null;
    const options = [{ value: '', label: 'None' }].concat(columnOptions(model.columns));
    const control = select(options, second ? second.col : '', {
      id: 'pivot-row-2',
      onchange: (event) => {
        const rows = [pivot.rows[0]];
        if (event.target.value) rows.push({ col: event.target.value, bucket: 'month' });
        update(Object.assign({}, pivot, { rows }));
      },
    });
    return [
      field('Then by', control),
      second ? bucketControl(second, 'Period', (bucket) => update(Object.assign({}, pivot, { rows: [pivot.rows[0], { col: second.col, bucket }] }))) : null,
    ];
  }

  function splitControls() {
    const pivot = config();
    const { split } = pivot;
    const options = [{ value: '', label: 'None' }].concat(columnOptions(model.columns));
    const control = select(options, split ? split.col : '', {
      id: 'pivot-split',
      onchange: (event) => update(Object.assign({}, pivot, { split: event.target.value ? { col: event.target.value, bucket: 'month' } : null })),
    });
    return [
      field('Split columns by', control),
      split ? bucketControl(split, 'Period', (bucket) => update(Object.assign({}, pivot, { split: { col: split.col, bucket } }))) : null,
    ];
  }

  function measureColumnOptions(agg) {
    const fits = model.columns.filter((c) => P.aggregateFits(agg, c.type));
    return agg === 'count' ? [{ value: '', label: 'All rows' }].concat(columnOptions(fits)) : columnOptions(fits);
  }

  function replaceMeasure(index, measure) {
    const pivot = config();
    const measures = pivot.measures.slice();
    measures[index] = measure;
    update(Object.assign({}, pivot, { measures }));
  }

  function changeAggregate(index, measure, agg) {
    const currentColumn = model.column(measure.col);
    const stillFits = currentColumn && P.aggregateFits(agg, currentColumn.type);
    const fallback = agg === 'count' ? null : (model.columns.find((c) => P.aggregateFits(agg, c.type)) || { name: null }).name;
    replaceMeasure(index, { agg, col: stillFits ? measure.col : fallback });
  }

  function measureRow(measure, index) {
    const pivot = config();
    const aggSelect = select(P.AGGREGATES.map((a) => ({ value: a, label: P.AGGREGATE_LABELS[a] })), measure.agg, {
      class: 'measure-agg', 'aria-label': `Aggregate for value ${index + 1}`,
      onchange: (event) => changeAggregate(index, measure, event.target.value),
    });
    const columnSelect = select(measureColumnOptions(measure.agg), measure.col || '', {
      class: 'measure-col', 'aria-label': `Column for value ${index + 1}`,
      onchange: (event) => replaceMeasure(index, { agg: measure.agg, col: event.target.value || null }),
    });
    const remove = h('button', {
      class: 'icon-btn', type: 'button', 'aria-label': `Remove value ${index + 1}`, disabled: pivot.measures.length === 1,
      onclick: () => update(Object.assign({}, pivot, { measures: pivot.measures.filter((_, i) => i !== index) })),
    }, icon('close', 14));
    return h('div', { class: 'measure' }, aggSelect, h('span', { class: 'of-word', text: 'of' }), columnSelect, remove);
  }

  function addMeasure() {
    const pivot = config();
    const numeric = model.columns.find((c) => c.type === 'number');
    const measure = numeric ? { agg: 'sum', col: numeric.name } : { agg: 'count', col: null };
    update(Object.assign({}, pivot, { measures: pivot.measures.concat([measure]) }));
  }

  function renderControls() {
    const bar = byId('pivot-controls');
    clear(bar);
    const pivot = config();
    const addButton = h('button', { class: 'btn btn-small', type: 'button', id: 'pivot-add-measure', disabled: pivot.measures.length >= 8, onclick: addMeasure }, icon('plus', 14), h('span', { text: 'Add value' }));
    bar.append(
      h('div', { class: 'pivot-dims' }, primaryRowControls(), secondRowControls(), splitControls()),
      h('div', { class: 'pivot-measures' },
        h('span', { class: 'measures-title', text: 'Values' }),
        pivot.measures.map(measureRow), addButton));
  }

  function compareCells(a, b, kind) {
    if (a === b) return 0;
    if (a === null || a === undefined) return 1;
    if (b === null || b === undefined) return -1;
    if (kind === 'value') return a - b;
    return String(a) < String(b) ? -1 : 1;
  }

  function sortedRows(flat) {
    if (!sortState) return flat.rows;
    const { index, dir } = sortState;
    const { kind } = flat.header[index];
    const sign = dir === 'desc' ? -1 : 1;
    return flat.rows.slice().sort((x, y) => {
      const c = compareCells(x[index], y[index], kind);
      if (x[index] === null || y[index] === null) return c;
      return c * sign;
    });
  }

  function toggleSort(index) {
    if (!sortState || sortState.index !== index) sortState = { index, dir: 'desc' };
    else if (sortState.dir === 'desc') sortState = { index, dir: 'asc' };
    else sortState = null;
    renderResult();
  }

  function headerCell(column, index) {
    const sorted = sortState && sortState.index === index ? sortState.dir : null;
    const arrow = sorted ? icon(sorted === 'asc' ? 'arrowUp' : 'arrowDown', 12) : null;
    return h('th', { scope: 'col', class: column.kind === 'value' ? 'num' : '', 'aria-sort': sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none' },
      h('button', { class: 'th-btn', type: 'button', onclick: () => toggleSort(index) }, h('span', { text: column.label }), arrow));
  }

  function bodyCell(value, column) {
    if (column.kind === 'key') return h('th', { scope: 'row', text: value });
    return h('td', { class: 'num', text: GL.types.displayValue(value, column.type) });
  }

  function renderTable(flat, holder) {
    const rows = sortedRows(flat);
    const shown = rows.slice(0, MAX_DISPLAY_ROWS);
    const table = h('table', { class: 'pivot-table', id: 'pivot-table' },
      h('thead', null, h('tr', null, flat.header.map(headerCell))),
      h('tbody', null, shown.map((row) => h('tr', null, row.map((value, i) => bodyCell(value, flat.header[i]))))),
      h('tfoot', null, h('tr', null, flat.totals.map((value, i) => bodyCell(value, flat.header[i])))));
    holder.append(table);
  }

  function summaryLine(flat) {
    const total = flat.rows.length;
    const shownNote = total > MAX_DISPLAY_ROWS ? ` Showing the first ${MAX_DISPLAY_ROWS.toLocaleString('en-US')}; the export has all of them.` : '';
    return `${plural(total, 'group')} from ${plural(model.rowIndex.length, 'row')}.${shownNote}`;
  }

  function renderResult() {
    const holder = byId('pivot-result');
    const summary = byId('pivot-summary');
    clear(holder);
    lastFlat = null;
    summary.textContent = '';
    if (!model.columns.length) return;
    const result = P.run(config(), model.columns, model.rowIndex);
    if (!result) {
      holder.append(h('p', { class: 'empty-note', text: 'Choose a column to group by and at least one value.' }));
      return;
    }
    if (result.splitKeys.length > MAX_SPLIT_VALUES) {
      holder.append(h('p', { class: 'empty-note', id: 'pivot-split-error', role: 'alert', text: `${result.splitName} has ${result.splitKeys.length.toLocaleString('en-US')} different values. Split by a column with at most ${MAX_SPLIT_VALUES}.` }));
      return;
    }
    if (!result.rows.length) {
      holder.append(h('p', { class: 'empty-note', text: 'No rows match the current filters and search.' }));
      return;
    }
    lastFlat = P.flatten(result);
    summary.textContent = summaryLine(lastFlat);
    renderTable(lastFlat, holder);
  }

  function exportCsv() {
    if (!lastFlat) {
      GL.ui.toast('There is no pivot result to export yet.', { kind: 'error' });
      return;
    }
    const csv = P.toCsv({ header: lastFlat.header, rows: sortedRows(lastFlat), totals: lastFlat.totals });
    GL.ui.download(`${GL.app.exportBase()}-pivot.csv`, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    GL.ui.toast(`Exported ${plural(lastFlat.rows.length, 'group')} as CSV.`);
  }

  function isVisible() { return model.view.tab === 'pivot' && !!model.dataset; }

  function refresh() {
    if (!isVisible()) return;
    ensureDefaults();
    renderControls();
    renderResult();
  }

  GL.pivotView = {
    init() {
      model.on('dataset', () => { sortState = null; refresh(); });
      model.on('columns', refresh);
      model.on('rows', () => { if (isVisible()) renderResult(); });
    },
    refresh, exportCsv,
  };
})();
