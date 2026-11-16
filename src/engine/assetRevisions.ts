import { uid } from '../lib/id';
import { getAssetBlob, putAssetBlob } from '../lib/idb';
import type { Asset, AssetRevision } from './types';
import { addAssets, setUi, toast, useStore } from '../store/store';

export type { AssetRevision };

async function sameBlobBytes(a: Blob, b: Blob): Promise<boolean> {
  if (a.size !== b.size) return false;
  if (a === b) return true;
  if (typeof a.arrayBuffer !== 'function' || typeof b.arrayBuffer !== 'function') return true;
  const [ba, bb] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
  const va = new Uint8Array(ba);
  const vb = new Uint8Array(bb);
  for (let i = 0; i < va.length; i++) if (va[i] !== vb[i]) return false;
  return true;
}

async function writeVerifiedBlob(assetId: string, blob: Blob): Promise<boolean> {
  if (blob.size <= 0) return false;
  await putAssetBlob(assetId, blob);
  const stored = await getAssetBlob(assetId);
  return Boolean(stored && (await sameBlobBytes(blob, stored)));
}

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
  let prevBlob: Blob | undefined;
  try {
    prevBlob = await getAssetBlob(assetId);
    if (!prevBlob || prevBlob.size === 0) {
      toast('Original image backup unavailable; save as copy instead', 'error');
      return null;
    }
    if (source.originalRevision) {
      const origBackup = await getAssetBlob(source.originalRevision.assetId);
      if (!origBackup || origBackup.size === 0) {
        toast('Original image backup unavailable; save as copy instead', 'error');
        return null;
      }
    }
    if (!(await writeVerifiedBlob(revId, prevBlob))) {
      toast('Could not save a verifiable backup of the original image', 'error');
      return null;
    }
  } catch {
    toast('Could not save a verifiable backup of the original image', 'error');
    return null;
  }
  const revEntry: AssetRevision = {
    assetId: revId,
    width: source.width,
    height: source.height,
    mime: source.mime,
    createdAt: source.createdAt,
  };
  try {
    await putAssetBlob(assetId, editedBlob);
  } catch {
    toast('Could not save the edited image', 'error');
    return null;
  }
  let updated: Asset | null = null;
  useStore.setState((st) => {
    const cur = st.assets[assetId];
    if (!cur) return {};
    updated = {
      ...cur,
      width,
      height,
      mime,
      originalRevision: cur.originalRevision ?? revEntry,
      revisions: [...(cur.revisions ?? []), revEntry],
      revertedAt: undefined,
      stored: true,
    };
    return { assets: { ...st.assets, [assetId]: updated } };
  });
  if (!updated) return null;
  toast('Applied to original', 'success', 5000, {
    label: 'Revertir',
    run: () => void revertAssetToOriginal(assetId),
  });
  return updated;
}

/** Restores an edited asset back to its preserved `originalRevision` without deleting any revision history. */
export async function revertAssetToOriginal(assetId: string): Promise<boolean> {
  const asset = useStore.getState().assets[assetId];
  const orig = asset?.originalRevision;
  if (!asset || !orig) return false;
  try {
    const origBlob = await getAssetBlob(orig.assetId);
    if (!origBlob || origBlob.size === 0) {
      toast('Original backup is missing; keeping current revision', 'error');
      return false;
    }
    if (!(await writeVerifiedBlob(assetId, origBlob))) {
      toast('Could not verify restored original; keeping current revision', 'error');
      return false;
    }
  } catch {
    toast('Could not restore original; keeping current revision', 'error');
    return false;
  }
  let reverted = false;
  useStore.setState((st) => {
    const cur = st.assets[assetId];
    if (!cur?.originalRevision) return {};
    reverted = true;
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
  if (!reverted) return false;
  toast('Original restored', 'success');
  return true;
}
