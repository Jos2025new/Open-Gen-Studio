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

const FRESH = phase === 'all' || (phase === 'wal' && Number(process.env.WAL_FROM ?? 1) === 1);
if (FRESH) rmSync(dir, { recursive: true, force: true });
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
  // Lower bound of any store that takes the body's globals text: parse + stringify of the 25 MB text (no DB involved).
  const base = [];
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    JSON.stringify(JSON.parse(fx.globals));
    base.push(performance.now() - t);
  }
  out.parseStringifyGlobalsMs = stats(base);
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
  if (which === 'sqlite') {
    out.sqliteFilesBeforeCheckpoint = store.sizes();
    store.checkpoint();
    out.sqliteFilesAfterCheckpoint = store.sizes();
  }
  out.disk.afterEditsWithBackups = dirBytes(dir);
  out.disk.afterEditsDataOnly = dirBytes(dir, ['backups']);
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

// WAL phase in chunks (each chunk is one foreground command): WAL_FROM..WAL_TO, the store carries on from the previous
// chunk. Commit i has savedAt = fixture savedAt + i*1000, so the chunk starts at (WAL_FROM-1)*1000 after the import.
if (phase === 'wal') {
  if (which !== 'sqlite') throw new Error('the WAL phase is for sqlite only');
  const from = Number(process.env.WAL_FROM ?? 1), to = Number(process.env.WAL_TO ?? N_WAL);
  const store = open();
  if (from === 1) await importFixture(store);
  let cur = fx.savedAt + (from - 1) * 1000;
  const times = [], samples = [];
  let maxWal = 0;
  for (let i = from; i <= to; i++) {
    const { body, next } = smallEdit(i, cur);
    const t = performance.now();
    const r = await store.commit(body);
    times.push(performance.now() - t);
    if (r.status !== 204) throw new Error(`wal edit ${i} refused: ${JSON.stringify(r)}`);
    cur = next;
    maxWal = Math.max(maxWal, store.sizes().wal);
  }
  const beforeCheckpoint = store.sizes();
  store.checkpoint();
  out.walChunk = { from, to, commitMs: stats(times), walBeforeCheckpoint: beforeCheckpoint.wal, walMaxInChunk: maxWal, afterCheckpoint: store.sizes() };
  out.walSamples = samples;
  close(store);
  if (to === N_WAL) rmSync(dir, { recursive: true, force: true });
}

if (phase === 'all') rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify(out, null, 2));
