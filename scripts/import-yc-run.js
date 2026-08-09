// Resumable driver for the YC import: walks the directory in batches, logging
// progress so a long scan can be stopped and restarted without losing work.
//   node scripts/import-yc-run.js [startOffset] [endOffset] [batchSize]
const { importYc } = require('../jobs/seed');
const { pool } = require('../db');

(async () => {
  const start = parseInt(process.argv[2] || '0', 10);
  const end = parseInt(process.argv[3] || '6135', 10);
  const size = parseInt(process.argv[4] || '100', 10);
  let off = start, added = 0, scanned = 0;
  const t0 = Date.now();
  console.log(`[yc] scanning ${start}..${end} in batches of ${size}`);
  while (off < end) {
    const t = Date.now();
    try {
      const r = await importYc({ limit: Math.min(size, end - off), offset: off });
      added += r.added; scanned += r.scanned;
      const secs = (Date.now() - t) / 1000;
      const rate = scanned / ((Date.now() - t0) / 1000);
      const eta = rate > 0 ? Math.round((end - off - size) / rate / 60) : 0;
      console.log(`[yc] offset=${off} scanned=${r.scanned} added=${r.added} in ${secs.toFixed(0)}s | total added=${added} | ~${eta}min left`);
      off = r.nextOffset;
    } catch (e) {
      console.log(`[yc] offset=${off} BATCH FAILED: ${e.message} — skipping ahead`);
      off += size;
    }
  }
  console.log(`[yc] DONE scanned=${scanned} added=${added} in ${((Date.now() - t0) / 60000).toFixed(1)}min`);
  await pool.end();
})();
