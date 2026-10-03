/*
 * Disk copy of saved state and media, kept by the local dev/preview server (`/x/store`, see server/local-store.js).
 * The app has no backend: when it is served without that server the copy is simply off and IndexedDB is the only store.
 */

let available: Promise<boolean> | null = null;

/** True when the local store answers. A static host's SPA fallback returns HTML, not "ok", so it counts as absent. */
/**
 * Sent with every write to the local server. A page on another site cannot add it without the browser asking the
 * server first, and the dev server refuses that for other origins: a write from elsewhere never reaches the disk.
 */
export const LOCAL_WRITE = { 'X-OGS': '1' } as const;

export function diskAvailable(): Promise<boolean> {
  available ??= fetch('/x/store/ping', { cache: 'no-store' })
    .then(async (r) => r.ok && (await r.text()) === 'ok')
    .catch(() => false);
  return available;
}

const report = (what: string) => (err: unknown) => console.warn(`Disk copy: could not ${what}`, err);

// State writes are serialized and coalesced: only the newest pending value is sent, never out of order.
let stateChain: Promise<void> = Promise.resolve();
let latestState: string | null = null;
// The disk state this tab works from (its savedAt): each write says so, and the server refuses it when another tab
// saved in between, instead of letting an older copy overwrite newer work.
let baseAt = 0;
let stale = false;
let onStale: (() => void) | null = null;
const savedAtOf = (v: string | null) => Number(/^\{"savedAt":(\d+)/.exec(v ?? '')?.[1] ?? 0);
/** `{"savedAt":N,…}` → `{"savedAt":N,"baseAt":B,…}` (any baseAt already there is replaced). */
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
  async putState(value: string, base: number): Promise<'ok' | 'conflict' | 'fail'> {
    if (!(await diskAvailable())) return 'fail';
    const body = withBase(value, base);
    const res = await fetch('/x/store/state', { method: 'PUT', body, headers: { 'Content-Type': 'application/json', ...LOCAL_WRITE } }).catch(() => null);
    if (res?.status === 409) return 'conflict';
    if (!res?.ok) return 'fail';
    baseAt = savedAtOf(body);
    return 'ok';
  },

  /** True once another tab saved newer work: this tab stops saving (see onStateConflict). */
  isStale: () => stale,

  /** Called once when the disk refuses this tab's state because another tab saved after it loaded. */
  onStateConflict(cb: () => void): void {
    onStale = cb;
  },

  setState(value: string): void {
    if (stale) return;
    latestState = value;
    stateChain = stateChain.then(async () => {
      if (stale || latestState == null || !(await diskAvailable())) return;
      const body = savedAtOf(latestState) ? withBase(latestState, baseAt) : latestState;
      latestState = null;
      // keepalive lets the last save survive a closing tab (browsers cap it at 64 KB).
      const res = await fetch('/x/store/state', { method: 'PUT', body, keepalive: body.length < 60_000, headers: { 'Content-Type': 'application/json', ...LOCAL_WRITE } }).catch(report('save state'));
      if (res?.status === 409) {
        stale = true;
        onStale?.();
      } else if (res?.ok) baseAt = savedAtOf(body);
    });
  },

  async getBlob(key: string): Promise<Blob | undefined> {
    if (!(await diskAvailable())) return undefined;
    const res = await fetch(`/x/store/blob/${encodeURIComponent(key)}`, { cache: 'no-store' }).catch(() => null);
    return res?.ok ? res.blob() : undefined;
  },

  /** Resolves when written (callers that do not need to wait use `void`). */
  async setBlob(key: string, blob: Blob): Promise<void> {
    if (!(await diskAvailable())) return;
    await fetch(`/x/store/blob/${encodeURIComponent(key)}`, { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type || 'application/octet-stream', ...LOCAL_WRITE } })
      .then(() => undefined)
      .catch(report(`save ${key}`));
  },

  delBlobs(keys: string[]): void {
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
    if (await diskAvailable()) await fetch('/x/store/wipe', { method: 'POST', headers: LOCAL_WRITE }).catch(report('wipe'));
  },
};
