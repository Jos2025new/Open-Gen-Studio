// SPIKE crash test: a child process commits state(1), state(2), ... in a loop; the parent kills it with SIGKILL at a
// random moment, reopens the store and checks it. Run for each store (fresh folder per run):
//   node spike/sqlite/crash-test.mjs v2 100
//   node spike/sqlite/crash-test.mjs sqlite 100
// A run is consistent when read() gives exactly state(k), where k is the savedAt of HEAD (sessions, globals and order
// all from the same step), and no acknowledged commit is missing (k >= last "ack" the child printed). After that the
// guards are exercised on the reopened store: stale baseAt -> 409, total loss -> 409, and each guard refusal must leave
// the state unchanged. Folders live under /tmp/ogs-sqlite-spike-data/crash-<store>, removed at the end.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createStoreV2 } from '../../server/store-v2.js';
import { createStoreSqlite } from './store-sqlite.js';
import { NS, S, expectedState, rng, sessionId, stepBody } from './fixture.mjs';

const SELF = fileURLToPath(import.meta.url);
const ROOT = '/tmp/ogs-sqlite-spike-data';
const ITEMS = 16;
const open = (which, dir) => (which === 'v2' ? createStoreV2(dir) : createStoreSqlite(dir));

/** Child: commits steps 1.. forever; prints "ack k" after each commit returns. */
async function child(which, dir) {
  const store = open(which, dir);
  for (let k = 1; ; k++) {
    const r = await store.commit(stepBody(k, k === 1 ? 0 : S(k - 1), { items: ITEMS }));
    if (r.status !== 204) { console.error(`refused ${k}: ${JSON.stringify(r)}`); process.exit(2); }
    process.stdout.write(`ack ${k}\n`);
  }
}

/** Reads the store and compares it with state(k) for k = HEAD. Returns { kind: 'empty'|'ok'|'torn'|'unreadable'|'lostAcked', k?, detail? }. */
async function verify(store, lastAck) {
  let text;
  try {
    text = await store.read();
  } catch (e) {
    return { kind: 'unreadable', detail: e.message };
  }
  if (text == null) return { kind: lastAck ? 'lostAcked' : 'empty', detail: lastAck ? `acked ${lastAck}, nothing stored` : undefined };
  let o;
  try { o = JSON.parse(text); } catch (e) { return { kind: 'unreadable', detail: `not JSON: ${e.message}` }; }
  const k = Math.round((o.savedAt - S(0)) / 1000);
  if (!(k >= 1) || o.savedAt !== S(k)) return { kind: 'torn', detail: `savedAt ${o.savedAt} is not a step` };
  const exp = expectedState(k, { items: ITEMS });
  const { sessions, ...globals } = o.state;
  if (!isDeepStrictEqual(Object.keys(sessions), Object.keys(exp.sessions))) return { kind: 'torn', k, detail: 'order differs from step k' };
  if (!isDeepStrictEqual(globals, exp.globals)) return { kind: 'torn', k, detail: 'globals differ from step k' };
  for (const id of Object.keys(exp.sessions)) {
    if (!isDeepStrictEqual(sessions[id], exp.sessions[id])) return { kind: 'torn', k, detail: `session ${id} differs from step k` };
  }
  if (k < lastAck) return { kind: 'lostAcked', k, detail: `acked ${lastAck}, store at ${k}` };
  return { kind: 'ok', k };
}

/** Guards on the reopened store. Each refusal must leave the state as it was. */
async function guards(store, k) {
  const res = {};
  const stale = await store.commit(stepBody(k + 1, 12345, { items: ITEMS }));
  res.staleBaseAt = stale.status === 409 && stale.reason === 'conflict';
  const total = stepBody(k + 1, S(k), { items: ITEMS });
  total.order = total.order.slice(0, 10);
  total.sessions = {};
  const t = await store.commit(total);
  res.totalLoss = t.status === 409 && t.reason === 'possible-loss';
  const exp = expectedState(k, { items: ITEMS });
  const id = sessionId(0);
  if (JSON.stringify(exp.sessions[id]).length > 4500) {
    const per = stepBody(k + 1, S(k), { items: ITEMS });
    per.sessions[id] = JSON.stringify({ id, feed: [] });
    const p = await store.commit(per);
    res.sessionLoss = p.status === 409 && p.reason === 'possible-loss';
  } else {
    res.sessionLoss = 'skipped (session under 4.5 KB at this step)';
  }
  const after = await verify(store, 0);
  res.stateUnchangedAfterRefusals = after.kind === 'ok' && after.k === k;
  return res;
}

async function parent(which, runs) {
  const dir = join(ROOT, `crash-${which}`);
  const pick = rng(4242);
  const sum = { store: which, runs, ok: 0, empty: 0, torn: 0, unreadable: 0, lostAcked: 0, stepsReached: [], failures: [], guardFailures: 0 };
  for (let r = 0; r < runs; r++) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const proc = spawn(process.execPath, ['--no-warnings', SELF, '--child', which, dir], { stdio: ['ignore', 'pipe', 'ignore'] });
    let lastAck = 0;
    proc.stdout.on('data', (chunk) => {
      for (const line of chunk.toString().split('\n')) if (line.startsWith('ack ')) lastAck = Math.max(lastAck, Number(line.slice(4)));
    });
    const closed = once(proc, 'close');
    await new Promise((res) => setTimeout(res, 30 + Math.floor(pick() * 600)));
    proc.kill('SIGKILL');
    await closed;
    const store = open(which, dir);
    const v = await verify(store, lastAck);
    sum[v.kind] = (sum[v.kind] ?? 0) + 1;
    if (v.kind === 'ok') {
      sum.stepsReached.push(v.k);
      const g = await guards(store, v.k);
      const bad = Object.entries(g).filter(([key, val]) => val === false);
      if (bad.length) { sum.guardFailures++; sum.failures.push({ run: r, guard: bad }); }
    } else if (sum.failures.length < 10) {
      sum.failures.push({ run: r, ...v });
    }
    if (typeof store.close === 'function') store.close();
  }
  const steps = sum.stepsReached;
  sum.stepsReached = { min: Math.min(...steps), max: Math.max(...steps), avg: Math.round(steps.reduce((a, b) => a + b, 0) / steps.length) };
  rmSync(dir, { recursive: true, force: true });
  return sum;
}

if (process.argv[2] === '--child') {
  await child(process.argv[3], process.argv[4]);
} else {
  const which = process.argv[2] ?? 'v2';
  const runs = Number(process.argv[3] ?? 100);
  const sum = await parent(which, runs);
  console.log(JSON.stringify(sum, null, 2));
}
