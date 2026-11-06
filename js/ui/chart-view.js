// Chart builder: the settings bar, the canvas with tooltip and keyboard access, and PNG export.
(function () {
  'use strict';
  const { h, byId, clear, select, field, icon, download } = GL.ui;
  const model = GL.model;
  const AGG_LABELS = GL.pivot.AGGREGATE_LABELS;
  const TYPES = [['bar', 'Bar'], ['line', 'Line'], ['scatter', 'Scatter'], ['histogram', 'Histogram']];
  const EXPORT_SCALE = 2;
  let chart = null, built = null, activeIndex = -1, showTable = false;

  function isScale(column) { return column.type === 'number' || column.type === 'date'; }

  function options(columns) { return columns.map((c) => ({ value: c.name, label: c.name })); }

  function usableX(type) {
    return type === 'scatter' || type === 'histogram' ? model.columns.filter(isScale) : model.columns;
  }

  function firstOf(columns, predicate) {
    const found = columns.find(predicate);
    return found ? found.name : null;
  }

  /** Fills in missing settings with sensible columns, keeping any choice that is still valid. */
  function withDefaults(config) {
    const next = Object.assign({}, config);
    const xs = usableX(next.type);
    if (!xs.some((c) => c.name === next.x)) {
      next.x = next.type === 'line'
        ? firstOf(xs, (c) => c.type === 'date') || firstOf(xs, isScale)
        : next.type === 'bar' ? firstOf(xs, (c) => c.type === 'text') || firstOf(xs, () => true) : firstOf(xs, () => true);
    }
    if (next.type === 'bar' || next.type === 'line') {
      if (next.agg !== 'count') {
        const y = model.column(next.y);
        if (!y || !GL.pivot.aggregateFits(next.agg, y.type)) next.y = firstOf(model.columns, (c) => GL.pivot.aggregateFits(next.agg, c.type));
      }
    } else if (next.type === 'scatter') {
      const y = model.column(next.y);
      if (!y || !isScale(y)) next.y = firstOf(model.columns, (c) => isScale(c) && c.name !== next.x) || next.x;
    }
    if (next.series && !model.column(next.series)) next.series = null;
    return next;
  }

  function update(patch) {
    model.setChart(withDefaults(Object.assign({}, model.view.chart, patch)));
    renderControls();
    renderChart();
  }

  function typeButtons(config) {
    return h('div', { class: 'seg', role: 'group', 'aria-label': 'Chart type' }, TYPES.map(([id, label]) => h('button', {
      class: 'seg-btn', type: 'button', 'aria-pressed': config.type === id ? 'true' : 'false', 'data-chart-type': id,
      onclick: () => update({ type: id }),
    }, icon(id, 14), h('span', { text: label }))));
  }

  function bucketSelect(config) {
    return field('Group by', select(GL.pivot.BUCKETS.map((b) => ({ value: b, label: b[0].toUpperCase() + b.slice(1) })), config.bucket, {
      id: 'chart-bucket', onchange: (event) => update({ bucket: event.target.value }),
    }));
  }

  function aggregateControls(config) {
    const measureOptions = GL.pivot.AGGREGATES.map((a) => ({ value: a, label: AGG_LABELS[a] }));
    const parts = [field('Measure', select(measureOptions, config.agg, { id: 'chart-agg', onchange: (event) => update({ agg: event.target.value }) }))];
    if (config.agg !== 'count') {
      const fits = model.columns.filter((c) => GL.pivot.aggregateFits(config.agg, c.type));
      parts.push(field('Of column', select(options(fits), config.y, { id: 'chart-y', onchange: (event) => update({ y: event.target.value }) })));
    }
    return parts;
  }

  function seriesSelect(config) {
    const candidates = model.columns.filter((c) => c.type === 'text' || c.type === 'boolean');
    return field('Color by', select([{ value: '', label: 'None' }].concat(options(candidates)), config.series || '', {
      id: 'chart-series', onchange: (event) => update({ series: event.target.value || null }),
    }));
  }

  function binsInput(config) {
    const message = h('p', { class: 'error-note', id: 'chart-bins-error', role: 'alert', hidden: true });
    const input = h('input', {
      type: 'number', id: 'chart-bins', min: '0', max: '100', step: '1', value: config.bins || '', placeholder: 'Auto',
      onchange: (event) => {
        const raw = event.target.value.trim();
        const value = raw === '' ? 0 : Number(raw);
        const valid = Number.isInteger(value) && value >= 0 && value <= 100;
        message.textContent = valid ? '' : 'Enter a whole number from 1 to 100, or leave empty for automatic.';
        message.hidden = valid;
        if (valid) update({ bins: value });
      },
    });
    return h('div', null, field('Bins', input), message);
  }

  function renderControls() {
    const bar = byId('chart-controls');
    clear(bar);
    const config = model.view.chart;
    const xColumn = model.column(config.x);
    const xLabel = config.type === 'histogram' ? 'Column' : 'Across';
    bar.append(typeButtons(config));
    bar.append(field(xLabel, select(options(usableX(config.type)), config.x || '', { id: 'chart-x', onchange: (event) => update({ x: event.target.value }) })));
    if (config.type === 'bar' || config.type === 'line') {
      if (xColumn && xColumn.type === 'date') bar.append(bucketSelect(config));
      bar.append(...aggregateControls(config));
      bar.append(seriesSelect(config));
    }
    if (config.type === 'scatter') {
      const ys = model.columns.filter(isScale);
      bar.append(field('Up', select(options(ys), config.y || '', { id: 'chart-y', onchange: (event) => update({ y: event.target.value }) })));
      bar.append(seriesSelect(config));
    }
    if (config.type === 'histogram') bar.append(binsInput(config));
    bar.append(h('button', {
      class: 'btn btn-small', type: 'button', id: 'chart-table-toggle', 'aria-pressed': showTable ? 'true' : 'false',
      onclick: () => { showTable = !showTable; renderControls(); renderChart(); },
    }, icon('table', 14), h('span', { text: 'Table view' })));
  }

  function canvasSize() {
    const holder = byId('chart-canvas-holder');
    return { width: Math.max(280, holder.clientWidth), height: Math.max(220, holder.clientHeight) };
  }

  function hideTooltip() {
    byId('chart-tooltip').hidden = true;
  }

  function tooltipContent(mark) {
    const rows = mark.rows.map((row) => {
      const swatch = h('span', { class: 'tip-swatch' });
      if (row.series) swatch.style.background = GL.chartDraw.colorFor(row.series, built.colors);
      return h('div', { class: 'tip-row' }, row.series ? swatch : null, h('span', { class: 'tip-label', text: row.label }), h('span', { class: 'tip-value', text: row.value }));
    });
    return [h('div', { class: 'tip-title', text: mark.title })].concat(rows);
  }

  function placeTooltip(tip, x, y) {
    const holder = byId('chart-canvas-holder');
    tip.hidden = false;
    const maxLeft = holder.clientWidth - tip.offsetWidth - 6;
    const flip = x + 14 + tip.offsetWidth > holder.clientWidth;
    const left = flip ? x - tip.offsetWidth - 14 : x + 14;
    tip.style.left = `${Math.max(6, Math.min(maxLeft, left))}px`;
    tip.style.top = `${Math.max(6, Math.min(holder.clientHeight - tip.offsetHeight - 6, y - tip.offsetHeight - 8))}px`;
  }

  function setActive(index) {
    if (index === activeIndex) return;
    activeIndex = index;
    paintCanvas();
    const tip = byId('chart-tooltip');
    const mark = built && built.marks[index];
    if (!mark) { hideTooltip(); return; }
    tip.replaceChildren(...tooltipContent(mark));
    placeTooltip(tip, mark.focusX, mark.focusY);
    byId('chart-live').textContent = `${mark.title}. ${mark.rows.map((r) => `${r.label} ${r.value}`).join(', ')}`;
  }

  function paintCanvas() {
    const canvas = byId('chart-canvas');
    const { width, height } = canvasSize();
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    built = GL.chartDraw.render(ctx, chart, width, height);
    if (activeIndex >= 0) GL.chartDraw.highlight(ctx, chart, built, activeIndex);
  }

  function renderTable() {
    const holder = byId('chart-table');
    clear(holder);
    holder.hidden = !showTable || !chart || !!chart.error;
    if (holder.hidden) return;
    const { header, rows, truncated } = GL.chartData.toTable(chart);
    holder.append(h('table', { class: 'plain-table' },
      h('thead', null, h('tr', null, header.map((label) => h('th', { scope: 'col', text: label })))),
      h('tbody', null, rows.map((row) => h('tr', null, row.map((cell, i) => (i === 0 ? h('th', { scope: 'row', text: cell }) : h('td', { text: cell }))))))));
    if (truncated) holder.append(h('p', { class: 'muted', text: 'First 500 points.' }));
  }

  function summaryFor() {
    return `${chart.title}. Hover or use the left and right arrow keys to read values.`;
  }

  function renderChart() {
    const canvas = byId('chart-canvas');
    const message = byId('chart-message');
    chart = GL.chartData.build(model.view.chart, model.columns, model.rowIndex);
    activeIndex = -1;
    hideTooltip();
    renderTable();
    if (chart.error) {
      built = null;
      canvas.hidden = true;
      message.hidden = false;
      message.textContent = chart.error;
      return;
    }
    message.hidden = true;
    canvas.hidden = false;
    canvas.setAttribute('aria-label', summaryFor());
    paintCanvas();
  }

  function isVisible() { return model.view.tab === 'chart' && !!model.dataset; }

  function onPointerMove(event) {
    if (!built) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    setActive(built.hit(built.marks, x, y, built.plot));
    if (activeIndex >= 0) placeTooltip(byId('chart-tooltip'), x, y);
  }

  function onKeydown(event) {
    if (!built || !built.marks.length) return;
    const last = built.marks.length - 1;
    let next = null;
    if (event.key === 'ArrowRight') next = activeIndex < 0 ? 0 : Math.min(last, activeIndex + 1);
    if (event.key === 'ArrowLeft') next = activeIndex < 0 ? 0 : Math.max(0, activeIndex - 1);
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = last;
    if (event.key === 'Escape') next = -1;
    if (next === null) return;
    event.preventDefault();
    setActive(next);
  }

  /** Redraws off screen at double resolution, so the PNG stays sharp on any display. */
  function exportPng() {
    if (!chart || chart.error) {
      GL.ui.toast('There is no chart to export yet.', { kind: 'error' });
      return;
    }
    const { width, height } = canvasSize();
    const canvas = document.createElement('canvas');
    canvas.width = width * EXPORT_SCALE;
    canvas.height = height * EXPORT_SCALE;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(EXPORT_SCALE, 0, 0, EXPORT_SCALE, 0, 0);
    GL.chartDraw.render(ctx, chart, width, height);
    canvas.toBlob((blob) => {
      download(`${GL.app.exportBase()}-${chart.kind}-chart.png`, blob);
      GL.ui.toast('Exported the chart as PNG.');
    }, 'image/png');
  }

  function refresh() {
    if (!isVisible()) return;
    model.view.chart = withDefaults(model.view.chart);
    renderControls();
    renderChart();
  }

  GL.chartView = {
    init() {
      const canvas = byId('chart-canvas');
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerdown', onPointerMove);
      // On touch the pointer leaves as soon as the finger lifts, which would hide the tooltip that tap just opened.
      canvas.addEventListener('pointerleave', (event) => { if (event.pointerType !== 'touch') setActive(-1); });
      canvas.addEventListener('keydown', onKeydown);
      canvas.addEventListener('blur', () => setActive(-1));
      model.on('dataset', refresh);
      model.on('columns', refresh);
      model.on('rows', refresh);
      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(GL.ui.debounce(() => { if (isVisible() && chart && !chart.error) paintCanvas(); }, 60)).observe(byId('chart-canvas-holder'));
      }
    },
    refresh,
    repaint() { if (isVisible() && chart && !chart.error) paintCanvas(); },
    exportPng,
  };
})();
