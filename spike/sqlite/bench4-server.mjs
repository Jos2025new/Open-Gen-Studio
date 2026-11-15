// SPIKE round 4: the "server" process of bench4.mjs. Holds only the store and answers IPC messages.
// Run with --expose-gc so RSS/heap can be measured after garbage collection.
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { createStoreV2 } from '../../server/store-v2.js';
import { createStoreSqlite } from './store-sqlite.js';
import { createStoreA } from './store-a.js';
import { createStoreB } from './store-b.js';
import { createStoreBA } from './store-ba.js';

const [, , variant, dir] = process.argv;
mkdirSync(dir, { recursive: true });
const open = () => (
  variant === 'v2' ? createStoreV2(dir)
  : variant === 'base' ? createStoreSqlite(dir)
  : variant === 'a' ? createStoreA(dir)
  : variant === 'ba' ? createStoreBA(dir)
  : createStoreB(dir)
);
const mb = (n) => Number((n / 1048576).toFixed(1));
const mem = () => {
  global.gc?.();
  const m = process.memoryUsage();
  return {
    rssMB: mb(m.rss),
    heapMB: mb(m.heapUsed),
    extMB: mb(m.external + m.arrayBuffers),
    peakRssMB: mb(process.resourceUsage().maxRSS * 1024),
  };
};
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
      const wrote = (variant === 'a' || variant === 'ba') ? store.idle() : variant === 'v2' ? 0 : (store.checkpoint(), 0);
      if (variant === 'b' || variant === 'c') store.checkpoint();
      reply({ ms: performance.now() - t, wrote });
    } else if (m.op === 'mem') reply({ mem: mem() });
    else if (m.op === 'disk') reply({ dataBytes: dirBytes(dir, ['backups']), withBackups: dirBytes(dir), sizes: store.sizes?.() });
    else if (m.op === 'close') { store.close?.(); store = null; reply({}); }
    else if (m.op === 'startup') {
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
      const s = open();
      const full = await s.read();
      const sha = createHash('sha256').update(full).digest('hex').slice(0, 16);
      s.close?.();
      reply({ times, bytes, rss1, source, sha, fullBytes: full.length, rssEnd: mem() });
    }
  } catch (e) { reply({ error: String(e.stack ?? e) }); }
});
