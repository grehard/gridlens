// The open dataset, its columns and the current view. UI panels change state only through these
// methods and listen for four events: dataset (all new), columns, rows, and view (settings only).
(function () {
  'use strict';
  const listeners = new Map();
  const CHAR_WIDTH = 7.4, MIN_AUTO = 72, MAX_AUTO = 300, CELL_PADDING = 22, HEADER_EXTRA = 58;

  const model = {
    dataset: null,
    columns: [],
    visibleColumns: [],
    rowIndex: new Uint32Array(0),
    view: GL.viewState.blankState(),
    activeViewId: null,
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },
    column(name) { return this.columns.find((c) => c.name === name) || null; },
  };

  function emit(event) { for (const fn of listeners.get(event) || []) fn(); }

  const saveSoon = GL.ui.debounce(() => {
    if (model.dataset) GL.store.saveSession(model.dataset.key, model.view, model.activeViewId);
  }, 200);

  function own(map, key) { return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined; }

  /** Estimates a width from the header and the first rows; measuring real text would touch the DOM per column. */
  function autoWidth(name, raw, count) {
    let longest = name.length * 1.05 * CHAR_WIDTH + HEADER_EXTRA;
    const limit = Math.min(count, 60);
    for (let i = 0; i < limit; i++) longest = Math.max(longest, raw[i].length * CHAR_WIDTH + CELL_PADDING);
    return Math.round(Math.max(MIN_AUTO, Math.min(MAX_AUTO, longest)));
  }

  function coerceCached(dataset, name, raw, type, dateOrder) {
    const cacheKey = `${type}|${name}`;
    let entry = dataset.cache.get(cacheKey);
    if (!entry) {
      entry = GL.types.coerce(raw, type, dateOrder);
      dataset.cache.set(cacheKey, entry);
    }
    return entry;
  }

  function buildBaseColumns() {
    const { parsed } = model.dataset;
    return parsed.header.map((name, i) => {
      const raw = parsed.columns[i];
      const inference = parsed.inference[i];
      const type = own(model.view.types, name) || inference.type;
      const { values, invalid } = coerceCached(model.dataset, name, raw, type, inference.dateOrder);
      return {
        name, raw, values, invalid, type, inferred: inference.type, computed: false, expr: null, error: null,
        width: autoWidth(name, raw, parsed.rowCount),
      };
    });
  }

  function evaluateComputed(definition, columns, rowCount) {
    const out = {
      name: definition.name, expr: definition.expr, computed: true, invalid: 0, error: null,
      type: 'text', inferred: 'text', values: new Array(rowCount).fill(null), raw: new Array(rowCount).fill(''),
    };
    try {
      const { type, run } = GL.expr.compile(definition.expr, columns);
      out.type = type;
      out.inferred = type;
      for (let row = 0; row < rowCount; row++) {
        const value = run(row);
        out.values[row] = value;
        out.raw[row] = GL.types.formatValue(value, type);
      }
    } catch (error) {
      if (!(error instanceof GL.expr.ExprError)) throw error;
      out.error = error.message;
    }
    out.width = autoWidth(out.name, out.raw, rowCount);
    return out;
  }

  /** Later computed columns can use earlier ones, so they are built in order. */
  function buildColumns() {
    const columns = buildBaseColumns();
    const rowCount = model.dataset.parsed.rowCount;
    for (const definition of model.view.computed) columns.push(evaluateComputed(definition, columns, rowCount));
    const hidden = new Set(model.view.hidden);
    for (const column of columns) {
      column.hidden = hidden.has(column.name);
      column.width = own(model.view.widths, column.name) || column.width;
    }
    model.columns = columns;
    model.visibleColumns = columns.filter((c) => !c.hidden);
    if (!model.column(model.view.selected)) {
      const preferred = model.visibleColumns.find((c) => c.type === 'number') || columns[0];
      model.view.selected = preferred ? preferred.name : null;
    }
  }

  function sortKeyReader(column) {
    if (column.type !== 'text') return column.values;
    const keys = new Array(column.values.length);
    for (let i = 0; i < keys.length; i++) keys[i] = column.values[i] === null ? null : column.values[i].toLowerCase();
    return keys;
  }

  /** Blanks stay at the bottom whichever way the column is sorted; the row number breaks ties. */
  function sortRows(rowIndex) {
    const { sort } = model.view;
    const column = sort ? model.column(sort.col) : null;
    if (!column) return rowIndex;
    const keys = sortKeyReader(column);
    const sign = sort.dir === 'desc' ? -1 : 1;
    return rowIndex.sort((a, b) => {
      const x = keys[a], y = keys[b];
      if (x === y) return a - b;
      if (x === null) return 1;
      if (y === null) return -1;
      return x < y ? -sign : sign;
    });
  }

  function computeRows() {
    const { dataset, view, columns } = model;
    const kept = GL.filter.apply(view.filters, view.search, columns, dataset.parsed.rowCount);
    model.rowIndex = sortRows(kept);
  }

  function columnsChanged() {
    buildColumns();
    computeRows();
    emit('columns');
    emit('rows');
    saveSoon();
  }

  function rowsChanged() {
    computeRows();
    emit('rows');
    saveSoon();
  }

  function viewChanged() {
    emit('view');
    saveSoon();
  }

  /** A condition written for the old type may have no meaning under the new one. */
  function resetFiltersForType(name, type) {
    for (const condition of model.view.filters) {
      if (condition.col === name && !GL.filter.operator(type, condition.op)) {
        Object.assign(condition, { op: GL.filter.defaultOperator(type), a: '', b: '' });
      }
    }
  }

  /** Dataset: { key, name, source, size, parsed, info, note }. */
  model.open = (dataset, state, activeViewId = null) => {
    dataset.cache = new Map();
    model.dataset = dataset;
    model.view = GL.viewState.sanitize(state);
    model.activeViewId = activeViewId;
    buildColumns();
    computeRows();
    emit('dataset');
    saveSoon();
  };

  model.applyState = (state, activeViewId) => {
    model.view = GL.viewState.sanitize(GL.viewState.clone(state));
    model.activeViewId = activeViewId;
    buildColumns();
    computeRows();
    emit('dataset');
    saveSoon();
  };

  model.clearActiveView = () => { model.activeViewId = null; };

  model.setType = (name, type) => {
    const column = model.column(name);
    if (!column || column.computed) return;
    if (type === column.inferred) delete model.view.types[name];
    else model.view.types[name] = type;
    resetFiltersForType(name, type);
    columnsChanged();
  };

  model.setHidden = (names, hidden) => {
    const set = new Set(model.view.hidden);
    for (const name of names) { if (hidden) set.add(name); else set.delete(name); }
    model.view.hidden = Array.from(set);
    columnsChanged();
  };

  model.setWidth = (name, width) => {
    const column = model.column(name);
    if (!column) return;
    column.width = Math.round(Math.max(48, Math.min(900, width)));
    model.view.widths[name] = column.width;
    saveSoon();
  };

  model.setSort = (col, dir) => {
    model.view.sort = col && dir ? { col, dir } : null;
    rowsChanged();
  };

  model.setFilters = (filters) => {
    model.view.filters = filters;
    rowsChanged();
  };

  model.setSearch = (search) => {
    model.view.search = search;
    rowsChanged();
  };

  model.setComputed = (computed) => {
    model.view.computed = computed;
    columnsChanged();
  };

  model.renameComputed = (index, definition) => {
    const previous = model.view.computed[index];
    if (previous.name !== definition.name) GL.viewState.renameColumn(model.view, previous.name, definition.name);
    model.view.computed[index] = definition;
    columnsChanged();
  };

  model.setTab = (tab) => {
    model.view.tab = tab;
    viewChanged();
  };

  model.select = (name) => {
    model.view.selected = name;
    viewChanged();
  };

  model.setPivot = (pivot) => {
    model.view.pivot = pivot;
    viewChanged();
  };

  model.setChart = (chart) => {
    model.view.chart = chart;
    viewChanged();
  };

  /** Rows in view as CSV, using only visible columns and the original text of each cell. */
  model.toCsv = () => {
    const columns = model.visibleColumns;
    const rows = new Array(model.rowIndex.length);
    for (let i = 0; i < rows.length; i++) {
      const row = model.rowIndex[i];
      rows[i] = columns.map((c) => c.raw[row]);
    }
    return GL.csv.stringify(columns.map((c) => c.name), rows);
  };

  GL.model = model;
})();
