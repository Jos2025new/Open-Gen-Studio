// ---------------------------------------------------------------------------
// Asset URL cache: object URLs for blobs we hold locally.

const urlCache = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

export function replaceAssetUrl(assetId: string, blob: Blob): string {
  const old = urlCache.get(assetId);
  if (old) URL.revokeObjectURL(old);
  const url = URL.createObjectURL(blob);
  urlCache.set(assetId, url);
  return url;
}

export function peekAssetUrl(assetId: string): string | undefined {
  return urlCache.get(assetId);
}

export function loadAssetUrl(assetId: string, readBlob: () => Promise<Blob | undefined>): Promise<string | null> {
  const hit = urlCache.get(assetId);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(assetId);
  if (inflight) return inflight;
  const p = readBlob()
    .then((blob) => {
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      urlCache.set(assetId, url);
      return url;
    })
    .catch(() => null)
    .finally(() => pending.delete(assetId));
  pending.set(assetId, p);
  return p;
}

export function forgetAssetUrl(assetId: string): void {
  const url = urlCache.get(assetId);
  if (url) URL.revokeObjectURL(url);
  urlCache.delete(assetId);
}
