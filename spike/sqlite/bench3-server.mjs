// SPIKE round 3: the "server" process of the bench. It holds only the store (like the app's server) and answers
// messages from the parent bench3.mjs over IPC. Run with --expose-gc so RSS can be read after a collection.
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { createStoreV2 } from '../../server/store-v2.js';
import { createStoreSqlite } from './store-sqlite.js';
import { createStoreA } from './store-a.js';
import { createStoreB } from './store-b.js';

const [, , variant, dir] = process.argv;
mkdirSync(dir, { recursive: true });
const open = () => (variant === 'v2' ? createStoreV2(dir) : variant === 'base' ? createStoreSqlite(dir) : variant === 'a' ? createStoreA(dir) : createStoreB(dir));
const mb = (n) => Number((n / 1048576).toFixed(1));
const mem = () => { global.gc?.(); const m = process.memoryUsage(); return { rssMB: mb(m.rss), heapMB: mb(m.heapUsed), extMB: mb(m.external + m.arrayBuffers), peakRssMB: mb(process.resourceUsage().maxRSS * 1024) }; };
function dirBytes(p, skip = []) {
  let total = 0;
  for (const e of readdirSync(p, { withFileTypes: true })) {
    if (skip.includes(e.name)) continue;
    const f = join(p, e.name);
    total += e.isDirectory() ? dirBytes(f, skip) : statSync(f).size;
  }
  return total;
}
const startCall = (s) => (variant === 'c' ? s.readPartial() : s.read());

let store = null;
process.on('message', async (m) => {
  const reply = (o) => process.send({ id: m.id, ...o });
  try {
    if (m.op === 'open') { store = open(); reply({}); }
    else if (m.op === 'commit') {
      const t = performance.now();
      const r = await store.commit(m.body);
      reply({ ms: performance.now() - t, status: r.status, reason: r.reason });
    } else if (m.op === 'idle') {
      const t = performance.now();
      const wrote = variant === 'a' ? store.idle() : variant === 'v2' ? 0 : (store.checkpoint(), 0);
      if (variant === 'b' || variant === 'c') store.checkpoint();
      reply({ ms: performance.now() - t, wrote });
    } else if (m.op === 'mem') reply({ mem: mem() });
    else if (m.op === 'disk') reply({ dataBytes: dirBytes(dir, ['backups']), withBackups: dirBytes(dir), sizes: store.sizes?.() });
    else if (m.op === 'close') { store.close?.(); store = null; reply({}); }
    else if (m.op === 'startup') {
      // Fresh process: N cycles of open + startup read; RSS after the first cycle (no leftovers of the commits).
      const times = [];
      let bytes = 0, rss1 = null, source = null;
      for (let i = 0; i < m.n; i++) {
        const t = performance.now();
        const s = open();
        const text = await startCall(s);
        times.push(performance.now() - t);
        bytes = text.length;
        source = s.lastReadSource?.() ?? null;
        if (i === 0) rss1 = mem();
        s.close?.();
      }
      // Whole state (to compare variants): for c, read() is the full read; hash only.
      const s = open();
      const full = await s.read();
      const sha = createHash('sha256').update(full).digest('hex').slice(0, 16);
      let page = null;
      if (variant === 'c') {
        const t = performance.now();
        const p = s.readPage('generations', 0 + 1e9, 500);
        const t1 = performance.now() - t;
        let pages = 0, n = 0, next = 1e9;
        const t2 = performance.now();
        do { const r = s.readPage('generations', next, 500); n += r.items.length; next = r.next; pages++; } while (next != null);
        page = { oneMs: t1, allMs: performance.now() - t2, pages, records: n, firstItems: p.items.length };
      }
      s.close?.();
      reply({ times, bytes, rss1, source, sha, fullBytes: full.length, page, rssEnd: mem() });
    }
  } catch (e) { reply({ error: String(e.stack ?? e) }); }
});
