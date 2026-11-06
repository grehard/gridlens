// The parse pipeline shared by the worker and the main-thread fallback.
(function (root) {
  'use strict';
  const GL = (root.GL = root.GL || {});
  const STEP_CHARS = 1 << 20;

  function assertLooksLikeText(text) {
    if (!text.trim()) throw new Error('This file is empty.');
    if (text.slice(0, 4096).indexOf('\u0000') >= 0) throw new Error('This looks like a binary file, not CSV text.');
  }

  /** Parses in slices so the caller can report progress and, on the main thread, keep the page responsive. */
  async function runParseJob(text, onProgress, yieldToEvents) {
    assertLooksLikeText(text);
    const reader = new GL.csv.CsvReader(text);
    while (!reader.step(STEP_CHARS)) {
      onProgress(reader.progress);
      if (yieldToEvents) await yieldToEvents();
    }
    const parsed = reader.result();
    if (!parsed.header.length) throw new Error('No header row was found in this file.');
    parsed.inference = parsed.columns.map((raw) => GL.types.inferType(raw));
    return parsed;
  }

  GL.runParseJob = runParseJob;
})(typeof self !== 'undefined' ? self : this);
