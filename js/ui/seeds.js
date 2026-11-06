// Starting views for the sample datasets, so each one opens with something to look at.
(function () {
  'use strict';
  const { blankState, sanitize } = GL.viewState;

  function state(overrides) { return sanitize(Object.assign(blankState(), overrides)); }

  const DEFAULTS = {
    sales: {
      selected: 'total',
      computed: [{ name: 'margin', expr: 'round(total - quantity * unit_cost, 2)' }],
      pivot: { rows: [{ col: 'category', bucket: 'month' }], split: { col: 'region', bucket: 'month' }, measures: [{ agg: 'sum', col: 'total' }] },
      chart: { type: 'line', x: 'order_date', y: 'total', agg: 'sum', series: null, bucket: 'month', bins: 0 },
    },
    sales100k: {
      selected: 'total',
      pivot: { rows: [{ col: 'region', bucket: 'month' }], split: null, measures: [{ agg: 'sum', col: 'total' }, { agg: 'count', col: null }] },
      chart: { type: 'line', x: 'order_date', y: 'total', agg: 'sum', series: 'region', bucket: 'month', bins: 0 },
    },
    weather: {
      selected: 'temp_high_c',
      computed: [{ name: 'temp_range_c', expr: 'round(temp_high_c - temp_low_c, 1)' }],
      pivot: { rows: [{ col: 'station', bucket: 'month' }], split: null, measures: [{ agg: 'avg', col: 'temp_mean_c' }, { agg: 'sum', col: 'precip_mm' }, { agg: 'max', col: 'wind_kph' }] },
      chart: { type: 'line', x: 'date', y: 'temp_mean_c', agg: 'avg', series: 'climate_zone', bucket: 'month', bins: 0 },
    },
    tickets: {
      selected: 'resolution_hours',
      computed: [{ name: 'slow_first_reply', expr: 'first_response_min > 120' }],
      pivot: { rows: [{ col: 'team', bucket: 'month' }], split: { col: 'priority', bucket: 'month' }, measures: [{ agg: 'count', col: null }] },
      chart: { type: 'bar', x: 'team', y: null, agg: 'count', series: 'priority', bucket: 'month', bins: 0 },
    },
  };

  const VIEWS = [
    ['sales', 'West orders over 1,000', { filters: [{ col: 'region', op: 'equals', a: 'West', b: '' }, { col: 'total', op: 'gt', a: '1000', b: '' }], sort: { col: 'total', dir: 'desc' } }],
    ['sales', 'Revenue by category and region', { tab: 'pivot' }],
    ['sales', 'Monthly revenue by region', { tab: 'chart', chart: { type: 'line', x: 'order_date', y: 'total', agg: 'sum', series: 'region', bucket: 'month', bins: 0 } }],
    ['weather', 'Snow days', { filters: [{ col: 'snow', op: 'isTrue', a: '', b: '' }], sort: { col: 'temp_low_c', dir: 'asc' } }],
    ['weather', 'Station averages', { tab: 'pivot' }],
    ['weather', 'Humidity against rainfall', { tab: 'chart', filters: [{ col: 'had_precip', op: 'isTrue', a: '', b: '' }], chart: { type: 'scatter', x: 'humidity_pct', y: 'precip_mm', agg: 'count', series: 'climate_zone', bucket: 'month', bins: 0 } }],
    ['tickets', 'Open urgent tickets', { filters: [{ col: 'priority', op: 'equals', a: 'Urgent', b: '' }, { col: 'resolved_at', op: 'empty', a: '', b: '' }], sort: { col: 'created_at', dir: 'asc' } }],
    ['tickets', 'Tickets by team and priority', { tab: 'pivot' }],
    ['tickets', 'Resolution time spread', { tab: 'chart', chart: { type: 'histogram', x: 'resolution_hours', y: null, agg: 'count', series: null, bucket: 'month', bins: 40 } }],
  ];

  function defaultState(sampleId) {
    return state(DEFAULTS[sampleId] || {});
  }

  function views() {
    return VIEWS.map(([sampleId, name, overrides], index) => {
      const sample = GL.samples.CATALOG.find((c) => c.id === sampleId);
      return {
        id: `seed-${index}`, name, datasetKey: `sample:${sampleId}`, datasetName: sample.name,
        state: state(Object.assign({}, DEFAULTS[sampleId], overrides)),
      };
    });
  }

  GL.seeds = { defaultState, views };
})();
