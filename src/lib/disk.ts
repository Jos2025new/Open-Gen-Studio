/*
 * Disk copy of saved state and media, kept by the local dev/preview server (`/x/store`, see server/local-store.js).
 * The app has no backend: when it is served without that server the copy is simply off and IndexedDB is the only store.
 */

import { holdsWriterLock } from './writerLock';

// Every function here that writes (PUT, DELETE, POST) first asks holdsWriterLock(): only the active tab changes the disk.
let available: Promise<boolean> | null = null;
let unavailable = false;
/** 'conflict': another tab saved first (this tab goes stale). 'rejected': the server kept a shrinking save aside (possible-loss); not stale. */
export type DiskWriteResult = 'ok' | 'conflict' | 'rejected' | 'fail' | 'browser-only';
/** The body of a possible-loss 409 (see server/local-store.js `conflictBody`). */
export interface Rejection { sessionId?: string; rejectedFile?: string; diskHash?: string; savedAt?: number }
/** "Keep this version" (ADR 0014 save guard): lifts the possible-loss rule for one session, bound to the exact texts by hash. */
export interface KeepVersion { sessionId: string; diskHash: string; candidateHash: string }

/** True when the local store answers. A static host's SPA fallback returns HTML, not "ok", so it counts as absent. */
/**
 * Sent with every write to the local server. A page on another site cannot add it without the browser asking the
 * server first, and the dev server refuses that for other origins: a write from elsewhere never reaches the disk.
 */
export const LOCAL_WRITE = {
  'X-OGS': '1',
  // Evaluate at each write, including saves queued before webdriver was detected.
  get 'X-OGS-Automated'() {
    return typeof navigator !== 'undefined' && navigator.webdriver === true ? '1' : '0';
  },
} as const;

export function diskAvailable(): Promise<boolean> {
  available ??= fetch('/x/store/ping', { cache: 'no-store' })
    .then(async (r) => { unavailable = !r.ok && r.status !== 404; return r.ok && (await r.text()) === 'ok'; })
    .catch(() => { unavailable = true; return false; })
    .then((ok) => { if (unavailable) available = null; return ok; });
  return available;
}

const report = (what: string) => (err: unknown) => console.warn(`Disk copy: could not ${what}`, err);

// State writes are serialized and coalesced: only the newest pending value is sent, never out of order.
let stateChain: Promise<void> = Promise.resolve();
let commitChain: Promise<void> = Promise.resolve();
let latestState: string | StateBody | null = null;
let receipts: Array<(result: DiskWriteResult) => void> = [];
// The disk state this tab works from (its savedAt): each write says so, and the server refuses it when another tab
// saved in between, instead of letting an older copy overwrite newer work.
let baseAt = 0;
let stale = false;
let onStale: (() => void) | null = null;
let lastRejection: Rejection | null = null;
/** Why a 409 was sent: 'rejected' for a possible-loss (kept in `lastRejection`), else 'conflict' (also a 409 with no reason). */
async function refusal(res: Response): Promise<'conflict' | 'rejected'> {
  const body = await (async () => JSON.parse(await res.text()) as Rejection & { reason?: string })().catch(() => null);
  if (body?.reason !== 'possible-loss') return 'conflict';
  lastRejection = { sessionId: body.sessionId, rejectedFile: body.rejectedFile, diskHash: body.diskHash, savedAt: body.savedAt };
  return 'rejected';
}
/** Bytes on the wire: the browser's keepalive limit (64 KiB) counts bytes, not string length. */
const byteLength = (text: string): number => new TextEncoder().encode(text).length;
const savedAtOf = (v: string | null) => Number(/^\{"savedAt":(\d+)/.exec(v ?? '')?.[1] ?? 0);
/** `{"savedAt":N,…}` → `{"savedAt":N,"baseAt":B,…}` (any baseAt already there is replaced). */
/** A stamped state sent as a Blob: `open` replaces its opening `{` (see persistJson.ts). */
export interface StateBody { savedAt: number; blob(open: string): Blob }
const withBase = (v: string, base: number) => v.replace(/^\{"savedAt":(\d+),("baseAt":\d+,)?/, `{"savedAt":$1,"baseAt":${base},`);

export const disk = {
  async getState(): Promise<string | null> {
    if (!(await diskAvailable())) return null;
    const res = await fetch('/x/store/state', { cache: 'no-store' }).catch(() => null);
    const text = res?.ok ? await res.text() : '';
    baseAt = savedAtOf(text);
    return text || null;
  },

  /**
   * One write that says it was built on the disk state `base`; 'conflict' when the disk holds another one.
   * Used at load time for a browser copy newer than the disk's.
   */
  async putState(value: string, base: number): Promise<'ok' | 'conflict' | 'rejected' | 'fail'> {
    if (!holdsWriterLock() || !(await diskAvailable())) return 'fail';
    const body = withBase(value, base);
    const res = await fetch('/x/store/state', { method: 'PUT', body, headers: { 'Content-Type': 'application/json', ...LOCAL_WRITE } }).catch(() => null);
    if (res?.status === 409) return refusal(res);
    if (!res?.ok) return 'fail';
    baseAt = savedAtOf(body);
    return 'ok';
  },

  /** True once another tab saved newer work: this tab stops sending to the disk (it keeps saving in the browser). */
  isStale: () => stale,

  /** The details of the last possible-loss refusal (result 'rejected'). */
  rejection: (): Rejection | null => lastRejection,

  /** Called once when the disk refuses this tab's state because another tab saved after it loaded. */
  onStateConflict(cb: () => void): void {
    onStale = cb;
  },

  /**
   * Format-2 commit (ADR 0014): the global record, the session order and only the sessions that changed. The server
   * writes those files and publishes the new manifest; a stale baseAt is refused (409) like a whole-state write.
   */
  setCommit(c: { savedAt: number; version: number; globals: string; order: string[]; changed: Array<[string, string]>; all?: Array<[string, string]>; keep?: KeepVersion }): Promise<DiskWriteResult> {
    if (!holdsWriterLock()) return Promise.resolve('browser-only');
    if (stale) return Promise.resolve('conflict');
    // The body carries JSON TEXT as strings: globals and each session are strings the server stores as they are.
    const send = async (list: Array<[string, string]>): Promise<Response> => {
      const sessions = list.map(([id, text]) => `${JSON.stringify(id)}:${JSON.stringify(text)}`).join(',');
      const body = `{"savedAt":${c.savedAt},"baseAt":${baseAt},"version":${c.version},"globals":${JSON.stringify(c.globals)},"order":${JSON.stringify(c.order)},"sessions":{${sessions}}${c.keep ? `,"keep":${JSON.stringify(c.keep)}` : ''}}`;
      return fetch('/x/store/v2/commit', { method: 'PUT', body, keepalive: byteLength(body) < 60_000, headers: { 'Content-Type': 'application/json', ...LOCAL_WRITE } });
    };
    const receipt = new Promise<DiskWriteResult>((resolve) => { commitChain = commitChain.then(async () => {
      let result: DiskWriteResult = 'fail';
      try {
        if (stale) result = 'conflict';
        else if (!(await diskAvailable())) result = unavailable ? 'fail' : 'browser-only';
        else {
          let res = await send(c.changed);
          // The disk has no copy of an unchanged session yet (the state is still format 1): one retry with every session.
          if (res.status === 400 && c.all && (await res.clone().text()).startsWith('missing session')) res = await send(c.all);
          if (res.status === 409) {
            result = await refusal(res);
            if (result === 'conflict') { stale = true; onStale?.(); }
          } else if (res.ok) { baseAt = c.savedAt; result = 'ok'; }
        }
      } catch (err) { report('save state')(err); }
      resolve(result);
    }); });
    return receipt;
  },

  setState(value: string | StateBody): Promise<DiskWriteResult> {
    if (!holdsWriterLock()) return Promise.resolve('browser-only');
    if (stale) return Promise.resolve('conflict');
    latestState = value;
    const receipt = new Promise<DiskWriteResult>((resolve) => receipts.push(resolve));
    stateChain = stateChain.then(async () => {
      if (latestState == null) return;
      const next = latestState, waiters = receipts;
      latestState = null;
      receipts = [];
      let result: DiskWriteResult = 'fail';
      try {
        if (stale) result = 'conflict';
        else if (!(await diskAvailable())) result = unavailable ? 'fail' : 'browser-only';
        else {
          const [body, at] = typeof next === 'string'
            ? [savedAtOf(next) ? withBase(next, baseAt) : next, savedAtOf(next)]
            : [next.blob(`{"savedAt":${next.savedAt},"baseAt":${baseAt},`), next.savedAt];
          const size = typeof body === 'string' ? byteLength(body) : body.size;
          const res = await fetch('/x/store/state', { method: 'PUT', body, keepalive: size < 60_000, headers: { 'Content-Type': 'application/json', ...LOCAL_WRITE } });
          if (res.status === 409) {
            result = await refusal(res);
            if (result === 'conflict') { stale = true; onStale?.(); }
          } else if (res.ok) { baseAt = at; result = 'ok'; }
        }
      } catch (err) { report('save state')(err); }
      waiters.forEach((resolve) => resolve(result));
    });
    return receipt;
  },

  async getBlob(key: string): Promise<Blob | undefined> {
    if (!(await diskAvailable())) return undefined;
    const res = await fetch(`/x/store/blob/${encodeURIComponent(key)}`, { cache: 'no-store' }).catch(() => null);
    return res?.ok ? res.blob() : undefined;
  },

  /** Resolves when written (callers that do not need to wait use `void`). */
  async setBlob(key: string, blob: Blob): Promise<DiskWriteResult> {
    if (!holdsWriterLock()) return 'browser-only';
    if (stale) return 'conflict';
    if (!(await diskAvailable())) return unavailable ? 'fail' : 'browser-only';
    try {
      const res = await fetch(`/x/store/blob/${encodeURIComponent(key)}`, { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type || 'application/octet-stream', ...LOCAL_WRITE } });
      if (res.status === 409) { stale = true; onStale?.(); return 'conflict'; }
      return res.ok ? 'ok' : 'fail';
    } catch (err) { report(`save ${key}`)(err); return 'fail'; }
  },

  delBlobs(keys: string[]): void {
    if (!holdsWriterLock()) return;
    void diskAvailable().then((ok) => {
      if (ok) for (const k of keys) fetch(`/x/store/blob/${encodeURIComponent(k)}`, { method: 'DELETE', headers: LOCAL_WRITE }).catch(report(`delete ${k}`));
    });
  },

  async listBlobs(): Promise<string[]> {
    if (!(await diskAvailable())) return [];
    const res = await fetch('/x/store/blobs', { cache: 'no-store' }).catch(() => null);
    return res?.ok ? ((await res.json()) as string[]) : [];
  },

  /** Move the disk copy aside (data.bak-<date>) so a wipe does not come back on reload. */
  async wipe(): Promise<void> {
    if (holdsWriterLock() && (await diskAvailable())) await fetch('/x/store/wipe', { method: 'POST', headers: LOCAL_WRITE }).catch(report('wipe'));
  },
};
