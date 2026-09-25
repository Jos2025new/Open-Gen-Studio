/*
 * Disk copy of saved state and media, kept by the local dev/preview server (`/x/store`, see server/local-store.js).
 * The app has no backend: when it is served without that server the copy is simply off and IndexedDB is the only store.
 */

let available: Promise<boolean> | null = null;

/** True when the local store answers. A static host's SPA fallback returns HTML, not "ok", so it counts as absent. */
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

export const disk = {
  async getState(): Promise<string | null> {
    if (!(await diskAvailable())) return null;
    const res = await fetch('/x/store/state', { cache: 'no-store' }).catch(() => null);
    const text = res?.ok ? await res.text() : '';
    return text || null;
  },

  setState(value: string): void {
    latestState = value;
    stateChain = stateChain.then(async () => {
      if (latestState == null || !(await diskAvailable())) return;
      const body = latestState;
      latestState = null;
      // keepalive lets the last save survive a closing tab (browsers cap it at 64 KB).
      await fetch('/x/store/state', { method: 'PUT', body, keepalive: body.length < 60_000, headers: { 'Content-Type': 'application/json' } }).catch(report('save state'));
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
    await fetch(`/x/store/blob/${encodeURIComponent(key)}`, { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type || 'application/octet-stream' } })
      .then(() => undefined)
      .catch(report(`save ${key}`));
  },

  delBlobs(keys: string[]): void {
    void diskAvailable().then((ok) => {
      if (ok) for (const k of keys) fetch(`/x/store/blob/${encodeURIComponent(k)}`, { method: 'DELETE' }).catch(report(`delete ${k}`));
    });
  },

  async listBlobs(): Promise<string[]> {
    if (!(await diskAvailable())) return [];
    const res = await fetch('/x/store/blobs', { cache: 'no-store' }).catch(() => null);
    return res?.ok ? ((await res.json()) as string[]) : [];
  },

  /** Move the disk copy aside (data.bak-<date>) so a wipe does not come back on reload. */
  async wipe(): Promise<void> {
    if (await diskAvailable()) await fetch('/x/store/wipe', { method: 'POST' }).catch(report('wipe'));
  },
};
