// Group-by with optional column split. Totals come from the raw values rather than from
// the group results, so a total average is the true average and not an average of averages.
(function (root) {
  'use strict';
  const GL = (root.GL = root.GL || {});
  const EMPTY = '(empty)';
  const AGGREGATES = ['sum', 'avg', 'count', 'min', 'max'];
  const AGGREGATE_LABELS = { sum: 'Sum', avg: 'Average', count: 'Count', min: 'Min', max: 'Max' };
  const BUCKETS = ['day', 'month', 'quarter', 'year'];

  function pad(n) { return n < 10 ? `0${n}` : String(n); }

  function bucketDate(ms, bucket) {
    const d = new Date(ms);
    const y = d.getUTCFullYear(), m = d.getUTCMonth();
    if (bucket === 'year') return String(y);
    if (bucket === 'quarter') return `${y} Q${Math.floor(m / 3) + 1}`;
    if (bucket === 'month') return `${y}-${pad(m + 1)}`;
    return `${y}-${pad(m + 1)}-${pad(d.getUTCDate())}`;
  }

  /** Returns a function that maps a row number to its group key. */
  function keyReader(column, bucket) {
    const { values, type } = column;
    if (type === 'date') return (row) => (values[row] === null ? null : bucketDate(values[row], bucket || 'month'));
    if (type === 'boolean') return (row) => (values[row] === null ? null : values[row] ? 'true' : 'false');
    return (row) => values[row];
  }

  /** Empty groups always sort last. Numbers compare numerically, everything else as text. */
  function compareKeys(a, b) {
    if (a === b) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a) < String(b) ? -1 : 1;
  }

  function newAccumulator() { return { rows: 0, count: 0, sum: 0, min: null, max: null }; }

  function addToAccumulator(acc, value) {
    acc.rows++;
    if (value === null || value === undefined) return;
    acc.count++;
    if (typeof value === 'number') acc.sum += value;
    if (acc.min === null || value < acc.min) acc.min = value;
    if (acc.max === null || value > acc.max) acc.max = value;
  }

  function readAccumulator(acc, measure) {
    if (!acc) return null;
    switch (measure.agg) {
      case 'count': return measure.col ? acc.count : acc.rows;
      case 'sum': return acc.count ? GL.types.cleanNumber(acc.sum) : null;
      case 'avg': return acc.count ? GL.types.cleanNumber(acc.sum / acc.count) : null;
      case 'min': return acc.min;
      case 'max': return acc.max;
      default: return null;
    }
  }

  function measureType(measure, columnsByName) {
    if (measure.agg === 'count' || measure.agg === 'sum' || measure.agg === 'avg') return 'number';
    return columnsByName.get(measure.col).type;
  }

  function measureLabel(measure) {
    if (measure.agg === 'count') return measure.col ? `Count of ${measure.col}` : 'Count of rows';
    return `${AGGREGATE_LABELS[measure.agg]} of ${measure.col}`;
  }

  /** Whether an aggregate makes sense for a column type: sums of text would be meaningless figures. */
  function aggregateFits(agg, type) {
    if (agg === 'count') return true;
    if (agg === 'sum' || agg === 'avg') return type === 'number';
    return type === 'number' || type === 'date';
  }

  function usableMeasures(measures, columnsByName) {
    return measures.filter((m) => {
      if (!AGGREGATES.includes(m.agg)) return false;
      if (m.agg === 'count' && !m.col) return true;
      const column = columnsByName.get(m.col);
      return !!column && aggregateFits(m.agg, column.type);
    });
  }

  function accumulateAll(accs, valueColumns, row) {
    for (let m = 0; m < accs.length; m++) {
      addToAccumulator(accs[m], valueColumns[m] ? valueColumns[m][row] : 1);
    }
  }

  function accumulatorsFor(holder, key, measureCount) {
    let accs = holder.get(key);
    if (!accs) {
      accs = Array.from({ length: measureCount }, newAccumulator);
      holder.set(key, accs);
    }
    return accs;
  }

  function sortGroups(groups) {
    return Array.from(groups.values()).sort((a, b) => {
      for (let k = 0; k < a.keys.length; k++) {
        const c = compareKeys(a.keys[k], b.keys[k]);
        if (c) return c;
      }
      return 0;
    });
  }

  /**
   * config: { rows: [{col, bucket}], split: {col, bucket} | null, measures: [{agg, col}] }
   * Returns one accumulator per measure per group and split key, plus row and grand totals.
   */
  function run(config, columns, rowIndex) {
    const byName = new Map(columns.map((c) => [c.name, c]));
    const dimensions = (config.rows || []).filter((d) => byName.has(d.col));
    const measures = usableMeasures(config.measures || [], byName);
    if (!dimensions.length || !measures.length) return null;
    const readers = dimensions.map((d) => keyReader(byName.get(d.col), d.bucket));
    const splitColumn = config.split ? byName.get(config.split.col) : null;
    const readSplit = splitColumn ? keyReader(splitColumn, config.split.bucket) : null;
    const valueColumns = measures.map((m) => (m.col ? byName.get(m.col).values : null));

    const groups = new Map();
    const grand = measures.map(newAccumulator);
    const splitTotals = new Map();

    for (let i = 0; i < rowIndex.length; i++) {
      const row = rowIndex[i];
      const keys = readers.map((read) => read(row));
      const id = keys.length === 1 ? keys[0] : JSON.stringify(keys);
      let group = groups.get(id);
      if (!group) {
        group = { keys, totals: measures.map(newAccumulator), bySplit: new Map() };
        groups.set(id, group);
      }
      accumulateAll(group.totals, valueColumns, row);
      accumulateAll(grand, valueColumns, row);
      if (readSplit) {
        const splitKey = readSplit(row);
        accumulateAll(accumulatorsFor(group.bySplit, splitKey, measures.length), valueColumns, row);
        accumulateAll(accumulatorsFor(splitTotals, splitKey, measures.length), valueColumns, row);
      }
    }

    return {
      dimensions: dimensions.map((d) => ({ name: d.col, type: byName.get(d.col).type })),
      measures: measures.map((m) => ({ agg: m.agg, col: m.col || null, label: measureLabel(m), type: measureType(m, byName) })),
      splitName: splitColumn ? splitColumn.name : null,
      splitType: splitColumn ? splitColumn.type : null,
      splitKeys: Array.from(splitTotals.keys()).sort(compareKeys),
      splitTotals,
      rows: sortGroups(groups),
      grand,
    };
  }

  function keyLabel(key, type) {
    if (key === null || key === undefined) return EMPTY;
    return typeof key === 'string' ? key : GL.types.formatValue(key, type);
  }

  /**
   * Flattens a result into a header and rows of typed cells. Used by both the table
   * and the CSV export, so what is exported always matches what is shown.
   */
  function flatten(result) {
    const header = result.dimensions.map((d) => ({ label: d.name, kind: 'key', type: 'text' }));
    const multi = result.measures.length > 1;
    for (const key of result.splitKeys) {
      const splitLabel = keyLabel(key, result.splitType);
      result.measures.forEach((m) => {
        header.push({ label: multi ? `${splitLabel} · ${m.label}` : splitLabel, kind: 'value', type: m.type });
      });
    }
    result.measures.forEach((m) => {
      header.push({ label: result.splitKeys.length ? `Total · ${m.label}` : m.label, kind: 'value', type: m.type });
    });
    const measureCells = (accs) => result.measures.map((m, i) => readAccumulator(accs && accs[i], m));
    const rows = result.rows.map((group) => {
      const cells = group.keys.map((key, i) => keyLabel(key, result.dimensions[i].type));
      for (const key of result.splitKeys) cells.push(...measureCells(group.bySplit.get(key)));
      cells.push(...measureCells(group.totals));
      return cells;
    });
    const totals = result.dimensions.map((_, i) => (i === 0 ? 'Total' : ''));
    for (const key of result.splitKeys) totals.push(...measureCells(result.splitTotals.get(key)));
    totals.push(...measureCells(result.grand));
    return { header, rows, totals };
  }

  function formatCell(value, type) {
    if (value === null || value === undefined) return '';
    return typeof value === 'string' ? value : GL.types.formatValue(value, type);
  }

  /** Header, rows and total row as CSV. Numbers stay unformatted so they remain numbers elsewhere. */
  function toCsv(flat) {
    const header = flat.header.map((h) => h.label);
    const toRow = (cells) => cells.map((v, i) => formatCell(v, flat.header[i].type));
    return GL.csv.stringify(header, flat.rows.map(toRow).concat([toRow(flat.totals)]));
  }

  GL.pivot = {
    AGGREGATES, AGGREGATE_LABELS, BUCKETS, EMPTY, run, flatten, toCsv, bucketDate, compareKeys, keyLabel, keyReader,
    aggregateFits, formatCell,
  };
})(typeof self !== 'undefined' ? self : this);
