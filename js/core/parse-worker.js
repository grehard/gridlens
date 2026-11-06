// Runs CSV parsing and type inference off the main thread. The page falls back to the same
// code on the main thread when workers are unavailable, as they are for file:// pages in Chrome.
importScripts('csv.js', 'types.js', 'parse-job.js');

self.onmessage = async (event) => {
  const { id, file, text } = event.data;
  try {
    const source = file ? self.GL.csv.decode(await file.arrayBuffer()) : text;
    const onProgress = (progress) => self.postMessage({ id, progress });
    const result = await self.GL.runParseJob(source, onProgress);
    // The page keeps small files as raw text so it can remember them between visits.
    result.sourceText = source.length <= event.data.keepTextUpTo ? source : null;
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error.message || 'Could not read this file.' });
  }
};
