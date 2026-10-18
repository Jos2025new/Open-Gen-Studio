// Format 2 of the local store (ADR 0014): one global record plus one record per session, written file by file.
// Layout under the data folder:
//   store-v2/HEAD.json          manifest: savedAt, version, session order; replaced atomically = the publication point
//   store-v2/globals.json       the state without sessions (settings, spend, assets, library, UI, ...)
//   store-v2/sessions/<id>.json one session each; only changed sessions are written
// state.json (format 1) is never written again once format 2 exists: it is copied to backups/ first and stays readable.
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { looksLost, sha256 } from './save-guard.js';

export const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const SNAPSHOT_EVERY_MS = 10 * 60_000;
const KEPT = 20;
// A session that loses more than half of its user content (bytes and elements) is refused, like a total loss of sessions.

const json = (v) => JSON.stringify(v);

async function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, text, { mode: 0o600 });
  await rename(tmp, file);
}

/** The format-1 text of a state built from its parts (same shape as the app writes). */
export function assembleText({ savedAt, version, globals, order, sessions }) {
  const inner = globals.slice(1, -1);
  const body = order.map((id) => `${json(id)}:${sessions[id]}`).join(',');
  return `{"savedAt":${savedAt},"state":{${inner}${inner ? ',' : ''}"sessions":{${body}}},"version":${version}}`;
}

/** Splits a format-1 state text into parts (legacy PUT and migration). The text must be a whole saved state. */
export function splitText(text) {
  const obj = JSON.parse(text);
  const { savedAt = 0, baseAt, state = {}, version = 1 } = obj;
  const { sessions = {}, ...rest } = state;
  const order = Object.keys(sessions);
  const texts = Object.fromEntries(order.map((id) => [id, json(sessions[id])]));
  return { savedAt, baseAt, version, globals: json(rest), order, sessions: texts };
}

export function createStoreV2(dir) {
  const root = join(dir, 'store-v2');
  const sessionsDir = join(root, 'sessions');
  const headFile = join(root, 'HEAD.json');
  const globalsFile = join(root, 'globals.json');
  const stateFile = join(dir, 'state.json');
  const backups = join(dir, 'backups');
  let lastSnapshot = 0;

  const readHead = () => readFile(headFile, 'utf8').then((t) => JSON.parse(t), () => null);

  /** The whole state as format-1 text, or null when format 2 does not exist yet. */
  async function read() {
    const head = await readHead();
    if (!head) return null;
    const globals = await readFile(globalsFile, 'utf8');
    const sessions = {};
    for (const id of head.order) sessions[id] = await readFile(join(sessionsDir, `${id}.json`), 'utf8');
    return assembleText({ savedAt: head.savedAt, version: head.version, globals, order: head.order, sessions });
  }

  /** Keeps a refused payload aside; returns the file name (the 409 body names it). */
  async function keepRejected(kind, payload) {
    await mkdir(backups, { recursive: true });
    const file = `${kind}-${Date.now()}.json`;
    await writeFile(join(backups, file), payload, { mode: 0o600 });
    return file;
  }

  /** Copies the format-1 file once, before the first format-2 write. Never deletes state.json. */
  async function migrate() {
    if (await readHead()) return;
    if (!(await stat(stateFile).catch(() => null))) return;
    await mkdir(backups, { recursive: true });
    await copyFile(stateFile, join(backups, `format1-${Date.now()}.json`));
  }

  async function snapshot(head) {
    if (Date.now() - lastSnapshot < SNAPSHOT_EVERY_MS) return;
    lastSnapshot = Date.now();
    const to = join(backups, `v2-${Date.now()}`);
    await mkdir(to, { recursive: true });
    await copyFile(headFile, join(to, 'HEAD.json'));
    await copyFile(globalsFile, join(to, 'globals.json'));
    for (const id of head.order) await copyFile(join(sessionsDir, `${id}.json`), join(to, `${id}.json`)).catch(() => undefined);
    const kept = (await readdir(backups)).filter((f) => f.startsWith('v2-')).sort();
    for (const f of kept.slice(0, -KEPT)) await rm(join(backups, f), { recursive: true, force: true });
  }

  /**
   * Commit of changed parts. `body`: { savedAt, baseAt, version, globals (JSON object text), order (ids), sessions:
   * { id: JSON text } for the changed sessions only }. Returns { status, savedAt } (409 carries the current savedAt).
   */
  async function commit(body) {
    const { savedAt, baseAt, version, globals, order, sessions = {}, keep } = body;
    // Every 400 says why (the body), so a refused save is never a silent 400.
    if (!Number.isFinite(savedAt) || !Array.isArray(order)) return { status: 400, reason: 'savedAt and order are required' };
    if (!Number.isInteger(version) || version < 1) return { status: 400, reason: 'version is required (a positive integer)' };
    if (typeof globals !== 'string' || !globals.startsWith('{') || !globals.endsWith('}')) return { status: 400, reason: 'globals must be a JSON text (a string), not an object' };
    if (new Set(order).size !== order.length || !order.every((id) => typeof id === 'string' && SAFE_ID.test(id))) return { status: 400, reason: 'order has a duplicate or unsafe id' };
    for (const [id, text] of Object.entries(sessions)) {
      if (!SAFE_ID.test(id) || typeof text !== 'string' || !text.startsWith('{') || !text.endsWith('}')) return { status: 400, reason: `session ${id} must be a JSON text (a string)` };
      if (!order.includes(id)) return { status: 400, reason: `session ${id} is not in the order` };
    }
    // An id in the order that the commit does not send must already be on disk (it is unchanged), or the state is broken.
    for (const id of order) {
      if (!(id in sessions) && !(await stat(join(sessionsDir, `${id}.json`)).catch(() => null))) return { status: 400, reason: `missing session ${id}: send every session (no format-2 copy of it on disk yet)` };
    }
    const head = await readHead();
    const legacy = head ? null : await readFile(stateFile, 'utf8').catch(() => null);
    const current = head ? head.savedAt : Number(/^\{"savedAt":(\d+)/.exec(legacy ?? '')?.[1] ?? 0);
    if (current && current !== baseAt) return { status: 409, reason: 'conflict', savedAt: current };
    // Total loss: fewer sessions than half of the previous ones (two or more before).
    const had = head ? head.order.length : (legacy ? (legacy.match(/"id":"ses_/g) ?? []).length : 0), has = order.length;
    if (had >= 2 && has < had / 2) return { status: 409, reason: 'possible-loss', rejectedFile: await keepRejected('rejected', json(body)), savedAt: current };
    // Per session: a session that loses most of its user content (not its agent cache) is refused. "Keep this version"
    // lifts it for one session only, when the disk and the candidate are exactly the texts the user saw (hashes).
    const kept = [];
    for (const [id, text] of Object.entries(sessions)) {
      const file = join(sessionsDir, `${id}.json`);
      const prev = await readFile(file, 'utf8').catch(() => null);
      if (prev == null || !looksLost(prev, text)) continue;
      if (keep?.sessionId === id && keep.diskHash === sha256(prev) && keep.candidateHash === sha256(text)) { kept.push([id, prev]); continue; }
      return { status: 409, reason: 'possible-loss', sessionId: id, rejectedFile: await keepRejected(`rejected-session-${id}`, text), savedAt: current };
    }
    for (const [id, prev] of kept) await keepRejected(`kept-before-${id}`, prev);
    await migrate();
    await mkdir(sessionsDir, { recursive: true });
    for (const [id, text] of Object.entries(sessions)) await writeAtomic(join(sessionsDir, `${id}.json`), text);
    await writeAtomic(globalsFile, globals);
    const next = { format: 2, savedAt, version, order };
    await writeAtomic(headFile, json(next));
    // Sessions no longer referenced move to backups: nothing is deleted.
    const known = new Set(order);
    for (const f of await readdir(sessionsDir).catch(() => [])) {
      const id = f.replace(/\.json$/, '');
      if (f.endsWith('.json') && !known.has(id)) {
        await mkdir(join(backups, 'removed-sessions'), { recursive: true });
        await rename(join(sessionsDir, f), join(backups, 'removed-sessions', `${Date.now()}-${f}`));
      }
    }
    await snapshot(next);
    return { status: 204, savedAt };
  }

  /** Legacy full-state PUT: converted to a commit (the server compares the sessions itself). */
  async function commitLegacy(text) {
    if (!text.startsWith('{"savedAt":')) return { status: 400 };
    const parts = splitText(text);
    const head = await readHead();
    return commit({ savedAt: parts.savedAt, baseAt: parts.baseAt, version: parts.version, globals: parts.globals, order: parts.order, sessions: head ? await changedOnly(parts.sessions, head) : parts.sessions });
  }

  async function changedOnly(texts, head) {
    const out = {};
    for (const id of Object.keys(texts)) {
      const same = head.order.includes(id) && (await readFile(join(sessionsDir, `${id}.json`), 'utf8').catch(() => null)) === texts[id];
      if (!same) out[id] = texts[id];
    }
    return out;
  }

  return { read, commit, commitLegacy, readHead, headFile };
}

/** Writes the format-1 state back to state.json (reversal). Keeps the current state.json in backups first. */
export async function exportToFormat1(dir) {
  const v2 = createStoreV2(dir);
  const text = await v2.read();
  if (text == null) return { exported: false };
  await mkdir(join(dir, 'backups'), { recursive: true });
  const stateFile = join(dir, 'state.json');
  if (await stat(stateFile).catch(() => null)) await copyFile(stateFile, join(dir, 'backups', `before-export-${Date.now()}.json`));
  await writeAtomic(stateFile, text);
  return { exported: true };
}
