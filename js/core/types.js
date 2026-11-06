// Column type inference and value coercion. Dates are stored as UTC milliseconds of the wall-clock
// time in the file, so the same file produces the same values in every time zone.
(function (root) {
  'use strict';
  const GL = (root.GL = root.GL || {});
  const TYPES = ['number', 'date', 'boolean', 'text'];
  const NULL_TOKENS = new Set(['', 'na', 'n/a', 'null', 'none', 'nan']);
  const TRUE_WORDS = new Set(['true', 'yes', 'y', 't']);
  const FALSE_WORDS = new Set(['false', 'no', 'n', 'f']);
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  const US_NUMBER = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
  const EU_NUMBER = /^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+),\d+$/;
  const LEADING_ZERO = /^[+-]?0\d/;
  const ISO_DATE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/;
  const NUMERIC_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;
  const DAY_MONTH_NAME = /^(\d{1,2})[ -]([A-Za-z]{3,9})\.?,?[ -](\d{4})$/;
  const MONTH_NAME_DAY = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/;
  const DAY_MS = 86400000;

  function isBlank(raw) { return raw === '' || raw.trim() === ''; }
  function isNullToken(raw) { return NULL_TOKENS.has(raw.trim().toLowerCase()); }
  function finiteOrNaN(n) { return Number.isFinite(n) ? n : NaN; }

  /** Returns a number, or NaN. Rejects values with leading zeros because those are identifiers (007, 02134). */
  function parseNumber(raw) {
    let s = raw.trim();
    if (s.endsWith('%')) s = s.slice(0, -1).trim();
    s = s.replace(/^([+-]?)[$€£¥]\s?/, '$1');
    if (!/\d/.test(s) || LEADING_ZERO.test(s)) return NaN;
    if (US_NUMBER.test(s)) return finiteOrNaN(Number(s.replace(/,/g, '')));
    if (EU_NUMBER.test(s)) return finiteOrNaN(Number(s.replace(/\./g, '').replace(',', '.')));
    return NaN;
  }

  function parseBooleanWord(raw) {
    const s = raw.trim().toLowerCase();
    if (TRUE_WORDS.has(s)) return true;
    if (FALSE_WORDS.has(s)) return false;
    return null;
  }

  /** Manual override to boolean also accepts 1 and 0, which inference deliberately reads as numbers. */
  function parseBooleanLoose(raw) {
    const s = raw.trim();
    if (s === '1') return true;
    if (s === '0') return false;
    return parseBooleanWord(s);
  }

  function utcOrNaN(y, m, d, h = 0, min = 0, sec = 0) {
    const ms = Date.UTC(y, m - 1, d, h, min, sec);
    const date = new Date(ms);
    const valid = date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d &&
      h < 24 && min < 60 && sec < 60;
    return valid ? ms : NaN;
  }

  function offsetMs(zone) {
    if (!zone || zone === 'Z') return 0;
    const sign = zone[0] === '-' ? -1 : 1;
    const digits = zone.slice(1).replace(':', '');
    return sign * (Number(digits.slice(0, 2)) * 3600000 + Number(digits.slice(2)) * 60000);
  }

  function monthNameDate(year, name, day) {
    const month = MONTHS[name.toLowerCase().slice(0, 3)];
    return month ? utcOrNaN(year, month, day) : NaN;
  }

  /** order is 'mdy' or 'dmy' and only matters for numeric dates such as 03/04/2024. */
  function parseDate(raw, order = 'mdy') {
    const s = raw.trim();
    let m = ISO_DATE.exec(s);
    if (m) return utcOrNaN(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) - offsetMs(m[7]);
    m = NUMERIC_DATE.exec(s);
    if (m) return order === 'dmy' ? utcOrNaN(+m[3], +m[2], +m[1]) : utcOrNaN(+m[3], +m[1], +m[2]);
    m = DAY_MONTH_NAME.exec(s);
    if (m) return monthNameDate(+m[3], m[2], +m[1]);
    m = MONTH_NAME_DAY.exec(s);
    if (m) return monthNameDate(+m[3], m[1], +m[2]);
    return NaN;
  }

  /** A first part above 12 proves day-first; a second part above 12 proves month-first. Both is not a date. */
  function detectDateOrder(rawValues) {
    let dayFirst = false, monthFirst = false;
    for (let i = 0; i < rawValues.length; i++) {
      const m = NUMERIC_DATE.exec(rawValues[i].trim());
      if (!m) continue;
      if (+m[1] > 12) dayFirst = true;
      if (+m[2] > 12) monthFirst = true;
      if (dayFirst && monthFirst) return null;
    }
    return dayFirst ? 'dmy' : 'mdy';
  }

  /**
   * A type is chosen only when every non-null value fits it. Priority is boolean, number, date, text.
   * An all-empty column is text. NA, N/A, null, none and NaN count as empty while testing.
   */
  function inferType(rawValues) {
    let couldBool = true, couldNumber = true, seen = 0;
    const dateOrder = detectDateOrder(rawValues);
    let couldDate = dateOrder !== null;
    const textResult = { type: 'text', dateOrder: 'mdy' };
    for (let i = 0; i < rawValues.length; i++) {
      const raw = rawValues[i];
      if (isNullToken(raw)) continue;
      seen++;
      if (couldBool && parseBooleanWord(raw) === null) couldBool = false;
      if (couldNumber && Number.isNaN(parseNumber(raw))) couldNumber = false;
      if (couldDate && Number.isNaN(parseDate(raw, dateOrder))) couldDate = false;
      if (!couldBool && !couldNumber && !couldDate) return textResult;
    }
    if (!seen) return textResult;
    if (couldBool) return { type: 'boolean', dateOrder: 'mdy' };
    if (couldNumber) return { type: 'number', dateOrder: 'mdy' };
    if (couldDate) return { type: 'date', dateOrder };
    return textResult;
  }

  function coerceOne(raw, type, dateOrder) {
    if (type === 'boolean') return parseBooleanLoose(raw);
    const parsed = type === 'number' ? parseNumber(raw) : parseDate(raw, dateOrder);
    return Number.isNaN(parsed) ? null : parsed;
  }

  /**
   * Turns raw strings into typed values. Missing values become null. Values that do not fit a
   * manually chosen type also become null, and are counted so the UI can say how many were lost.
   * Text columns only treat blanks as empty: "NA" may well be a region code there.
   */
  function coerce(rawValues, type, dateOrder = 'mdy') {
    const n = rawValues.length;
    const values = new Array(n);
    let invalid = 0;
    for (let i = 0; i < n; i++) {
      const raw = rawValues[i];
      if (type === 'text') { values[i] = isBlank(raw) ? null : raw; continue; }
      if (isNullToken(raw)) { values[i] = null; continue; }
      const parsed = coerceOne(raw, type, dateOrder);
      if (parsed === null) invalid++;
      values[i] = parsed;
    }
    return { values, invalid };
  }

  function pad(n) { return n < 10 ? `0${n}` : String(n); }

  function formatDateMs(ms) {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '';
    const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    if (ms % DAY_MS === 0) return day;
    return `${day} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  }

  /** Removes binary floating point noise such as 0.30000000000000004 before showing or exporting a number. */
  function cleanNumber(n) { return Number(n.toPrecision(14)); }

  const GROUPED = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });

  function formatNumber(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return '';
    const abs = Math.abs(n);
    if (abs !== 0 && (abs >= 1e15 || abs < 1e-4)) return n.toExponential(3);
    return GROUPED.format(n);
  }

  /** Canonical text for a typed value, used by computed columns and pivot keys. */
  function formatValue(value, type) {
    if (value === null || value === undefined) return '';
    if (type === 'date') return formatDateMs(value);
    if (type === 'number') return String(cleanNumber(value));
    if (type === 'boolean') return value ? 'true' : 'false';
    return String(value);
  }

  /** Friendly text for a typed value in panels and tables: numbers get thousands separators. */
  function displayValue(value, type) {
    if (value === null || value === undefined) return '';
    return type === 'number' ? formatNumber(value) : formatValue(value, type);
  }

  GL.types = {
    TYPES, DAY_MS, parseNumber, parseDate, parseBooleanWord, inferType, coerce, isBlank, isNullToken,
    formatDateMs, formatNumber, formatValue, displayValue, cleanNumber,
  };
})(typeof self !== 'undefined' ? self : this);
