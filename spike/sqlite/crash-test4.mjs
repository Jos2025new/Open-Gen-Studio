// SPIKE round 4 crash test for variant ba (B+A):
// - child commits state(1), state(2)... using delta-client.mjs (B) and calls store.idle() every 3rd step (A),
//   and is killed with SIGKILL at a random moment.
// - parent reopens the store with createStoreBA and checks read() is exactly state(k) with k = HEAD (whether served
//   from the valid state-cache.txt copy or fallen back to SQLite tables), no acked commit is lost, and guards hold.
//   node spike/sqlite/crash-test4.mjs ba 100
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createStoreA } from './store-a.js';
import { createStoreB } from './store-b.js';
import { createStoreBA } from './store-ba.js';
import { createDeltaClient } from './delta-client.mjs';
import { S, expectedState, rng, sessionId, stepBody } from './fixture.mjs';

const SELF = fileURLToPath(import.meta.url);
const ROOT = '/tmp/ogs-sqlite-spike-data';
const ITEMS = 16;
const open = (which, dir) => (which === 'a' ? createStoreA(dir) : which === 'ba' ? createStoreBA(dir) : createStoreB(dir));
const isDelta = (which) => which === 'b' || which === 'c' || which === 'ba';
const hasCopy = (which) => which === 'a' || which === 'ba';

function bodyFor(which, k, baseAt, client) {
  const b = stepBody(k, baseAt, { items: ITEMS });
  if (!isDelta(which)) return b;
  const { globals, ...rest } = b;
  return { ...rest, delta: client.diff(JSON.parse(globals)) };
}

async function child(which, dir) {
  const store = open(which, dir);
  const client = createDeltaClient();
  for (let k = 1; ; k++) {
    const r = store.commit(bodyFor(which, k, k === 1 ? 0 : S(k - 1), client));
    if (r.status !== 204) { console.error(`refused ${k}: ${JSON.stringify(r)}`); process.exit(2); }
    if (isDelta(which)) client.ack();
    process.stdout.write(`ack ${k}\n`);
    if (hasCopy(which) && k % 3 === 0) store.idle();
  }
}

function checkState(text, lastAck) {
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

async function verify(store, lastAck) {
  let text;
  try { text = store.read(); } catch (e) { return { kind: 'unreadable', detail: e.message }; }
  if (text == null) return { kind: lastAck ? 'lostAcked' : 'empty', detail: lastAck ? `acked ${lastAck}, nothing stored` : undefined };
  return checkState(text, lastAck);
}

async function guards(which, store, k) {
  const res = {};
  const wire = (b) => (isDelta(which) ? (({ globals, ...r }) => ({ ...r, delta: {} }))(b) : b);
  const stale = store.commit(wire(stepBody(k + 1, 12345, { items: ITEMS })));
  res.staleBaseAt = stale.status === 409 && stale.reason === 'conflict';
  const total = wire(stepBody(k + 1, S(k), { items: ITEMS }));
  total.order = total.order.slice(0, 10);
  total.sessions = {};
  const t = store.commit(total);
  res.totalLoss = t.status === 409 && t.reason === 'possible-loss';
  const exp = expectedState(k, { items: ITEMS });
  const id = sessionId(0);
  if (JSON.stringify(exp.sessions[id]).length > 4500) {
    const per = wire(stepBody(k + 1, S(k), { items: ITEMS }));
    per.sessions[id] = JSON.stringify({ id, feed: [] });
    const p = store.commit(per);
    res.sessionLoss = p.status === 409 && p.reason === 'possible-loss';
  } else res.sessionLoss = 'skipped (session under 4.5 KB at this step)';
  const after = await verify(store, 0);
  res.stateUnchangedAfterRefusals = after.kind === 'ok' && after.k === k;
  return res;
}

async function parent(which, runs) {
  const dir = join(ROOT, `crash4-${which}`);
  const pick = rng(4242);
  const sum = { store: which, runs, ok: 0, empty: 0, torn: 0, unreadable: 0, lostAcked: 0, stepsReached: [], failures: [], guardFailures: 0, readSource: { copy: 0, tables: 0 } };
  for (let r = 0; r < runs; r++) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const proc = spawn(process.execPath, ['--no-warnings', SELF, '--child', which, dir], { stdio: ['ignore', 'pipe', 'ignore'] });
    let lastAck = 0;
    proc.stdout.on('data', (chunk) => { for (const line of chunk.toString().split('\n')) if (line.startsWith('ack ')) lastAck = Math.max(lastAck, Number(line.slice(4))); });
    const closed = once(proc, 'close');
    await new Promise((res) => setTimeout(res, 30 + Math.floor(pick() * 600)));
    proc.kill('SIGKILL');
    await closed;
    const store = open(which, dir);
    const v = await verify(store, lastAck);
    sum[v.kind] = (sum[v.kind] ?? 0) + 1;
    if (hasCopy(which) && store.lastReadSource()) sum.readSource[store.lastReadSource()] = (sum.readSource[store.lastReadSource()] ?? 0) + 1;
    if (v.kind === 'ok') {
      sum.stepsReached.push(v.k);
      const g = await guards(which, store, v.k);
      const bad = Object.entries(g).filter(([, val]) => val === false);
      if (bad.length) { sum.guardFailures++; sum.failures.push({ run: r, guard: bad }); }
    } else if (v.kind !== 'empty') sum.failures.push({ run: r, ...v });
    store.close();
  }
  const steps = sum.stepsReached;
  sum.stepsReached = { min: Math.min(...steps), max: Math.max(...steps), avg: Math.round(steps.reduce((a, b) => a + b, 0) / steps.length) };
  rmSync(dir, { recursive: true, force: true });
  return sum;
}

if (process.argv[2] === '--child') await child(process.argv[3], process.argv[4]);
else console.log(JSON.stringify(await parent(process.argv[2] ?? 'ba', Number(process.argv[3] ?? 100)), null, 2));
