import { uid } from '../lib/id';
import { getAssetBlob, putAssetBlob } from '../lib/idb';
import type { Asset, AssetRevision } from './types';
import { addAssets, setUi, toast, useStore } from '../store/store';

export type { AssetRevision };

/**
 * Starts editing a library/gallery asset on a working copy so the original asset in `store.assets` and its blob
 * are untouched while editing. Opens Sketch in paint mode on `assetId`.
 */
export function beginAssetEdit(assetId: string): Asset | null {
  const source = useStore.getState().assets[assetId];
  if (!source) return null;
  const workingCopy: Asset = {
    ...structuredClone(source),
    id: uid('ast'),
    origin: 'sketch',
    copiedFromAssetId: assetId,
    createdAt: Date.now(),
  };
  setUi({ sketch: { assetId, mode: 'paint' } });
  return workingCopy;
}

/**
 * Saves an edited library/gallery asset with one light choice:
 * - `'copy'` (default, «Guardar como copia»): creates a new asset with `copiedFromAssetId: assetId`, leaving the original untouched.
 * - `'original'` («Aplicar al original»): preserves the original bytes and metadata in `originalRevision` / `revisions`
 *   so «Revertir» can always recover the original, then updates `assetId` in place.
 */
export async function saveAssetEdit(
  assetId: string,
  editedBlob: Blob,
  choice: 'copy' | 'original' = 'copy',
  dims?: { width: number; height: number },
): Promise<Asset | null> {
  const source = useStore.getState().assets[assetId];
  if (!source) return null;
  const width = dims?.width ?? source.width;
  const height = dims?.height ?? source.height;
  const mime = editedBlob.type || source.mime || 'image/png';
  if (choice === 'copy') {
    const copyId = uid('ast');
    await putAssetBlob(copyId, editedBlob);
    const copy: Asset = {
      ...structuredClone(source),
      id: copyId,
      width,
      height,
      mime,
      origin: source.origin === 'sketch' || source.origin === 'mask' ? 'design' : source.origin,
      copiedFromAssetId: assetId,
      originalRevision: undefined,
      revisions: undefined,
      revertedAt: undefined,
      stored: true,
      createdAt: Date.now(),
    };
    addAssets([copy]);
    toast('Saved as copy', 'success');
    return copy;
  }
  const revId = uid('ast');
  const prevBlob = await getAssetBlob(assetId);
  if (prevBlob) await putAssetBlob(revId, prevBlob);
  const revEntry: AssetRevision = {
    assetId: revId,
    width: source.width,
    height: source.height,
    mime: source.mime,
    createdAt: source.createdAt,
  };
  await putAssetBlob(assetId, editedBlob);
  const updated: Asset = {
    ...source,
    width,
    height,
    mime,
    originalRevision: source.originalRevision ?? revEntry,
    revisions: [...(source.revisions ?? []), revEntry],
    revertedAt: undefined,
    stored: true,
  };
  useStore.setState((st) => ({ assets: { ...st.assets, [assetId]: updated } }));
  toast('Applied to original · Revertir restores the original', 'success');
  return updated;
}

/** Restores an edited asset back to its preserved `originalRevision` without deleting any revision history. */
export async function revertAssetToOriginal(assetId: string): Promise<boolean> {
  const asset = useStore.getState().assets[assetId];
  const orig = asset?.originalRevision;
  if (!asset || !orig) return false;
  const origBlob = await getAssetBlob(orig.assetId);
  if (origBlob) await putAssetBlob(assetId, origBlob);
  useStore.setState((st) => {
    const cur = st.assets[assetId];
    if (!cur?.originalRevision) return {};
    return {
      assets: {
        ...st.assets,
        [assetId]: {
          ...cur,
          width: orig.width,
          height: orig.height,
          mime: orig.mime,
          originalRevision: undefined,
          revertedAt: Date.now(),
        },
      },
    };
  });
  toast('Original restored', 'success');
  return true;
}
