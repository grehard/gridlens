// Type checker and compiler for computed columns. The compiler produces plain closures over
// column arrays; nothing is ever passed to eval or the Function constructor.
(function (root) {
  'use strict';
  const GL = (root.GL = root.GL || {});
  const { ExprError, parse } = GL.exprParser;
  const DAY = 86400000;

  const TYPE_NAMES = { number: 'a number', text: 'text', boolean: 'true/false', date: 'a date', null: 'empty' };

  function describe(type) { return TYPE_NAMES[type] || type; }

  /** Any null operand makes the whole result null, so one blank cell does not become a misleading number. */
  function nullSafe(a, b, fn) {
    return (row) => {
      const x = a(row);
      if (x === null) return null;
      const y = b(row);
      if (y === null) return null;
      const out = fn(x, y);
      return typeof out === 'number' && !Number.isFinite(out) ? null : out;
    };
  }

  const ARITHMETIC = {
    '*': (x, y) => x * y,
    '/': (x, y) => (y === 0 ? null : x / y),
    '%': (x, y) => (y === 0 ? null : x % y),
  };
  const COMPARISONS = {
    '=': (x, y) => x === y,
    '!=': (x, y) => x !== y,
    '<': (x, y) => x < y,
    '<=': (x, y) => x <= y,
    '>': (x, y) => x > y,
    '>=': (x, y) => x >= y,
  };

  function compilePlusMinus(node, left, right) {
    const { op, pos } = node;
    const pair = `${left.type},${right.type}`;
    if (pair === 'number,number') return { type: 'number', run: nullSafe(left.run, right.run, op === '+' ? (x, y) => x + y : (x, y) => x - y) };
    if (op === '+' && pair === 'text,text') return { type: 'text', run: nullSafe(left.run, right.run, (x, y) => x + y) };
    if (pair === 'date,number') return { type: 'date', run: nullSafe(left.run, right.run, op === '+' ? (x, y) => x + y * DAY : (x, y) => x - y * DAY) };
    if (op === '+' && pair === 'number,date') return { type: 'date', run: nullSafe(left.run, right.run, (x, y) => x * DAY + y) };
    if (op === '-' && pair === 'date,date') return { type: 'number', run: nullSafe(left.run, right.run, (x, y) => (x - y) / DAY) };
    throw new ExprError(`Cannot apply '${op}' to ${describe(left.type)} and ${describe(right.type)}.`, pos);
  }

  /** Lets a date column compare against a quoted date, as in order_date > '2024-01-31'. */
  function coerceDateLiteral(operand, other, pos) {
    if (other.type !== 'date' || operand.type !== 'text' || operand.literal === undefined) return operand;
    const ms = GL.types.parseDate(operand.literal);
    if (Number.isNaN(ms)) throw new ExprError(`'${operand.literal}' is not a date.`, pos);
    return { type: 'date', run: () => ms };
  }

  function compileComparison(node, leftIn, rightIn) {
    const left = coerceDateLiteral(leftIn, rightIn, node.pos);
    const right = coerceDateLiteral(rightIn, leftIn, node.pos);
    if (left.type === 'null' || right.type === 'null') throw new ExprError('Use isnull(x) to test for an empty value.', node.pos);
    if (left.type !== right.type) throw new ExprError(`Cannot compare ${describe(left.type)} with ${describe(right.type)}.`, node.pos);
    return { type: 'boolean', run: nullSafe(left.run, right.run, COMPARISONS[node.op]) };
  }

  /** Three-valued logic: false and blank is false, true or blank is true, otherwise blank stays blank. */
  function compileLogic(node, left, right) {
    for (const side of [left, right]) {
      if (side.type !== 'boolean' && side.type !== 'null') throw new ExprError(`'${node.op}' needs true/false values, not ${describe(side.type)}.`, node.pos);
    }
    const a = left.run, b = right.run;
    if (node.op === 'and') {
      return { type: 'boolean', run: (row) => {
        const x = a(row);
        if (x === false) return false;
        const y = b(row);
        if (y === false) return false;
        return x === null || y === null ? null : true;
      } };
    }
    return { type: 'boolean', run: (row) => {
      const x = a(row);
      if (x === true) return true;
      const y = b(row);
      if (y === true) return true;
      return x === null || y === null ? null : false;
    } };
  }

  function compileBinary(node, scope) {
    const left = compileNode(node.left, scope);
    const right = compileNode(node.right, scope);
    const { op } = node;
    if (op === 'and' || op === 'or') return compileLogic(node, left, right);
    if (COMPARISONS[op]) return compileComparison(node, left, right);
    if (op === '+' || op === '-') return compilePlusMinus(node, left, right);
    if (left.type !== 'number' || right.type !== 'number') throw new ExprError(`Cannot apply '${op}' to ${describe(left.type)} and ${describe(right.type)}.`, node.pos);
    return { type: 'number', run: nullSafe(left.run, right.run, ARITHMETIC[op]) };
  }

  function compileColumn(node, scope) {
    const column = scope.get(node.name) || scope.get(node.name.toLowerCase());
    if (!column) throw new ExprError(`Unknown column '${node.name}'. Use [Column name] for names with spaces.`, node.pos);
    const { values } = column;
    return { type: column.type, run: (row) => values[row] };
  }

  function unifyBranches(a, b, pos) {
    if (a.type === 'null') return b.type;
    if (b.type === 'null' || a.type === b.type) return a.type;
    throw new ExprError(`Both branches must give the same type, not ${describe(a.type)} and ${describe(b.type)}.`, pos);
  }

  function compileIf(node, scope) {
    if (node.args.length !== 3) throw new ExprError('if() takes three arguments: test, then, else.', node.pos);
    const [test, yes, no] = node.args.map((arg) => compileNode(arg, scope));
    if (test.type !== 'boolean' && test.type !== 'null') throw new ExprError(`The test in if() must be true/false, not ${describe(test.type)}.`, node.pos);
    const type = unifyBranches(yes, no, node.pos);
    return { type, run: (row) => (test.run(row) === true ? yes.run(row) : no.run(row)) };
  }

  function compileTextCast(node, scope) {
    if (node.args.length !== 1) throw new ExprError('text() takes one argument.', node.pos);
    const inner = compileNode(node.args[0], scope);
    return { type: 'text', run: (row) => {
      const v = inner.run(row);
      return v === null ? null : GL.exprFunctions.asText(v, inner.type);
    } };
  }

  function compileNumberCast(node, scope) {
    if (node.args.length !== 1) throw new ExprError('number() takes one argument.', node.pos);
    const inner = compileNode(node.args[0], scope);
    if (inner.type === 'number') return inner;
    if (inner.type !== 'text') throw new ExprError(`number() needs text, not ${describe(inner.type)}.`, node.pos);
    return { type: 'number', run: (row) => {
      const v = inner.run(row);
      if (v === null) return null;
      const n = GL.types.parseNumber(v);
      return Number.isNaN(n) ? null : n;
    } };
  }

  function checkArguments(spec, node, compiled) {
    const name = node.name.toLowerCase();
    const required = spec.params.length - (spec.optional || 0);
    const tooMany = !spec.rest && compiled.length > spec.params.length;
    if (compiled.length < required || tooMany) throw new ExprError(`Wrong number of arguments. Usage: ${spec.help}.`, node.pos);
    compiled.forEach((arg, i) => {
      const allowed = spec.params[Math.min(i, spec.params.length - 1)];
      if (!allowed || arg.type === 'null') return;
      if (!allowed.includes(arg.type)) throw new ExprError(`${name}() needs ${describe(allowed[0])} for argument ${i + 1}, not ${describe(arg.type)}.`, node.pos);
    });
    if (spec.sameType) {
      const types = new Set(compiled.map((a) => a.type).filter((t) => t !== 'null'));
      if (types.size > 1) throw new ExprError(`${name}() needs all arguments to have the same type.`, node.pos);
    }
  }

  function compileCall(node, scope) {
    const name = node.name.toLowerCase();
    if (name === 'if') return compileIf(node, scope);
    if (name === 'text') return compileTextCast(node, scope);
    if (name === 'number') return compileNumberCast(node, scope);
    const spec = GL.exprFunctions.FUNCTIONS.get(name);
    if (!spec) throw new ExprError(`Unknown function '${node.name}'.`, node.pos);
    const compiled = node.args.map((arg) => compileNode(arg, scope));
    checkArguments(spec, node, compiled);
    const runs = compiled.map((c) => c.run);
    const type = typeof spec.returns === 'function' ? spec.returns(compiled.map((c) => c.type)) : spec.returns;
    return { type, run: invoker(spec.run, runs) };
  }

  function invoker(fn, runs) {
    if (runs.length === 1) { const a = runs[0]; return (row) => fn(a(row)); }
    if (runs.length === 2) { const [a, b] = runs; return (row) => fn(a(row), b(row)); }
    return (row) => fn(...runs.map((run) => run(row)));
  }

  function compileNode(node, scope) {
    switch (node.kind) {
      case 'literal': {
        const { value } = node;
        const out = { type: node.type, run: () => value };
        if (node.type === 'text') out.literal = value;
        return out;
      }
      case 'column': return compileColumn(node, scope);
      case 'binary': return compileBinary(node, scope);
      case 'call': return compileCall(node, scope);
      case 'negate': {
        const inner = compileNode(node.operand, scope);
        if (inner.type !== 'number') throw new ExprError(`Cannot negate ${describe(inner.type)}.`, node.pos);
        return { type: 'number', run: (row) => { const v = inner.run(row); return v === null ? null : -v; } };
      }
      default: {
        const inner = compileNode(node.operand, scope);
        if (inner.type !== 'boolean') throw new ExprError(`'not' needs true/false, not ${describe(inner.type)}.`, node.pos);
        return { type: 'boolean', run: (row) => { const v = inner.run(row); return v === null ? null : !v; } };
      }
    }
  }

  /** Column names resolve exactly first and then ignoring case. A Map means __proto__ is just an unknown name. */
  function buildScope(columns) {
    const scope = new Map();
    for (const column of columns) {
      const lower = column.name.toLowerCase();
      if (!scope.has(lower)) scope.set(lower, column);
    }
    for (const column of columns) scope.set(column.name, column);
    return scope;
  }

  /** Returns { type, run(row) } or throws ExprError. */
  function compile(source, columns) {
    const tree = parse(source);
    const compiled = compileNode(tree, buildScope(columns));
    return { type: compiled.type === 'null' ? 'text' : compiled.type, run: compiled.run };
  }

  /** Non-throwing form for validating as someone types. */
  function check(source, columns) {
    try {
      const { type } = compile(source, columns);
      return { ok: true, type };
    } catch (error) {
      if (error instanceof ExprError) return { ok: false, error: error.message };
      throw error;
    }
  }

  GL.expr = { compile, check, ExprError };
})(typeof self !== 'undefined' ? self : this);
