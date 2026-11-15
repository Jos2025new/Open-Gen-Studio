// SPIKE round 3 bench: one variant per run. The parent builds the fixture and the bodies (outside any timer) and talks
// to a separate "server" process (bench3-server.mjs) that holds only the store, so its RSS is the store's.
//   node spike/sqlite/bench3.mjs <v2|base|a|b|c> <outfile.json>
// Phases: import, 100 small edits (ui zoom + one session), 20 edits with a new generation + spend entry, 40 gesture-end
// saves (one big session), idle maintenance, disk and RSS, then a fresh process for the startup read (5 cycles).
// Bodies for v2/base/a carry the whole globals text; for b/c a delta by id (delta-client.mjs).
import { fork } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixture, makeGeneration, makeSession, makeSpend, rng, sessionId, NS } from './fixture.mjs';
import { createDeltaClient } from './delta-client.mjs';

const [, , variant = 'base', outFile] = process.argv;
const ROOT = '/tmp/ogs-sqlite-spike-data';
const dir = join(ROOT, `r3-${variant}`);
const SERVER = fileURLToPath(new URL('./bench3-server.mjs', import.meta.url));
const N_EDIT = 100, N_GEN = 20, N_GESTURE = 40;
const delta = variant === 'b' || variant === 'c';

rmSync(dir, { recursive: true, force: true });
const fx = buildFixture();
const g = JSON.parse(fx.globals);
const client = createDeltaClient();

function spawnServer() {
  const child = fork(SERVER, [variant, dir], { execArgv: ['--no-warnings', '--expose-gc'], serialization: 'json' });
  const waiting = new Map();
  let seq = 0;
  child.on('message', (m) => { const w = waiting.get(m.id); waiting.delete(m.id); if (m.error) w.reject(new Error(m.error)); else w.resolve(m); });
  const call = (msg) => new Promise((resolve, reject) => { const id = ++seq; waiting.set(id, { resolve, reject }); child.send({ id, ...msg }); });
  return { call, kill: () => child.kill('SIGKILL'), exited: new Promise((r) => child.on('exit', r)) };
}

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return Number(s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2)); };
const stats = (a) => ({ n: a.length, p50: pct(a, 0.5), p95: pct(a, 0.95), max: pct(a, 1) });

/** Commit body for the current globals object `g` (whole text, or a delta). */
function body(savedAt, baseAt, sessions) {
  const b = { savedAt, baseAt, version: 1, order: fx.order, sessions };
  if (delta) b.delta = client.diff(g);
  else b.globals = JSON.stringify(g);
  return b;
}

const out = { variant, fixture: { sessions: NS, globalsBytes: fx.globals.length } };
const srv = spawnServer();
await srv.call({ op: 'open' });
let cur = 0, at = fx.savedAt;

async function send(b) {
  const r = await srv.call({ op: 'commit', body: b });
  if (r.status !== 204) throw new Error(`commit refused: ${r.status} ${r.reason}`);
  if (delta) client.ack();
  return r.ms;
}

// Import: whole state.
{
  const b = body(at, 0, fx.sessions);
  out.importMs = Number((await send(b)).toFixed(1));
  cur = at;
}
out.memAfterImport = (await srv.call({ op: 'mem' })).mem;

// Wire cost of one small edit (not part of the store timer): bytes and JSON.parse time of the body the server must read.
{
  g.ui.zoom = 1.5;
  const sample = JSON.stringify(body(cur + 1000, cur, { [sessionId(1)]: JSON.stringify(makeSession(1, 2, { items: 120 })) }));
  const t = performance.now();
  JSON.parse(sample);
  out.wire = { editBodyBytes: sample.length, parseMs: Number((performance.now() - t).toFixed(1)) };
  if (delta) client.diff(g); // the sample diff is discarded (nothing was acknowledged); the next diff repeats it
}

const edit = [];
for (let i = 1; i <= N_EDIT; i++) {
  g.ui.zoom = 1 + (i % 1000) / 1000;
  const j = 1 + (i % (NS - 1));
  const next = cur + 1000;
  const b = body(next, cur, { [sessionId(j)]: JSON.stringify(makeSession(j, 1 + i, { items: 120 })) });
  edit.push(await send(b));
  cur = next;
}
out.smallEditMs = stats(edit);

// Edit with a new generation and spend entry (what an image generation does).
const r = rng(99);
const genEdit = [];
for (let i = 1; i <= N_GEN; i++) {
  const n = 40000 + i;
  g.generations[`gen_${n}`] = makeGeneration(n, r, NS);
  g.spendLog.push(makeSpend(n));
  g.spentUsd += 0.04;
  const j = 1 + (i % (NS - 1));
  const next = cur + 1000;
  const b = body(next, cur, { [sessionId(j)]: JSON.stringify(makeSession(j, 200 + i, { items: 120 })) });
  genEdit.push(await send(b));
  cur = next;
}
out.genEditMs = stats(genEdit);

const gesture = [];
for (let i = 1; i <= N_GESTURE; i++) {
  const next = cur + 1000;
  const text = JSON.stringify(makeSession(0, 1000 + i, { items: 800 }));
  out.gestureSessionBytes = text.length;
  gesture.push(await send(body(next, cur, { [sessionId(0)]: text })));
  cur = next;
}
out.gestureMs = stats(gesture);

out.memSteady = (await srv.call({ op: 'mem' })).mem;
out.diskBeforeIdle = await srv.call({ op: 'disk' });
const idle = await srv.call({ op: 'idle' });
out.idle = { ms: Number(idle.ms.toFixed(1)), copyBytes: idle.wrote };
out.diskAfterIdle = await srv.call({ op: 'disk' });
// A second idle after one more small edit (the copy of A is rebuilt in full).
{
  g.ui.zoom = 3;
  const next = cur + 1000;
  await send(body(next, cur, { [sessionId(1)]: JSON.stringify(makeSession(1, 400, { items: 120 })) }));
  cur = next;
  const i2 = await srv.call({ op: 'idle' });
  out.idleAfterEdit = { ms: Number(i2.ms.toFixed(1)) };
}
await srv.call({ op: 'close' });
srv.kill();
await srv.exited;

// Startup in a fresh process.
const s2 = spawnServer();
const st = await s2.call({ op: 'startup', n: 5 });
out.startup = { ms: stats(st.times), bytes: st.bytes, source: st.source, fullBytes: st.fullBytes, sha: st.sha, rssAfterFirst: st.rss1, rssEnd: st.rssEnd, page: st.page };
s2.kill();
await s2.exited;

rmSync(dir, { recursive: true, force: true });
if (outFile) writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out));
