// Turns chart settings plus the rows in view into plain series data. Knows nothing about pixels.
(function (root) {
  'use strict';
  const GL = (root.GL = root.GL || {});
  const { pivot, stats } = GL;
  const MAX_BAR_CATEGORIES = 40;
  const MAX_LINE_CATEGORIES = 1200;
  const MAX_SCATTER_POINTS = 20000;
  /** Past three colors, scatter clouds stop being distinguishable, so the rest fold into Other. */
  const SERIES_LIMIT = { bar: 8, line: 8, scatter: 3 };
  const SERIES_COLUMN = '\u0000series';
  const OTHER = 'Other';

  function seriesLabel(value, type) {
    return value === null ? pivot.EMPTY : GL.types.formatValue(value, type);
  }

  /**
   * Picks series from all rows, not just filtered ones, and orders them alphabetically.
   * That keeps each series on the same color when a filter changes what is visible.
   */
  function prepareSeries(column, limit) {
    const counts = new Map();
    for (const value of column.values) {
      const label = seriesLabel(value, column.type);
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    const ranked = Array.from(counts.keys()).sort((a, b) => counts.get(b) - counts.get(a) || (a < b ? -1 : 1));
    const names = ranked.slice(0, limit).sort();
    const kept = new Set(names);
    const hasOther = ranked.length > limit;
    const values = column.values.map((value) => {
      const label = seriesLabel(value, column.type);
      return kept.has(label) ? label : OTHER;
    });
    return { name: SERIES_COLUMN, type: 'text', values, names: hasOther ? names.concat([OTHER]) : names };
  }

  function measureFor(config, columnsByName) {
    if (config.agg === 'count') return { agg: 'count', col: null };
    const column = columnsByName.get(config.y);
    if (!column || !pivot.aggregateFits(config.agg, column.type)) return null;
    return { agg: config.agg, col: config.y };
  }

  function measureTitle(measure) {
    if (measure.agg === 'count') return 'Rows';
    return `${pivot.AGGREGATE_LABELS[measure.agg]} of ${measure.col}`;
  }

  function positionFor(key, index, column, bucket) {
    if (key === null) return null;
    if (column.type === 'number') return key;
    if (column.type === 'date') return parseBucketLabel(key, bucket);
    return index;
  }

  function parseBucketLabel(label, bucket) {
    if (bucket === 'year') return Date.UTC(Number(label), 0, 1);
    if (bucket === 'quarter') return Date.UTC(Number(label.slice(0, 4)), (Number(label.slice(-1)) - 1) * 3, 1);
    if (bucket === 'month') return Date.UTC(Number(label.slice(0, 4)), Number(label.slice(5, 7)) - 1, 1);
    return Date.UTC(Number(label.slice(0, 4)), Number(label.slice(5, 7)) - 1, Number(label.slice(8, 10)));
  }

  /** Text categories on a bar chart read best largest first; everything else keeps its natural order. */
  function orderCategories(flat, chartType, xColumn, valueOffset) {
    const rows = flat.rows.slice();
    const natural = xColumn.type === 'date' || xColumn.type === 'number' || chartType === 'line';
    if (!natural) rows.sort((a, b) => (b[valueOffset] || 0) - (a[valueOffset] || 0));
    return rows;
  }

  function categorical(config, columns, rowIndex) {
    const byName = new Map(columns.map((c) => [c.name, c]));
    const xColumn = byName.get(config.x);
    if (!xColumn) return { error: 'Choose a column for the horizontal axis.' };
    const measure = measureFor(config, byName);
    if (!measure) return { error: 'Choose a column for the vertical axis.' };
    if (!rowIndex.length) return { error: 'No rows to chart. Adjust the filters.' };

    const seriesSource = config.series && config.series !== config.x ? byName.get(config.series) : null;
    const series = seriesSource ? prepareSeries(seriesSource, SERIES_LIMIT[config.type]) : null;
    const scope = series ? columns.concat([series]) : columns;
    const result = pivot.run({
      rows: [{ col: config.x, bucket: config.bucket }],
      split: series ? { col: SERIES_COLUMN, bucket: 'month' } : null,
      measures: [measure],
    }, scope, rowIndex);
    const flat = pivot.flatten(result);
    const splitCount = result.splitKeys.length;
    const totalOffset = 1 + splitCount;
    const ordered = orderCategories(flat, config.type, xColumn, totalOffset);
    const limit = config.type === 'bar' ? MAX_BAR_CATEGORIES : MAX_LINE_CATEGORIES;
    const shown = ordered.slice(0, limit);
    const rawKeys = new Map(result.rows.map((group) => [pivot.keyLabel(group.keys[0], xColumn.type), group.keys[0]]));

    const presentNames = series ? series.names.filter((name) => result.splitKeys.includes(name)) : [];
    const seriesList = series
      ? presentNames.map((name) => {
        const column = 1 + result.splitKeys.indexOf(name);
        return { name, slot: series.names.indexOf(name), isOther: name === OTHER, values: shown.map((row) => row[column]) };
      })
      : [{ name: result.measures[0].label, slot: 0, single: true, values: shown.map((row) => row[totalOffset]) }];

    const positions = shown.map((row, index) => positionFor(rawKeys.has(row[0]) ? rawKeys.get(row[0]) : null, index, xColumn, config.bucket));
    const usable = config.type !== 'line' ? shown.map(() => true) : positions.map((p) => p !== null);
    const notes = [];
    if (ordered.length > limit) notes.push(`Showing ${limit.toLocaleString('en-US')} of ${ordered.length.toLocaleString('en-US')} categories.`);
    return {
      kind: config.type,
      title: `${measureTitle(measure)} by ${config.x}`,
      xLabel: xColumn.type === 'date' ? `${config.x} (${config.bucket})` : config.x,
      yLabel: measureTitle(measure),
      xType: xColumn.type,
      yType: result.measures[0].type,
      numericX: xColumn.type === 'date' || xColumn.type === 'number',
      categories: shown.map((row, i) => ({ label: row[0], position: positions[i], usable: usable[i] })),
      series: seriesList,
      note: notes.join(' '),
    };
  }

  function scatter(config, columns, rowIndex) {
    const byName = new Map(columns.map((c) => [c.name, c]));
    const xColumn = byName.get(config.x), yColumn = byName.get(config.y);
    const isScale = (c) => !!c && (c.type === 'number' || c.type === 'date');
    if (!isScale(xColumn)) return { error: 'A scatter chart needs a number or date column across.' };
    if (!isScale(yColumn)) return { error: 'A scatter chart needs a number or date column up.' };
    if (!rowIndex.length) return { error: 'No rows to chart. Adjust the filters.' };
    const seriesSource = config.series ? byName.get(config.series) : null;
    const series = seriesSource ? prepareSeries(seriesSource, SERIES_LIMIT.scatter) : null;
    const stride = Math.max(1, Math.ceil(rowIndex.length / MAX_SCATTER_POINTS));
    const points = [];
    let skippedBlank = 0;
    for (let i = 0; i < rowIndex.length; i += stride) {
      const row = rowIndex[i];
      const x = xColumn.values[row], y = yColumn.values[row];
      if (x === null || y === null) { skippedBlank++; continue; }
      points.push({ x, y, row, series: series ? series.names.indexOf(series.values[row]) : 0 });
    }
    if (!points.length) return { error: 'None of these rows have values in both columns.' };
    const notes = [];
    if (stride > 1) notes.push(`Showing every ${stride}th row of ${rowIndex.length.toLocaleString('en-US')}.`);
    if (skippedBlank) notes.push(`${skippedBlank.toLocaleString('en-US')} rows with empty values left out.`);
    return {
      kind: 'scatter',
      title: `${config.y} against ${config.x}`,
      xLabel: config.x, yLabel: config.y, xType: xColumn.type, yType: yColumn.type,
      points,
      series: series ? series.names.map((name, slot) => ({ name, slot, isOther: name === OTHER })) : [{ name: config.y, slot: 0, single: true }],
      note: notes.join(' '),
    };
  }

  function histogramChart(config, columns, rowIndex) {
    const column = columns.find((c) => c.name === config.x);
    if (!column || (column.type !== 'number' && column.type !== 'date')) return { error: 'A histogram needs a number or date column.' };
    const present = stats.collect(column.values, rowIndex);
    if (!present.length) return { error: 'No values to chart. Adjust the filters.' };
    const sorted = Float64Array.from(present).sort();
    const bins = stats.histogram(sorted, config.bins || null, { exactEdges: column.type === 'date' });
    const blanks = rowIndex.length - present.length;
    return {
      kind: 'histogram',
      title: `Distribution of ${config.x}`,
      xLabel: config.x, yLabel: 'Rows', xType: column.type, yType: 'number',
      bins,
      series: [{ name: config.x, slot: 0, single: true }],
      note: blanks ? `${blanks.toLocaleString('en-US')} rows with empty values left out.` : '',
    };
  }

  function build(config, columns, rowIndex) {
    if (config.type === 'scatter') return scatter(config, columns, rowIndex);
    if (config.type === 'histogram') return histogramChart(config, columns, rowIndex);
    return categorical(config, columns, rowIndex);
  }

  /** The same figures as the chart in rows, for the table view. */
  function toTable(chart) {
    const fmt = (value, type) => GL.types.displayValue(value, type) || '';
    if (chart.kind === 'histogram') {
      return {
        header: ['From', 'To', 'Rows'],
        rows: chart.bins.map((bin) => [fmt(bin.from, chart.xType), fmt(bin.to, chart.xType), fmt(bin.count, 'number')]),
      };
    }
    if (chart.kind === 'scatter') {
      const header = [chart.xLabel, chart.yLabel];
      const named = !chart.series[0].single;
      if (named) header.push('Series');
      return {
        header,
        rows: chart.points.slice(0, 500).map((p) => {
          const cells = [fmt(p.x, chart.xType), fmt(p.y, chart.yType)];
          if (named) cells.push(chart.series[p.series].name);
          return cells;
        }),
        truncated: chart.points.length > 500,
      };
    }
    return {
      header: [chart.xLabel].concat(chart.series.map((s) => s.name)),
      rows: chart.categories.map((category, i) => [category.label].concat(chart.series.map((s) => fmt(s.values[i], chart.yType)))),
    };
  }

  GL.chartData = { build, toTable };
})(typeof self !== 'undefined' ? self : this);
