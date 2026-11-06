// The shape of a view: everything about how a dataset is being looked at, kept separate from the
// data so it can be saved, restored and shared. sanitize() is the only way state enters the app.
(function () {
  'use strict';
  const TABS = ['table', 'pivot', 'chart'];
  const CHART_TYPES = ['bar', 'line', 'scatter', 'histogram'];
  const MAX_TEXT = 500;

  function blankState() {
    return {
      types: {}, hidden: [], widths: {}, sort: null, filters: [], search: '', computed: [], tab: 'table', selected: null,
      pivot: { rows: [], split: null, measures: [{ agg: 'count', col: null }] },
      chart: { type: 'bar', x: null, y: null, agg: 'count', series: null, bucket: 'month', bins: 0 },
    };
  }

  function text(value, fallback = '') {
    return typeof value === 'string' ? value.slice(0, MAX_TEXT) : fallback;
  }

  function nameOrNull(value) {
    return typeof value === 'string' && value ? value.slice(0, MAX_TEXT) : null;
  }

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function sanitizeMap(source, accept) {
    const out = {};
    if (!isObject(source)) return out;
    for (const key of Object.keys(source)) if (accept(source[key])) out[key] = source[key];
    return out;
  }

  function sanitizeFilters(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(isObject).map((f) => ({ col: text(f.col), op: text(f.op), a: text(f.a), b: text(f.b) }));
  }

  function sanitizeComputed(list) {
    if (!Array.isArray(list)) return [];
    return list.filter((c) => isObject(c) && typeof c.name === 'string' && c.name && typeof c.expr === 'string')
      .map((c) => ({ name: c.name.slice(0, 60), expr: c.expr.slice(0, 2000) }));
  }

  function sanitizeDimension(value) {
    if (!isObject(value) || !nameOrNull(value.col)) return null;
    return { col: value.col, bucket: GL.pivot.BUCKETS.includes(value.bucket) ? value.bucket : 'month' };
  }

  function sanitizePivot(value) {
    const blank = blankState().pivot;
    if (!isObject(value)) return blank;
    const rows = Array.isArray(value.rows) ? value.rows.map(sanitizeDimension).filter(Boolean).slice(0, 3) : [];
    const measures = Array.isArray(value.measures)
      ? value.measures.filter((m) => isObject(m) && GL.pivot.AGGREGATES.includes(m.agg)).map((m) => ({ agg: m.agg, col: nameOrNull(m.col) })).slice(0, 8)
      : [];
    return { rows, split: sanitizeDimension(value.split), measures: measures.length ? measures : blank.measures };
  }

  function sanitizeChart(value) {
    const blank = blankState().chart;
    if (!isObject(value)) return blank;
    const bins = Number(value.bins);
    return {
      type: CHART_TYPES.includes(value.type) ? value.type : 'bar',
      x: nameOrNull(value.x), y: nameOrNull(value.y), series: nameOrNull(value.series),
      agg: GL.pivot.AGGREGATES.includes(value.agg) ? value.agg : 'count',
      bucket: GL.pivot.BUCKETS.includes(value.bucket) ? value.bucket : 'month',
      bins: Number.isInteger(bins) && bins >= 0 && bins <= 100 ? bins : 0,
    };
  }

  function sanitizeSort(value) {
    if (!isObject(value) || !nameOrNull(value.col)) return null;
    return { col: value.col, dir: value.dir === 'desc' ? 'desc' : 'asc' };
  }

  /** Accepts anything, returns a well-formed state. Corrupt or hand-edited data cannot crash the app. */
  function sanitize(input) {
    const source = isObject(input) ? input : {};
    return {
      types: sanitizeMap(source.types, (t) => GL.types.TYPES.includes(t)),
      hidden: Array.isArray(source.hidden) ? source.hidden.filter((n) => typeof n === 'string') : [],
      widths: sanitizeMap(source.widths, (w) => Number.isFinite(w) && w >= 40 && w <= 2000),
      sort: sanitizeSort(source.sort),
      filters: sanitizeFilters(source.filters),
      search: text(source.search),
      computed: sanitizeComputed(source.computed),
      tab: TABS.includes(source.tab) ? source.tab : 'table',
      selected: nameOrNull(source.selected),
      pivot: sanitizePivot(source.pivot),
      chart: sanitizeChart(source.chart),
    };
  }

  function clone(state) { return JSON.parse(JSON.stringify(state)); }

  /** Short description for a view's list row, such as "2 filters, pivot". */
  function summarize(state) {
    const parts = [];
    if (state.filters.length) parts.push(state.filters.length === 1 ? '1 filter' : `${state.filters.length} filters`);
    if (state.search) parts.push('search');
    if (state.sort) parts.push(`sorted by ${state.sort.col}`);
    if (state.computed.length) parts.push(state.computed.length === 1 ? '1 computed column' : `${state.computed.length} computed columns`);
    if (state.tab !== 'table') parts.push(state.tab === 'pivot' ? 'pivot' : `${state.chart.type} chart`);
    return parts.join(', ') || 'All rows';
  }

  /** Follows a rename through every part of a view that refers to a column by name. */
  function renameColumn(state, from, to) {
    const swap = (name) => (name === from ? to : name);
    state.hidden = state.hidden.map(swap);
    if (Object.prototype.hasOwnProperty.call(state.widths, from)) {
      state.widths[to] = state.widths[from];
      delete state.widths[from];
    }
    if (state.sort) state.sort.col = swap(state.sort.col);
    state.filters.forEach((f) => { f.col = swap(f.col); });
    state.selected = swap(state.selected);
    state.pivot.rows.forEach((d) => { d.col = swap(d.col); });
    if (state.pivot.split) state.pivot.split.col = swap(state.pivot.split.col);
    state.pivot.measures.forEach((m) => { m.col = swap(m.col); });
    state.chart.x = swap(state.chart.x);
    state.chart.y = swap(state.chart.y);
    state.chart.series = swap(state.chart.series);
  }

  GL.viewState = { blankState, sanitize, clone, summarize, renameColumn };
})();
