// Filter conditions. All conditions combine with AND; the text search is one more AND term.
(function (root) {
  'use strict';
  const GL = (root.GL = root.GL || {});
  const DAY = 86400000;

  const OPERATORS = {
    number: [
      ['eq', '=', 1], ['ne', '≠', 1], ['gt', '>', 1], ['gte', '≥', 1], ['lt', '<', 1], ['lte', '≤', 1],
      ['between', 'between', 2], ['empty', 'is empty', 0], ['notEmpty', 'is not empty', 0],
    ],
    date: [
      ['on', 'on', 1], ['before', 'before', 1], ['after', 'after', 1], ['between', 'between', 2],
      ['empty', 'is empty', 0], ['notEmpty', 'is not empty', 0],
    ],
    boolean: [
      ['isTrue', 'is true', 0], ['isFalse', 'is false', 0], ['empty', 'is empty', 0], ['notEmpty', 'is not empty', 0],
    ],
    text: [
      ['contains', 'contains', 1], ['notContains', 'does not contain', 1], ['equals', 'is', 1], ['notEquals', 'is not', 1],
      ['startsWith', 'starts with', 1], ['endsWith', 'ends with', 1], ['empty', 'is empty', 0], ['notEmpty', 'is not empty', 0],
    ],
  };
  const DEFAULT_OPERATOR = { number: 'gt', date: 'after', boolean: 'isTrue', text: 'contains' };

  function operatorsFor(type) {
    return OPERATORS[type].map(([id, label, arity]) => ({ id, label, arity }));
  }

  function operator(type, id) {
    return operatorsFor(type).find((op) => op.id === id) || null;
  }

  function defaultOperator(type) { return DEFAULT_OPERATOR[type]; }

  /** Reads a text box value as the column's type. Returns null when it is not valid. */
  function parseOperand(text, type) {
    const s = String(text === undefined || text === null ? '' : text).trim();
    if (!s) return null;
    if (type === 'number') {
      const n = GL.types.parseNumber(s);
      if (!Number.isNaN(n)) return n;
      return Number.isFinite(Number(s)) ? Number(s) : null;
    }
    if (type === 'date') {
      const ms = GL.types.parseDate(s, 'mdy');
      return Number.isNaN(ms) ? null : ms;
    }
    return s;
  }

  /** Returns an error message for an unusable condition, or null when it can be applied. */
  function validate(condition, column) {
    if (!column) return 'That column no longer exists.';
    const op = operator(column.type, condition.op);
    if (!op) return 'Choose an operator.';
    if (op.arity === 0) return null;
    const noun = { number: 'a number', date: 'a date', text: 'some text' }[column.type];
    const a = parseOperand(condition.a, column.type);
    if (a === null) return `Enter ${noun}.`;
    if (op.arity === 1) return null;
    const b = parseOperand(condition.b, column.type);
    if (b === null) return `Enter ${noun} for the upper bound.`;
    return a > b ? 'The lower bound is above the upper bound.' : null;
  }

  function numberTest(op, a, b) {
    switch (op) {
      case 'eq': return (v) => v === a;
      case 'ne': return (v) => v !== a;
      case 'gt': return (v) => v !== null && v > a;
      case 'gte': return (v) => v !== null && v >= a;
      case 'lt': return (v) => v !== null && v < a;
      case 'lte': return (v) => v !== null && v <= a;
      default: return (v) => v !== null && v >= a && v <= b;
    }
  }

  /** Date operands are whole days, so a timestamp at 14:30 still matches "on" that day. */
  function dateTest(op, a, b) {
    const dayStart = Math.floor(a / DAY) * DAY;
    switch (op) {
      case 'on': return (v) => v !== null && v >= dayStart && v < dayStart + DAY;
      case 'before': return (v) => v !== null && v < dayStart;
      case 'after': return (v) => v !== null && v >= dayStart + DAY;
      default: {
        const end = Math.floor(b / DAY) * DAY + DAY;
        return (v) => v !== null && v >= dayStart && v < end;
      }
    }
  }

  /** Text matching ignores case. "Is not" and "does not contain" keep empty cells, as spreadsheet filters do. */
  function textTest(op, needle) {
    const n = needle.toLowerCase();
    switch (op) {
      case 'contains': return (v) => v !== null && v.toLowerCase().includes(n);
      case 'notContains': return (v) => v === null || !v.toLowerCase().includes(n);
      case 'equals': return (v) => v !== null && v.toLowerCase() === n;
      case 'notEquals': return (v) => v === null || v.toLowerCase() !== n;
      case 'startsWith': return (v) => v !== null && v.toLowerCase().startsWith(n);
      default: return (v) => v !== null && v.toLowerCase().endsWith(n);
    }
  }

  function compileCondition(condition, column) {
    const { op } = condition;
    if (op === 'empty') return (v) => v === null;
    if (op === 'notEmpty') return (v) => v !== null;
    if (op === 'isTrue') return (v) => v === true;
    if (op === 'isFalse') return (v) => v === false;
    const a = parseOperand(condition.a, column.type);
    const b = parseOperand(condition.b, column.type);
    if (column.type === 'number') return numberTest(op, a, b);
    if (column.type === 'date') return dateTest(op, a, b);
    return textTest(op, a);
  }

  /** Returns the indices of rows that pass every valid condition and the text search. */
  function apply(conditions, search, columns, rowCount) {
    const byName = new Map(columns.map((c) => [c.name, c]));
    const tests = [];
    for (const condition of conditions) {
      const column = byName.get(condition.col);
      if (validate(condition, column)) continue;
      tests.push({ values: column.values, pass: compileCondition(condition, column) });
    }
    const needle = (search || '').trim().toLowerCase();
    const searchable = needle ? columns.filter((c) => !c.hidden) : [];
    const kept = new Uint32Array(rowCount);
    let size = 0;
    for (let row = 0; row < rowCount; row++) {
      let keep = true;
      for (let t = 0; t < tests.length && keep; t++) keep = tests[t].pass(tests[t].values[row]);
      if (keep && needle) keep = searchable.some((c) => c.raw[row].toLowerCase().includes(needle));
      if (keep) kept[size++] = row;
    }
    return kept.slice(0, size);
  }

  GL.filter = { operatorsFor, operator, defaultOperator, parseOperand, validate, apply };
})(typeof self !== 'undefined' ? self : this);
