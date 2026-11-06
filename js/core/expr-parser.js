// Tokenizer and Pratt parser for the computed-column language. Input is only ever turned into a
// plain syntax tree: the grammar has no property access, indexing, assignment or statements, so
// there is no syntax that could reach the JavaScript object model.
(function (root) {
  'use strict';
  const GL = (root.GL = root.GL || {});
  const MAX_LENGTH = 2000;
  const MAX_DEPTH = 48;
  const KEYWORDS = new Set(['and', 'or', 'not', 'true', 'false', 'null']);

  class ExprError extends Error {
    constructor(message, position) {
      super(message);
      this.position = position;
    }
  }

  const FORBIDDEN_HINTS = {
    '.': "'.' is not allowed: there is no property access in this language.",
    ';': "';' is not allowed: an expression is a single formula.",
    '`': 'Backticks are not allowed. Quote text with \' or ".',
    '&': "Use 'and' instead of '&'.",
    '|': "Use 'or' instead of '|'.",
    '{': "'{' is not allowed.",
    '}': "'}' is not allowed.",
    ']': "']' has no matching '['.",
    '^': 'Use pow(a, b) for powers.',
  };

  function readString(input, start) {
    const quote = input[start];
    let out = '', i = start + 1;
    while (i < input.length) {
      if (input[i] === quote) {
        if (input[i + 1] !== quote) return { value: out, next: i + 1 };
        out += quote;
        i += 2;
      } else {
        out += input[i++];
      }
    }
    throw new ExprError('This text is missing its closing quote.', start);
  }

  function readBracketColumn(input, start) {
    const close = input.indexOf(']', start);
    if (close < 0) throw new ExprError("'[' has no matching ']'.", start);
    const name = input.slice(start + 1, close).trim();
    if (!name) throw new ExprError('A column name is missing inside [ ].', start);
    return { value: name, next: close + 1 };
  }

  const TWO_CHAR_OPERATORS = new Set(['<=', '>=', '!=', '<>', '==']);
  const ONE_CHAR_OPERATORS = new Set(['+', '-', '*', '/', '%', '(', ')', ',', '<', '>', '=']);
  const NUMBER_TOKEN = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|^\.\d+(?:[eE][+-]?\d+)?/;
  const IDENTIFIER_TOKEN = /^[A-Za-z_][A-Za-z0-9_]*/;

  function tokenize(input) {
    const tokens = [];
    let i = 0;
    while (i < input.length) {
      const ch = input[i];
      if (/\s/.test(ch)) { i++; continue; }
      const rest = input.slice(i);
      const number = NUMBER_TOKEN.exec(rest);
      if (number) {
        const after = rest[number[0].length];
        if (after && /[A-Za-z_.]/.test(after)) throw new ExprError(`Unexpected '${after}' after a number.`, i + number[0].length);
        tokens.push({ kind: 'number', value: Number(number[0]), pos: i });
        i += number[0].length;
        continue;
      }
      const identifier = IDENTIFIER_TOKEN.exec(rest);
      if (identifier) {
        const lower = identifier[0].toLowerCase();
        if (KEYWORDS.has(lower)) tokens.push({ kind: 'keyword', value: lower, pos: i });
        else tokens.push({ kind: 'name', value: identifier[0], pos: i });
        i += identifier[0].length;
        continue;
      }
      if (ch === '"' || ch === "'") {
        const { value, next } = readString(input, i);
        tokens.push({ kind: 'string', value, pos: i });
        i = next;
        continue;
      }
      if (ch === '[') {
        const { value, next } = readBracketColumn(input, i);
        tokens.push({ kind: 'column', value, pos: i });
        i = next;
        continue;
      }
      const two = input.slice(i, i + 2);
      if (TWO_CHAR_OPERATORS.has(two)) { tokens.push({ kind: 'op', value: two, pos: i }); i += 2; continue; }
      if (ONE_CHAR_OPERATORS.has(ch)) { tokens.push({ kind: 'op', value: ch, pos: i }); i++; continue; }
      throw new ExprError(FORBIDDEN_HINTS[ch] || `Unexpected character '${ch}'.`, i);
    }
    return tokens;
  }

  const BINARY_POWER = {
    or: 1, and: 2,
    '=': 4, '==': 4, '!=': 4, '<>': 4, '<': 4, '<=': 4, '>': 4, '>=': 4,
    '+': 5, '-': 5, '*': 6, '/': 6, '%': 6,
  };
  const NOT_POWER = 3;
  const NEGATE_POWER = 7;

  class Parser {
    constructor(tokens) {
      this.tokens = tokens;
      this.index = 0;
      this.depth = 0;
    }

    peek() { return this.tokens[this.index] || null; }
    next() { return this.tokens[this.index++] || null; }

    isOp(value) {
      const t = this.peek();
      return !!t && t.kind === 'op' && t.value === value;
    }

    expectOp(value, message) {
      if (!this.isOp(value)) {
        const t = this.peek();
        throw new ExprError(message, t ? t.pos : -1);
      }
      this.next();
    }

    parseExpression(minPower = 0) {
      this.depth++;
      if (this.depth > MAX_DEPTH) throw new ExprError('This formula is nested too deeply.', -1);
      let left = this.parsePrefix();
      for (;;) {
        const t = this.peek();
        if (!t) break;
        const isBinary = t.kind === 'op' || (t.kind === 'keyword' && (t.value === 'and' || t.value === 'or'));
        const power = isBinary ? BINARY_POWER[t.value] : undefined;
        if (power === undefined || power <= minPower) break;
        this.next();
        const right = this.parseExpression(power);
        left = { kind: 'binary', op: t.value === '==' ? '=' : t.value === '<>' ? '!=' : t.value, left, right, pos: t.pos };
      }
      this.depth--;
      return left;
    }

    parsePrefix() {
      const t = this.next();
      if (!t) throw new ExprError('The formula ends too early.', -1);
      if (t.kind === 'number' || t.kind === 'string') return { kind: 'literal', value: t.value, type: t.kind === 'number' ? 'number' : 'text', pos: t.pos };
      if (t.kind === 'column') return { kind: 'column', name: t.value, pos: t.pos };
      if (t.kind === 'name') return this.parseNameOrCall(t);
      if (t.kind === 'keyword') return this.parseKeywordPrefix(t);
      if (t.value === '(') {
        const inner = this.parseExpression();
        this.expectOp(')', "A ')' is missing.");
        return inner;
      }
      if (t.value === '-') return { kind: 'negate', operand: this.parseExpression(NEGATE_POWER), pos: t.pos };
      if (t.value === '+') return this.parseExpression(NEGATE_POWER);
      throw new ExprError(`Unexpected '${t.value}'.`, t.pos);
    }

    parseKeywordPrefix(t) {
      if (t.value === 'true' || t.value === 'false') return { kind: 'literal', value: t.value === 'true', type: 'boolean', pos: t.pos };
      if (t.value === 'null') return { kind: 'literal', value: null, type: 'null', pos: t.pos };
      if (t.value === 'not') return { kind: 'not', operand: this.parseExpression(NOT_POWER), pos: t.pos };
      throw new ExprError(`Unexpected '${t.value}'.`, t.pos);
    }

    parseNameOrCall(t) {
      if (!this.isOp('(')) return { kind: 'column', name: t.value, pos: t.pos };
      this.next();
      const args = [];
      if (!this.isOp(')')) {
        do { args.push(this.parseExpression()); } while (this.consumeComma());
      }
      this.expectOp(')', `A ')' is missing after the arguments of ${t.value}.`);
      return { kind: 'call', name: t.value, args, pos: t.pos };
    }

    consumeComma() {
      if (!this.isOp(',')) return false;
      this.next();
      return true;
    }
  }

  /** Returns the syntax tree, or throws ExprError with a message written for the person typing. */
  function parse(input) {
    const source = String(input === undefined || input === null ? '' : input);
    if (!source.trim()) throw new ExprError('Enter a formula.', 0);
    if (source.length > MAX_LENGTH) throw new ExprError(`Formulas are limited to ${MAX_LENGTH} characters.`, 0);
    const parser = new Parser(tokenize(source));
    const tree = parser.parseExpression();
    const leftover = parser.peek();
    if (leftover) throw new ExprError(`Unexpected '${leftover.value}' here.`, leftover.pos);
    return tree;
  }

  GL.exprParser = { parse, ExprError };
})(typeof self !== 'undefined' ? self : this);
