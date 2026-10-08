import { useStore, toast } from '../store/store';
import { getAssetBlob } from '../lib/idb';
import { downloadBlob, extensionForMime, fetchBlob } from '../lib/media';

/** Saves an asset as a file: its stored blob, else its remote copy (moved from actions.ts, ADR 0008). */
export async function downloadAsset(assetId: string): Promise<void> {
  const a = useStore.getState().assets[assetId];
  if (!a) return;
  try {
    let blob = await getAssetBlob(assetId);
    if (!blob && a.remoteUrl) blob = await fetchBlob(a.remoteUrl);
    if (!blob) throw new Error('File not available');
    downloadBlob(blob, `${a.name || `ogs-${assetId.slice(-8)}`}.${extensionForMime(blob.type || a.mime)}`);
  } catch (err) {
    toast((err as Error).message, 'error');
  }
}
