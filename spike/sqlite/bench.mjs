// SPIKE bench: current store-v2 vs spike store-sqlite on the same fixture, in-process, commit(body) without HTTP.
// Usage (one store per process, heavy, run under systemd-run):
//   node spike/sqlite/bench.mjs v2 all        -> import, small edits, gesture-end saves, startup read, disk sizes
//   node spike/sqlite/bench.mjs sqlite all
//   node spike/sqlite/bench.mjs sqlite wal    -> fresh import, 1000 small commits, WAL size samples (sqlite only)
// Everything lives under /tmp/ogs-sqlite-spike-data/bench-<store>, removed by the caller at the end.
// Bodies are built outside the timer; the timer covers only store.commit(body).
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createStoreV2 } from '../../server/store-v2.js';
import { createStoreSqlite } from './store-sqlite.js';
import { buildFixture, makeSession, sessionId, NS } from './fixture.mjs';

const [, , which = 'v2', phase = 'all'] = process.argv;
const ROOT = '/tmp/ogs-sqlite-spike-data';
const dir = join(ROOT, `bench-${which}`);
const N_EDIT = Number(process.env.N_EDIT ?? 100);
const N_GESTURE = Number(process.env.N_GESTURE ?? 40);
const N_WAL = Number(process.env.N_WAL ?? 1000);
const N_READ = 5;

const open = () => (which === 'v2' ? createStoreV2(dir) : createStoreSqlite(dir));
const close = (s) => s.close?.();
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return Number(s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2)); };
const stats = (a) => ({ n: a.length, p50: pct(a, 0.5), p95: pct(a, 0.95), max: pct(a, 1) });

function dirBytes(p, skip = []) {
  let total = 0;
  for (const e of readdirSync(p, { withFileTypes: true })) {
    if (skip.includes(e.name)) continue;
    const f = join(p, e.name);
    total += e.isDirectory() ? dirBytes(f) : statSync(f).size;
  }
  return total;
}

rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const fx = buildFixture();
const globalsObj = JSON.parse(fx.globals);
const out = { store: which, phase, fixture: { sessions: NS, globalsBytes: fx.globals.length, sessionsBytes: Object.values(fx.sessions).reduce((a, t) => a + t.length, 0) } };

/** Initial import: every session + globals (also the first commit, which takes its first snapshot). */
async function importFixture(store) {
  const t = performance.now();
  const r = await store.commit({ savedAt: fx.savedAt, baseAt: 0, version: 1, globals: fx.globals, order: fx.order, sessions: fx.sessions });
  if (r.status !== 204) throw new Error(`import refused: ${JSON.stringify(r)}`);
  return performance.now() - t;
}

/** Small edit: one session (4-30 KB, grows) and the UI part of globals. Returns the next savedAt. */
function smallEdit(i, cur) {
  globalsObj.ui.zoom = 1 + (i % 1000) / 1000;
  const globals = JSON.stringify(globalsObj);
  const j = 1 + (i % (NS - 1)); // never session 0: the gesture uses it
  const next = cur + 1000;
  const body = { savedAt: next, baseAt: cur, version: 1, globals, order: fx.order, sessions: { [sessionId(j)]: JSON.stringify(makeSession(j, 1 + i, { items: 120 })) } };
  return { body, next };
}

if (phase === 'all') {
  let store = open();
  out.importMs = Number((await importFixture(store)).toFixed(1));
  out.disk = { afterImportWithBackups: dirBytes(dir), afterImportDataOnly: dirBytes(dir, ['backups']) };

  let cur = fx.savedAt;
  const edit = [];
  // Small edits and gestures: the session sizes only grow (the guard must not see a shrink).
  for (let i = 1; i <= N_EDIT; i++) {
    const { body, next } = smallEdit(i, cur);
    const t = performance.now();
    const r = await store.commit(body);
    edit.push(performance.now() - t);
    if (r.status !== 204) throw new Error(`small edit ${i} refused: ${JSON.stringify(r)}`);
    cur = next;
  }
  out.smallEditMs = stats(edit);

  const gesture = [];
  const lastGlobals = JSON.stringify(globalsObj);
  for (let i = 1; i <= N_GESTURE; i++) {
    const next = cur + 1000;
    const sessionText = JSON.stringify(makeSession(0, 1000 + i, { items: 800 }));
    out.gestureSessionBytes = sessionText.length;
    const body = { savedAt: next, baseAt: cur, version: 1, globals: lastGlobals, order: fx.order, sessions: { [sessionId(0)]: sessionText } };
    const t = performance.now();
    const r = await store.commit(body);
    gesture.push(performance.now() - t);
    if (r.status !== 204) throw new Error(`gesture ${i} refused: ${JSON.stringify(r)}`);
    cur = next;
  }
  out.gestureEndMs = stats(gesture);
  out.disk.afterEditsWithBackups = dirBytes(dir);
  out.disk.afterEditsDataOnly = dirBytes(dir, ['backups']);
  if (which === 'sqlite') out.sqliteFiles = store.sizes();
  close(store);

  const reads = [];
  for (let i = 0; i < N_READ; i++) {
    const t = performance.now();
    const s = open();
    const text = await s.read();
    reads.push(performance.now() - t);
    close(s);
    if (!text) throw new Error('read returned nothing');
    out.readBytes = text.length;
  }
  out.startupReadMs = stats(reads);
  out.disk.finalWithBackups = dirBytes(dir);
}

if (phase === 'wal') {
  if (which !== 'sqlite') throw new Error('the WAL phase is for sqlite only');
  const store = open();
  await importFixture(store);
  let cur = fx.savedAt;
  const times = [], wal = [];
  let maxWal = 0;
  for (let i = 1; i <= N_WAL; i++) {
    const { body, next } = smallEdit(i, cur);
    const t = performance.now();
    const r = await store.commit(body);
    times.push(performance.now() - t);
    if (r.status !== 204) throw new Error(`wal edit ${i} refused: ${JSON.stringify(r)}`);
    cur = next;
    const s = store.sizes();
    maxWal = Math.max(maxWal, s.wal);
    if (i === 100 || i === 500 || i === N_WAL) wal.push({ commit: i, walBytes: s.wal, dbBytes: s.db });
  }
  out.walCommitMs = stats(times);
  out.walSamples = wal;
  out.walMaxBytes = maxWal;
  out.sqliteFilesAfter = store.sizes();
  close(store);
}

rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify(out, null, 2));
