// Turns files and text into parsed datasets. Prefers the background worker; Chrome refuses workers
// on file:// pages, so the same parse job then runs on the main thread in slices.
(function () {
  'use strict';
  const WORKER_PATH = 'js/core/parse-worker.js';
  let worker = null;
  let workerUnavailable = typeof Worker === 'undefined';
  let nextJobId = 1;
  const jobs = new Map();

  function failAllJobs() {
    workerUnavailable = true;
    worker = null;
    for (const job of jobs.values()) job.fallback();
    jobs.clear();
  }

  function onWorkerMessage(event) {
    const { id, progress, result, error } = event.data;
    const job = jobs.get(id);
    if (!job) return;
    if (progress !== undefined) { job.onProgress(progress); return; }
    jobs.delete(id);
    if (error) job.reject(new Error(error));
    else job.resolve(result);
  }

  function ensureWorker() {
    if (workerUnavailable) return null;
    if (worker) return worker;
    try {
      worker = new Worker(WORKER_PATH);
      worker.onmessage = onWorkerMessage;
      worker.onerror = (event) => { event.preventDefault(); failAllJobs(); };
      return worker;
    } catch (error) {
      workerUnavailable = true;
      return null;
    }
  }

  function yieldToEvents() { return new Promise((resolve) => setTimeout(resolve, 0)); }

  async function parseOnMainThread(payload, onProgress) {
    const text = payload.file ? GL.csv.decode(await payload.file.arrayBuffer()) : payload.text;
    const result = await GL.runParseJob(text, onProgress, yieldToEvents);
    result.sourceText = text.length <= payload.keepTextUpTo ? text : null;
    return result;
  }

  function parseInWorker(activeWorker, payload, onProgress) {
    return new Promise((resolve, reject) => {
      const id = nextJobId++;
      const fallback = () => parseOnMainThread(payload, onProgress).then(
        (result) => resolve({ result, mode: 'main' }), reject);
      jobs.set(id, {
        resolve: (result) => resolve({ result, mode: 'worker' }),
        reject, onProgress, fallback,
      });
      activeWorker.postMessage(Object.assign({ id }, payload));
    });
  }

  /** payload has either `file` or `text`. Returns { parsed, info } and throws Error with a readable message. */
  async function parse(payload, onProgress = () => {}) {
    const started = performance.now();
    const fullPayload = Object.assign({ keepTextUpTo: GL.store.MAX_REMEMBERED_CHARS }, payload);
    const activeWorker = ensureWorker();
    let outcome;
    if (activeWorker) {
      outcome = await parseInWorker(activeWorker, fullPayload, onProgress);
    } else {
      outcome = { result: await parseOnMainThread(fullPayload, onProgress), mode: 'main' };
    }
    return { parsed: outcome.result, info: { mode: outcome.mode, ms: Math.round(performance.now() - started) } };
  }

  const UNSUPPORTED = /\.(xlsx?|xlsm|ods|numbers|pdf|docx?|zip|png|jpe?g|gif)$/i;

  /** Checks that are cheap and specific, before reading any bytes. */
  function rejectionFor(file) {
    if (UNSUPPORTED.test(file.name)) return `${file.name} is not a text file. Save it as CSV first.`;
    if (file.size === 0) return `${file.name} is empty.`;
    return null;
  }

  /** Stable id, so reopening the same file replaces its recent entry and keeps its saved views. */
  function fileKey(name, size) {
    return `${name.toLowerCase()}|${size}`;
  }

  GL.loader = { parse, rejectionFor, fileKey };
})();
