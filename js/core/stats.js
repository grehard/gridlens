// Descriptive statistics for one column. Every function ignores nulls.
(function (root) {
  'use strict';
  const GL = (root.GL = root.GL || {});

  /** Middle value of the sorted numbers, or the mean of the two middle values for an even count. */
  function median(sortedNumbers) {
    const n = sortedNumbers.length;
    if (!n) return null;
    const mid = n >> 1;
    return n % 2 ? sortedNumbers[mid] : (sortedNumbers[mid - 1] + sortedNumbers[mid]) / 2;
  }

  function collect(values, rowIndex) {
    const present = [];
    for (let i = 0; i < rowIndex.length; i++) {
      const v = values[rowIndex[i]];
      if (v !== null && v !== undefined) present.push(v);
    }
    return present;
  }

  function numericSummary(present) {
    const sorted = Float64Array.from(present).sort();
    let sum = 0;
    for (let i = 0; i < sorted.length; i++) sum += sorted[i];
    return {
      min: sorted.length ? sorted[0] : null,
      max: sorted.length ? sorted[sorted.length - 1] : null,
      sum: sorted.length ? GL.types.cleanNumber(sum) : null,
      mean: sorted.length ? GL.types.cleanNumber(sum / sorted.length) : null,
      median: median(sorted),
      sorted,
    };
  }

  function textRange(present) {
    let min = null, max = null;
    for (const v of present) {
      if (min === null || v < min) min = v;
      if (max === null || v > max) max = v;
    }
    return { min, max };
  }

  function tally(present, limit, labelOf) {
    const counts = new Map();
    for (const v of present) counts.set(v, (counts.get(v) || 0) + 1);
    const entries = [];
    for (const [value, count] of counts) entries.push({ label: labelOf(value), count });
    entries.sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : 1));
    return { unique: counts.size, top: entries.slice(0, limit) };
  }

  /** Round step of the form 1, 2 or 5 times a power of ten. */
  function niceStep(rawStep) {
    if (rawStep <= 0 || !Number.isFinite(rawStep)) return 1;
    const power = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const scaled = rawStep / power;
    const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
    return nice * power;
  }

  function binLayout(min, max, binCount, exactEdges) {
    if (exactEdges) return { start: min, width: (max - min) / binCount, total: binCount };
    const width = niceStep((max - min) / binCount);
    const start = Math.floor(min / width) * width;
    const total = Math.floor((max - start) / width) + 1;
    return { start, width, total };
  }

  /**
   * Equal-width bins over the sorted values. Each bin holds [from, to), and the last one also
   * includes the maximum. Edges are round numbers unless exactEdges is set, as for dates.
   */
  function histogram(sorted, requestedBins, options = {}) {
    const n = sorted.length;
    if (!n) return [];
    const min = sorted[0], max = sorted[n - 1];
    if (min === max) return [{ from: min, to: max, count: n }];
    const binCount = requestedBins || Math.min(24, Math.max(5, Math.ceil(Math.log2(n)) + 1));
    const { start, width, total } = binLayout(min, max, binCount, options.exactEdges);
    const bins = [];
    for (let b = 0; b < total; b++) {
      bins.push({ from: GL.types.cleanNumber(start + b * width), to: GL.types.cleanNumber(start + (b + 1) * width), count: 0 });
    }
    for (let i = 0; i < n; i++) {
      bins[Math.min(total - 1, Math.floor((sorted[i] - start) / width))].count++;
    }
    return bins;
  }

  /** Full profile of a column over the rows currently in view. */
  function profile(column, rowIndex) {
    const present = collect(column.values, rowIndex);
    const total = rowIndex.length;
    const base = { total, nulls: total - present.length, type: column.type };
    const labelOf = (v) => GL.types.formatValue(v, column.type);
    const { unique, top } = tally(present, 8, labelOf);
    if (column.type === 'number' || column.type === 'date') {
      const summary = numericSummary(present);
      const bins = histogram(summary.sorted, null, { exactEdges: column.type === 'date' });
      delete summary.sorted;
      return Object.assign(base, summary, { unique, bins });
    }
    if (column.type === 'boolean') return Object.assign(base, { unique, top });
    return Object.assign(base, textRange(present), { unique, top });
  }

  GL.stats = { median, histogram, niceStep, profile, collect };
})(typeof self !== 'undefined' ? self : this);
