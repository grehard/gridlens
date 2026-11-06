// Canvas renderer. Canvas keeps a 20,000-point scatter cheap and gives PNG export directly.
// layout() computes scales and marks, draw() paints them, and hit-testing reads the same marks.
(function () {
  'use strict';
  const FONT = '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  const TICK_FONT = `12px ${FONT}`;
  const TITLE_FONT = `600 14px ${FONT}`;
  const MAX_BAR = 24, BAR_GAP = 2, MARKER_RADIUS = 4, MAX_MARKERS = 60, RING = 2;

  function theme() {
    const style = getComputedStyle(document.documentElement);
    const read = (name) => style.getPropertyValue(name).trim();
    return {
      surface: read('--chart-surface'), grid: read('--chart-grid'), axis: read('--chart-axis'), text: read('--text'),
      muted: read('--text-2'), accent: read('--accent'), other: read('--series-other'), cross: read('--chart-cross'),
      series: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => read(`--series-${n}`)),
    };
  }

  function colorFor(series, colors) {
    if (series.single) return colors.accent;
    if (series.isOther) return colors.other;
    return colors.series[series.slot] || colors.other;
  }

  function niceTicks(min, max, count) {
    if (min === max) { min -= 1; max += 1; }
    const step = GL.stats.niceStep((max - min) / count);
    const start = Math.floor(min / step) * step;
    const end = Math.ceil(max / step) * step;
    const ticks = [];
    for (let i = 0, value = start; value <= end + step * 1e-6; i++, value = start + i * step) ticks.push(GL.types.cleanNumber(value));
    return { ticks, step, min: start, max: end };
  }

  /** Dates tick evenly across their range rather than on round numbers of milliseconds. */
  function dateTicks(min, max, count) {
    const span = max - min || 86400000;
    const ticks = [];
    for (let i = 0; i <= count; i++) ticks.push(min + (span * i) / count);
    return { ticks, step: span / count, min, max: min + span };
  }

  function compactNumber(value, step) {
    const abs = Math.abs(value);
    if (abs >= 1e9) return `${GL.types.cleanNumber(value / 1e9)}B`;
    if (abs >= 1e6) return `${GL.types.cleanNumber(value / 1e6)}M`;
    if (abs >= 1e4) return `${GL.types.cleanNumber(value / 1e3)}K`;
    const decimals = step >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(step)));
    return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  function dateLabel(ms, span) {
    const iso = new Date(ms).toISOString();
    if (span > 300 * 86400000) return iso.slice(0, 7);
    return iso.slice(0, 10);
  }

  function tickLabeller(type, scale) {
    if (type === 'date') return (v) => dateLabel(v, scale.max - scale.min);
    return (v) => compactNumber(v, scale.step);
  }

  function valueRange(chart) {
    if (chart.kind === 'histogram') return { min: 0, max: Math.max(...chart.bins.map((b) => b.count), 1) };
    let min = chart.kind === 'bar' ? 0 : Infinity, max = chart.kind === 'bar' ? 0 : -Infinity;
    for (const series of chart.series) {
      for (const value of series.values) {
        if (value === null) continue;
        if (value < min) min = value;
        if (value > max) max = value;
      }
    }
    if (!Number.isFinite(min)) return { min: 0, max: 1 };
    return { min, max };
  }

  function pointRange(points, key) {
    let min = Infinity, max = -Infinity;
    for (const point of points) {
      if (point[key] < min) min = point[key];
      if (point[key] > max) max = point[key];
    }
    return { min, max };
  }

  function layoutLegend(ctx, chart, width, top) {
    const multiple = chart.series.length > 1;
    if (!multiple) return { items: [], bottom: top };
    ctx.font = TICK_FONT;
    const items = [];
    let x = 0, y = top;
    for (const series of chart.series) {
      const itemWidth = 18 + ctx.measureText(series.name).width + 14;
      if (x + itemWidth > width && x > 0) { x = 0; y += 18; }
      items.push({ series, x, y });
      x += itemWidth;
    }
    return { items, bottom: y + 18 };
  }

  function truncateToWidth(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let low = 0, high = text.length;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) low = mid;
      else high = mid - 1;
    }
    return `${text.slice(0, low)}…`;
  }

  function yScaleFor(chart) {
    if (chart.kind === 'scatter') {
      const range = pointRange(chart.points, 'y');
      return chart.yType === 'date' ? dateTicks(range.min, range.max, 4) : niceTicks(range.min, range.max, 5);
    }
    const range = valueRange(chart);
    return chart.yType === 'date' ? dateTicks(range.min, range.max, 4) : niceTicks(range.min, range.max, 5);
  }

  /** Decides whether category labels fit flat, need rotating, and how many to skip. */
  function categoryLabelPlan(ctx, labels, plotWidth, maxRotatedWidth) {
    ctx.font = TICK_FONT;
    const widest = Math.max(...labels.map((l) => ctx.measureText(l).width), 1);
    const slot = plotWidth / Math.max(1, labels.length);
    if (widest + 8 <= slot) return { rotated: false, every: 1, height: 18 };
    const flatEvery = Math.ceil((widest + 12) / slot);
    if (labels.length / flatEvery >= 4) return { rotated: false, every: flatEvery, height: 18 };
    const every = Math.max(1, Math.ceil(15 / slot));
    const rotatedWidth = Math.min(widest, maxRotatedWidth);
    return { rotated: true, every, height: Math.round(rotatedWidth * 0.68) + 14 };
  }

  function makeLayout(ctx, chart, width, height) {
    const titleTop = 18;
    const legendTop = chart.note ? 44 : 30;
    const legend = layoutLegend(ctx, chart, width - 24, legendTop);
    const top = legend.bottom + 10;
    const yScale = yScaleFor(chart);
    const yFormat = tickLabeller(chart.yType, yScale);
    ctx.font = TICK_FONT;
    const yTickWidth = Math.max(...yScale.ticks.map((t) => ctx.measureText(yFormat(t)).width));
    const left = Math.ceil(yTickWidth) + 30;
    const right = 18;
    const plotWidth = Math.max(40, width - left - right);
    let labelPlan = { rotated: false, every: 1, height: 18 };
    if (chart.kind === 'bar') {
      labelPlan = categoryLabelPlan(ctx, chart.categories.map((c) => c.label), plotWidth, 140);
    }
    const bottom = labelPlan.height + 24;
    const plot = { left, top, right: left + plotWidth, bottom: Math.max(top + 40, height - bottom), width: plotWidth };
    plot.height = plot.bottom - plot.top;
    const toY = (value) => plot.bottom - ((value - yScale.min) / (yScale.max - yScale.min || 1)) * plot.height;
    return { titleTop, legend, plot, yScale, yFormat, toY, labelPlan, width, height };
  }

  function drawFrame(ctx, chart, layout, colors) {
    const { plot, yScale, yFormat, toY } = layout;
    ctx.fillStyle = colors.surface;
    ctx.fillRect(0, 0, layout.width, layout.height);
    ctx.fillStyle = colors.text;
    ctx.font = TITLE_FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(truncateToWidth(ctx, chart.title, layout.width - 24), 12, layout.titleTop);
    ctx.font = TICK_FONT;
    if (chart.note) {
      ctx.fillStyle = colors.muted;
      ctx.fillText(truncateToWidth(ctx, chart.note, layout.width - 24), 12, layout.titleTop + 17);
    }
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = colors.axis;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const tick of yScale.ticks) {
      const y = Math.round(toY(tick)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(plot.left, y);
      ctx.lineTo(plot.right, y);
      ctx.stroke();
      ctx.fillText(yFormat(tick), plot.left - 6, y);
    }
    drawAxisTitles(ctx, chart, layout, colors);
    drawLegend(ctx, layout, colors);
  }

  function drawAxisTitles(ctx, chart, layout, colors) {
    const { plot } = layout;
    ctx.fillStyle = colors.muted;
    ctx.font = TICK_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(truncateToWidth(ctx, chart.xLabel, plot.width), plot.left + plot.width / 2, layout.height - 6);
    ctx.save();
    ctx.translate(13, plot.top + plot.height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(truncateToWidth(ctx, chart.yLabel, plot.height), 0, 0);
    ctx.restore();
  }

  function drawLegend(ctx, layout, colors) {
    ctx.font = TICK_FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const item of layout.legend.items) {
      ctx.fillStyle = colorFor(item.series, colors);
      ctx.fillRect(12 + item.x, item.y + 3, 12, 8);
      ctx.fillStyle = colors.text;
      ctx.fillText(item.series.name, 12 + item.x + 17, item.y + 7);
    }
  }

  function roundedTopPath(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, Math.abs(height));
    const direction = height >= 0 ? 1 : -1;
    const top = y, bottom = y + height;
    ctx.beginPath();
    ctx.moveTo(x, bottom);
    ctx.lineTo(x, top + r * direction);
    ctx.quadraticCurveTo(x, top, x + r, top);
    ctx.lineTo(x + width - r, top);
    ctx.quadraticCurveTo(x + width, top, x + width, top + r * direction);
    ctx.lineTo(x + width, bottom);
    ctx.closePath();
  }

  function drawCategoryLabels(ctx, layout, labels, centers, colors) {
    const { plot, labelPlan } = layout;
    ctx.fillStyle = colors.axis;
    ctx.font = TICK_FONT;
    labels.forEach((label, i) => {
      if (i % labelPlan.every) return;
      if (labelPlan.rotated) {
        ctx.save();
        ctx.translate(centers[i], plot.bottom + 8);
        ctx.rotate(-Math.PI / 4);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(truncateToWidth(ctx, label, 140), 0, 0);
        ctx.restore();
      } else {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(label, centers[i], plot.bottom + 6);
      }
    });
  }

  function tooltipRows(chart, index) {
    return chart.series
      .map((series) => ({ label: series.name, value: series.values[index], series }))
      .filter((row) => row.value !== null)
      .map((row) => ({ label: row.label, value: GL.types.displayValue(row.value, chart.yType), series: row.series }));
  }

  function barMarks(chart, layout) {
    const { plot, toY } = layout;
    const slot = plot.width / chart.categories.length;
    const seriesCount = chart.series.length;
    const barWidth = Math.max(2, Math.min(MAX_BAR, (slot * 0.76 - BAR_GAP * (seriesCount - 1)) / seriesCount));
    const groupWidth = barWidth * seriesCount + BAR_GAP * (seriesCount - 1);
    const baseline = toY(Math.max(layout.yScale.min, Math.min(0, layout.yScale.max)));
    const marks = [], centers = [];
    chart.categories.forEach((category, c) => {
      const center = plot.left + slot * (c + 0.5);
      centers.push(center);
      chart.series.forEach((series, s) => {
        const value = series.values[c];
        if (value === null) return;
        const x = center - groupWidth / 2 + s * (barWidth + BAR_GAP);
        const y = toY(value);
        // The target is the whole slot, so thin bars and short bars are still easy to hover.
        const hitLeft = s === 0 ? center - slot / 2 : x - BAR_GAP / 2;
        const hitRight = s === seriesCount - 1 ? center + slot / 2 : x + barWidth + BAR_GAP / 2;
        marks.push({
          series, x, y, width: barWidth, baseline,
          hit: { left: hitLeft, right: hitRight, top: plot.top, bottom: plot.bottom },
          focusX: x + barWidth / 2, focusY: Math.min(y, baseline),
          title: category.label,
          rows: [{ label: series.name, value: GL.types.displayValue(value, chart.yType), series }],
        });
      });
    });
    return { marks, centers, labels: chart.categories.map((c) => c.label) };
  }

  function drawBars(ctx, marks, colors) {
    for (const mark of marks) {
      ctx.fillStyle = colorFor(mark.series, colors);
      const height = mark.baseline - mark.y;
      if (Math.abs(height) < 1) { ctx.fillRect(mark.x, mark.baseline - 1, mark.width, 1); continue; }
      roundedTopPath(ctx, mark.x, mark.y, mark.width, height, 4);
      ctx.fill();
    }
  }

  function lineXScale(chart, plot) {
    const usable = chart.categories.filter((c) => c.usable).map((c) => c.position);
    const min = Math.min(...usable), max = Math.max(...usable);
    const span = max - min || 1;
    return (position) => plot.left + ((position - min) / span) * plot.width;
  }

  function lineMarks(chart, layout) {
    const toX = lineXScale(chart, layout.plot);
    const marks = [];
    chart.categories.forEach((category, c) => {
      if (!category.usable) return;
      const rows = tooltipRows(chart, c);
      const firstValue = chart.series.map((s) => s.values[c]).find((v) => v !== null);
      marks.push({
        x: toX(category.position), rows, title: category.label, index: c,
        focusX: toX(category.position), focusY: firstValue === undefined ? layout.plot.top : layout.toY(firstValue),
      });
    });
    return { marks, toX };
  }

  function drawLines(ctx, chart, layout, toX, colors) {
    const { toY } = layout;
    const markers = chart.categories.length <= MAX_MARKERS;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const series of chart.series) {
      const color = colorFor(series, colors);
      ctx.strokeStyle = color;
      ctx.beginPath();
      let drawing = false;
      chart.categories.forEach((category, c) => {
        const value = series.values[c];
        if (!category.usable || value === null) { drawing = false; return; }
        const x = toX(category.position), y = toY(value);
        if (drawing) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        drawing = true;
      });
      ctx.stroke();
      if (!markers) continue;
      chart.categories.forEach((category, c) => {
        const value = series.values[c];
        if (!category.usable || value === null) return;
        drawDot(ctx, toX(category.position), toY(value), MARKER_RADIUS, color, colors.surface);
      });
    }
  }

  function drawDot(ctx, x, y, radius, fill, ring) {
    ctx.beginPath();
    ctx.arc(x, y, radius + RING, 0, 2 * Math.PI);
    ctx.fillStyle = ring;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function drawLineTicks(ctx, chart, layout, toX, colors) {
    const usable = chart.categories.filter((c) => c.usable);
    ctx.font = TICK_FONT;
    const widest = Math.max(...usable.map((c) => ctx.measureText(c.label).width), 1);
    const every = Math.max(1, Math.ceil((widest + 16) / (layout.plot.width / Math.max(1, usable.length))));
    ctx.fillStyle = colors.axis;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    usable.forEach((category, i) => {
      if (i % every) return;
      const x = toX(category.position);
      const half = ctx.measureText(category.label).width / 2;
      const clamped = Math.min(layout.width - half - 2, Math.max(half + 2, x));
      ctx.fillText(category.label, clamped, layout.plot.bottom + 6);
    });
  }

  function scatterScaleX(chart) {
    const range = pointRange(chart.points, 'x');
    return chart.xType === 'date' ? dateTicks(range.min, range.max, 5) : niceTicks(range.min, range.max, 6);
  }

  function xValueTicks(ctx, layout, scale, type, toX, colors) {
    const format = tickLabeller(type, scale);
    ctx.fillStyle = colors.axis;
    ctx.font = TICK_FONT;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    const widest = Math.max(...scale.ticks.map((t) => ctx.measureText(format(t)).width), 1);
    const every = Math.max(1, Math.ceil((widest + 16) / (layout.plot.width / Math.max(1, scale.ticks.length - 1))));
    scale.ticks.forEach((tick, i) => {
      if (i % every) return;
      const text = format(tick);
      const half = ctx.measureText(text).width / 2;
      ctx.fillText(text, Math.min(layout.width - half - 2, Math.max(half + 2, toX(tick))), layout.plot.bottom + 6);
    });
  }

  function scatterMarks(chart, layout, toX) {
    return chart.points.map((point) => ({
      x: toX(point.x), y: layout.toY(point.y), point,
      focusX: toX(point.x), focusY: layout.toY(point.y),
      series: chart.series[point.series],
      title: `Row ${(point.row + 1).toLocaleString('en-US')}`,
      rows: [
        { label: chart.xLabel, value: GL.types.displayValue(point.x, chart.xType) },
        { label: chart.yLabel, value: GL.types.displayValue(point.y, chart.yType) },
      ].concat(chart.series[point.series].single ? [] : [{ label: 'Series', value: chart.series[point.series].name, series: chart.series[point.series] }]),
    }));
  }

  /** Dots get smaller and fainter as they multiply, so dense clouds show density rather than a solid block. */
  function drawScatter(ctx, marks, colors) {
    const dense = marks.length > 800;
    const radius = dense ? 2.5 : MARKER_RADIUS;
    ctx.globalAlpha = dense ? 0.45 : 0.85;
    for (const mark of marks) {
      ctx.fillStyle = colorFor(mark.series, colors);
      ctx.beginPath();
      ctx.arc(mark.x, mark.y, radius, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function histogramMarks(chart, layout) {
    const { bins } = chart;
    const { plot, toY } = layout;
    const slot = plot.width / bins.length;
    const single = chart.series[0];
    return bins.map((bin, i) => ({
      series: single, x: plot.left + i * slot + BAR_GAP / 2, y: toY(bin.count), width: Math.max(1, slot - BAR_GAP), baseline: toY(0),
      hit: { left: plot.left + i * slot, right: plot.left + (i + 1) * slot, top: plot.top, bottom: plot.bottom },
      focusX: plot.left + (i + 0.5) * slot, focusY: toY(bin.count),
      title: `${GL.types.displayValue(bin.from, chart.xType)} to ${GL.types.displayValue(bin.to, chart.xType)}`,
      rows: [{ label: 'Rows', value: GL.types.formatNumber(bin.count) }],
    }));
  }

  function histogramAxis(chart) {
    const first = chart.bins[0], last = chart.bins[chart.bins.length - 1];
    const scale = chart.xType === 'date' ? dateTicks(first.from, last.to, 5) : niceTicks(first.from, last.to, 6);
    return { scale: { ticks: scale.ticks.filter((t) => t >= first.from && t <= last.to), step: scale.step, min: first.from, max: last.to } };
  }

  /** Paints the chart and returns the marks plus a function for hit-testing them. */
  function render(ctx, chart, width, height) {
    const colors = theme();
    const layout = makeLayout(ctx, chart, width, height);
    drawFrame(ctx, chart, layout, colors);
    const { plot } = layout;
    let marks = [];
    let hit = null;
    if (chart.kind === 'bar') {
      const built = barMarks(chart, layout);
      marks = built.marks;
      drawBars(ctx, marks, colors);
      drawCategoryLabels(ctx, layout, built.labels, built.centers, colors);
      hit = hitBox;
    } else if (chart.kind === 'line') {
      const built = lineMarks(chart, layout);
      marks = built.marks;
      drawLines(ctx, chart, layout, built.toX, colors);
      drawLineTicks(ctx, chart, layout, built.toX, colors);
      hit = hitNearestColumn;
    } else if (chart.kind === 'scatter') {
      const scale = scatterScaleX(chart);
      const toX = (value) => plot.left + ((value - scale.min) / (scale.max - scale.min || 1)) * plot.width;
      marks = scatterMarks(chart, layout, toX);
      drawScatter(ctx, marks, colors);
      xValueTicks(ctx, layout, scale, chart.xType, toX, colors);
      hit = hitNearestPoint;
    } else {
      marks = histogramMarks(chart, layout);
      drawBars(ctx, marks, colors);
      const { scale } = histogramAxis(chart);
      const toX = (value) => plot.left + ((value - scale.min) / (scale.max - scale.min || 1)) * plot.width;
      xValueTicks(ctx, layout, scale, chart.xType, toX, colors);
      hit = hitBox;
    }
    return { marks, hit, plot, colors, layout };
  }

  function hitBox(marks, x, y) {
    return marks.findIndex((m) => x >= m.hit.left && x < m.hit.right && y >= m.hit.top && y <= m.hit.bottom);
  }

  function hitNearestColumn(marks, x, y, plot) {
    if (x < plot.left - 12 || x > plot.right + 12 || y < plot.top || y > plot.bottom) return -1;
    let best = -1, bestDistance = Infinity;
    marks.forEach((mark, i) => {
      const distance = Math.abs(mark.x - x);
      if (distance < bestDistance) { best = i; bestDistance = distance; }
    });
    return best;
  }

  function hitNearestPoint(marks, x, y) {
    let best = -1, bestDistance = 14 * 14;
    for (let i = 0; i < marks.length; i++) {
      const dx = marks[i].x - x, dy = marks[i].y - y;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) { best = i; bestDistance = distance; }
    }
    return best;
  }

  /** Draws the highlight for the active mark on top of the finished chart. */
  function highlight(ctx, chart, built, index) {
    const mark = built.marks[index];
    if (!mark) return;
    const { plot, colors, layout } = built;
    if (chart.kind === 'line') {
      ctx.strokeStyle = colors.cross;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(mark.x) + 0.5, plot.top);
      ctx.lineTo(Math.round(mark.x) + 0.5, plot.bottom);
      ctx.stroke();
      for (const series of chart.series) {
        const value = series.values[mark.index];
        if (value !== null) drawDot(ctx, mark.x, layout.toY(value), MARKER_RADIUS, colorFor(series, colors), colors.surface);
      }
      return;
    }
    if (chart.kind === 'scatter') {
      drawDot(ctx, mark.x, mark.y, MARKER_RADIUS + 1, colorFor(mark.series, colors), colors.surface);
      return;
    }
    ctx.strokeStyle = colors.text;
    ctx.lineWidth = 1.5;
    roundedTopPath(ctx, mark.x, mark.y, mark.width, mark.baseline - mark.y, 4);
    ctx.stroke();
  }

  GL.chartDraw = { render, highlight, colorFor };
})();
