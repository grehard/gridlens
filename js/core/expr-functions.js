// The only functions a computed column can call. Each entry declares its argument
// types and return type so that the checker can reject bad formulas before running them.
(function (root) {
  'use strict';
  const GL = (root.GL = root.GL || {});
  const DAY = 86400000;

  /** Wraps a function so that any null argument gives null, which is what a blank cell should do. */
  function strict(fn) {
    return (...args) => {
      for (let i = 0; i < args.length; i++) if (args[i] === null) return null;
      const out = fn(...args);
      return typeof out === 'number' && !Number.isFinite(out) ? null : out;
    };
  }

  function roundTo(x, digits = 0) {
    const scale = Math.pow(10, digits);
    return Math.round((x + Number.EPSILON * Math.sign(x)) * scale) / scale;
  }

  function dateField(read) { return strict((ms) => read(new Date(ms))); }

  function firstNonNull(...args) {
    for (let i = 0; i < args.length; i++) if (args[i] !== null) return args[i];
    return null;
  }

  function extreme(pick) {
    return (...args) => {
      let best = null;
      for (let i = 0; i < args.length; i++) {
        if (args[i] !== null && (best === null || pick(args[i], best))) best = args[i];
      }
      return best;
    };
  }

  function asText(value, type) { return GL.types.formatValue(value, type); }

  const NUM = ['number'], TXT = ['text'], DATE = ['date'], ANY = null;

  /**
   * params lists the accepted types per position; `rest` repeats the last one.
   * returns is a type name, or a function of the argument types.
   */
  const FUNCTIONS = new Map(Object.entries({
    abs: { params: [NUM], returns: 'number', run: strict(Math.abs), help: 'abs(x)' },
    round: { params: [NUM, NUM], optional: 1, returns: 'number', run: strict(roundTo), help: 'round(x, digits)' },
    floor: { params: [NUM], returns: 'number', run: strict(Math.floor), help: 'floor(x)' },
    ceil: { params: [NUM], returns: 'number', run: strict(Math.ceil), help: 'ceil(x)' },
    sqrt: { params: [NUM], returns: 'number', run: strict(Math.sqrt), help: 'sqrt(x)' },
    log: { params: [NUM], returns: 'number', run: strict(Math.log), help: 'log(x)' },
    pow: { params: [NUM, NUM], returns: 'number', run: strict(Math.pow), help: 'pow(a, b)' },
    min: { params: [NUM, NUM], rest: true, returns: 'number', run: extreme((a, b) => a < b), help: 'min(a, b, ...)' },
    max: { params: [NUM, NUM], rest: true, returns: 'number', run: extreme((a, b) => a > b), help: 'max(a, b, ...)' },
    len: { params: [TXT], returns: 'number', run: strict((s) => s.length), help: 'len(text)' },
    upper: { params: [TXT], returns: 'text', run: strict((s) => s.toUpperCase()), help: 'upper(text)' },
    lower: { params: [TXT], returns: 'text', run: strict((s) => s.toLowerCase()), help: 'lower(text)' },
    trim: { params: [TXT], returns: 'text', run: strict((s) => s.trim()), help: 'trim(text)' },
    left: { params: [TXT, NUM], returns: 'text', run: strict((s, n) => s.slice(0, Math.max(0, n))), help: 'left(text, n)' },
    right: { params: [TXT, NUM], returns: 'text', run: strict((s, n) => (n <= 0 ? '' : s.slice(-n))), help: 'right(text, n)' },
    contains: { params: [TXT, TXT], returns: 'boolean', run: strict((s, t) => s.toLowerCase().includes(t.toLowerCase())), help: 'contains(text, part)' },
    startswith: { params: [TXT, TXT], returns: 'boolean', run: strict((s, t) => s.toLowerCase().startsWith(t.toLowerCase())), help: 'startswith(text, part)' },
    endswith: { params: [TXT, TXT], returns: 'boolean', run: strict((s, t) => s.toLowerCase().endsWith(t.toLowerCase())), help: 'endswith(text, part)' },
    year: { params: [DATE], returns: 'number', run: dateField((d) => d.getUTCFullYear()), help: 'year(date)' },
    month: { params: [DATE], returns: 'number', run: dateField((d) => d.getUTCMonth() + 1), help: 'month(date)' },
    day: { params: [DATE], returns: 'number', run: dateField((d) => d.getUTCDate()), help: 'day(date)' },
    hour: { params: [DATE], returns: 'number', run: dateField((d) => d.getUTCHours()), help: 'hour(date)' },
    weekday: { params: [DATE], returns: 'text', run: dateField((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]), help: 'weekday(date)' },
    days_between: { params: [DATE, DATE], returns: 'number', run: strict((a, b) => (b - a) / DAY), help: 'days_between(start, end)' },
    isnull: { params: [ANY], nullable: true, returns: 'boolean', run: (v) => v === null, help: 'isnull(x)' },
    coalesce: { params: [ANY, ANY], rest: true, nullable: true, sameType: true, returns: (types) => types.find((t) => t !== 'null') || 'null', run: firstNonNull, help: 'coalesce(a, b, ...)' },
  }));

  /** if() is lazy and text() needs the static type, so the compiler handles those two itself. */
  const HELP_ONLY = ['if(test, then, else)', 'text(x)', 'number(text)'];

  function list() {
    return HELP_ONLY.concat(Array.from(FUNCTIONS.values(), (f) => f.help));
  }

  GL.exprFunctions = { FUNCTIONS, list, asText };
})(typeof self !== 'undefined' ? self : this);
