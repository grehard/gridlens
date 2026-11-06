// RFC 4180 CSV reader and writer. No DOM access, so it also runs inside the parse worker.
(function (root) {
  'use strict';
  const GL = (root.GL = root.GL || {});
  const QUOTE = 34, CR = 13, LF = 10;
  const CANDIDATES = [',', ';', '\t'];
  const SNIFF_CHARS = 65536, SNIFF_RECORDS = 200;

  /** Decodes file bytes as text, honouring UTF-8 and UTF-16 byte order marks. */
  function decode(buffer) {
    const bytes = new Uint8Array(buffer);
    let encoding = 'utf-8';
    if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
    return new TextDecoder(encoding).decode(bytes);
  }

  function stripBom(text) {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  /** Counts a candidate delimiter per record, ignoring anything inside quotes. */
  function countPerRecord(sample, delimiter, wasTruncated) {
    const code = delimiter.charCodeAt(0);
    const counts = [];
    let inQuotes = false, count = 0;
    for (let i = 0; i < sample.length && counts.length < SNIFF_RECORDS; i++) {
      const c = sample.charCodeAt(i);
      if (c === QUOTE) inQuotes = !inQuotes;
      else if (inQuotes) continue;
      else if (c === code) count++;
      else if (c === LF || c === CR) {
        if (c === CR && sample.charCodeAt(i + 1) === LF) i++;
        counts.push(count);
        count = 0;
      }
    }
    const lastRecordIsWhole = !wasTruncated && count > 0;
    if (lastRecordIsWhole && counts.length < SNIFF_RECORDS) counts.push(count);
    return counts;
  }

  function scoreCounts(counts) {
    const tally = new Map();
    for (const c of counts) tally.set(c, (tally.get(c) || 0) + 1);
    let mode = 0, best = 0;
    for (const [value, n] of tally) if (n > best || (n === best && value > mode)) { mode = value; best = n; }
    return { mode, consistency: counts.length ? best / counts.length : 0 };
  }

  /** Picks the delimiter that splits most records into the same number of fields. Comma if nothing splits. */
  function detectDelimiter(text) {
    const sample = text.slice(0, SNIFF_CHARS);
    const wasTruncated = text.length > SNIFF_CHARS;
    let winner = ',', top = { mode: 0, consistency: 0 };
    for (const delimiter of CANDIDATES) {
      const score = scoreCounts(countPerRecord(sample, delimiter, wasTruncated));
      if (score.mode === 0) continue;
      const better = score.consistency > top.consistency ||
        (score.consistency === top.consistency && score.mode > top.mode);
      if (better) { winner = delimiter; top = score; }
    }
    return winner;
  }

  /**
   * Resumable state machine: step() consumes a budget of characters, so the same code
   * can post progress from a worker or yield to the event loop on the main thread.
   * Rows are stored by column to keep 100,000-row files compact.
   */
  class CsvReader {
    constructor(input, options = {}) {
      this.text = stripBom(input);
      this.delimiter = options.delimiter || detectDelimiter(this.text);
      this.delimiterCode = this.delimiter.charCodeAt(0);
      this.pos = 0;
      this.header = null;
      this.pendingHeader = [];
      this.columns = [];
      this.rowCount = 0;
      this.fieldIndex = 0;
      this.warnings = { unterminated: 0, strayQuote: 0, shortRows: 0, longRows: 0 };
    }

    get done() { return this.pos >= this.text.length; }
    get progress() { return this.text.length ? this.pos / this.text.length : 1; }

    step(budget) {
      const stop = Math.min(this.text.length, this.pos + budget);
      while (this.pos < stop) this.readField();
      return this.done;
    }

    readField() {
      const quoted = this.text.charCodeAt(this.pos) === QUOTE;
      const value = quoted ? this.readQuoted() : this.readBare();
      if (this.pos >= this.text.length) { this.storeField(value); this.endRecord(); return; }
      const c = this.text.charCodeAt(this.pos);
      if (c === this.delimiterCode) {
        this.storeField(value);
        this.pos++;
        // A delimiter as the very last character means one more empty field.
        if (this.pos >= this.text.length) { this.storeField(''); this.endRecord(); }
        return;
      }
      this.pos += c === CR && this.text.charCodeAt(this.pos + 1) === LF ? 2 : 1;
      const isBlankLine = this.fieldIndex === 0 && value === '' && !quoted;
      if (isBlankLine) return;
      this.storeField(value);
      this.endRecord();
    }

    readBare() {
      const { text, delimiterCode } = this;
      const start = this.pos;
      let i = start;
      for (; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c === delimiterCode || c === LF || c === CR) break;
      }
      this.pos = i;
      return text.slice(start, i);
    }

    readQuoted() {
      const { text } = this;
      let out = '', from = this.pos + 1;
      for (;;) {
        const close = text.indexOf('"', from);
        if (close < 0) {
          this.warnings.unterminated++;
          this.pos = text.length;
          return out + text.slice(from);
        }
        if (text.charCodeAt(close + 1) === QUOTE) {
          out += text.slice(from, close + 1);
          from = close + 2;
          continue;
        }
        this.pos = close + 1;
        return out + text.slice(from, close) + this.readAfterClosingQuote();
      }
    }

    /** Text between a closing quote and the next delimiter breaks RFC 4180; keep it rather than lose data. */
    readAfterClosingQuote() {
      const tail = this.readBare();
      if (tail) this.warnings.strayQuote++;
      return tail;
    }

    storeField(value) {
      if (!this.header) { this.pendingHeader.push(value); this.fieldIndex++; return; }
      if (this.fieldIndex >= this.columns.length) this.addOverflowColumn();
      this.columns[this.fieldIndex].push(value);
      this.fieldIndex++;
    }

    addOverflowColumn() {
      this.columns.push(new Array(this.rowCount).fill(''));
      this.header.push('');
      this.warnings.longRows++;
    }

    endRecord() {
      if (!this.header) {
        this.header = this.pendingHeader;
        this.columns = this.header.map(() => []);
        this.fieldIndex = 0;
        return;
      }
      if (this.fieldIndex < this.columns.length) {
        this.warnings.shortRows++;
        for (let f = this.fieldIndex; f < this.columns.length; f++) this.columns[f].push('');
      }
      this.rowCount++;
      this.fieldIndex = 0;
    }

    result() {
      return {
        header: uniqueHeaders(this.header || []),
        columns: this.columns,
        rowCount: this.rowCount,
        delimiter: this.delimiter,
        warnings: this.warnings,
      };
    }
  }

  /** Blank names get a position-based name and repeats get a numeric suffix, so every column is addressable. */
  function uniqueHeaders(header) {
    const used = new Set();
    return header.map((rawName, index) => {
      const base = rawName.trim() || `column_${index + 1}`;
      let name = base;
      for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}_${n}`;
      used.add(name.toLowerCase());
      return name;
    });
  }

  function parse(text, options) {
    const reader = new CsvReader(text, options);
    reader.step(Infinity);
    return reader.result();
  }

  function quoteField(value) {
    const s = value === null || value === undefined ? '' : String(value);
    return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  /** Serialises rows with CRLF line ends, as RFC 4180 specifies. */
  function stringify(header, rows) {
    const lines = [header.map(quoteField).join(',')];
    for (const row of rows) lines.push(row.map(quoteField).join(','));
    return lines.join('\r\n') + '\r\n';
  }

  GL.csv = { decode, detectDelimiter, CsvReader, parse, stringify, uniqueHeaders };
})(typeof self !== 'undefined' ? self : this);
