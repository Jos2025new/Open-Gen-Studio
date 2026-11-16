import { uid } from '../lib/id';
import { deleteAssetBlobs, getAssetBlob, putAssetBlob } from '../lib/idb';
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

/** One save or jump at a time per asset, so two clicks cannot drop a version or move the pointer over a write still in flight. */
const revisionTails = new Map<string, Promise<void>>();
function enqueueRevision<T>(assetId: string, task: () => Promise<T>): Promise<T> {
  const prev = revisionTails.get(assetId) ?? Promise.resolve();
  const run = prev.then(task, task);
  revisionTails.set(assetId, run.then(() => undefined, () => undefined));
  return run;
}

async function writeVerifiedBlob(assetId: string, blob: Blob): Promise<boolean> {
  if (blob.size <= 0) return false;
  await putAssetBlob(assetId, blob);
  const stored = await getAssetBlob(assetId);
  return Boolean(stored && (await sameBlobBytes(blob, stored)));
}

function withVersionLabels(list: AssetRevision[]): AssetRevision[] {
  return list.map((r, i) => ({
    ...r,
    label: r.label ?? (i === 0 ? 'Original' : 'Guardado'),
  }));
}

/**
 * Normalizes new `{ revisions, revisionIndex }` and legacy `{ originalRevision, revisions, revertedAt }`
 * into an ordered version list (Original first) plus current-version pointer.
 */
export function normalizeAssetRevisions(asset: Asset | undefined): { versions: AssetRevision[]; index: number } {
  if (!asset) return { versions: [], index: 0 };
  if (asset.revisionIndex != null && asset.revisions?.length) {
    const versions = withVersionLabels(asset.revisions);
    const index = Math.max(0, Math.min(asset.revisionIndex, versions.length - 1));
    return { versions, index };
  }
  if (asset.originalRevision || asset.revisions?.length) {
    const prior = asset.revisions?.length ? asset.revisions : asset.originalRevision ? [asset.originalRevision] : [];
    const labeledPrior = withVersionLabels(prior);
    if (asset.originalRevision) {
      const currentEntry: AssetRevision = {
        assetId: asset.id,
        width: asset.width,
        height: asset.height,
        mime: asset.mime,
        createdAt: asset.createdAt,
        label: 'Guardado',
      };
      const versions = [...labeledPrior, currentEntry];
      return { versions, index: versions.length - 1 };
    }
    return { versions: labeledPrior, index: 0 };
  }
  return {
    versions: [
      {
        assetId: asset.id,
        width: asset.width,
        height: asset.height,
        mime: asset.mime,
        createdAt: asset.createdAt,
        label: 'Original',
      },
    ],
    index: 0,
  };
}

/** Ensures every version in a legacy asset has its own immutable snapshot blob in IDB before mutating `assetId`. */
async function ensureMaterializedRevisions(assetId: string): Promise<{ versions: AssetRevision[]; index: number } | null> {
  const asset = useStore.getState().assets[assetId];
  if (!asset) return null;
  if (asset.revisionIndex != null && asset.revisions?.length) {
    const versions = withVersionLabels(asset.revisions);
    return { versions, index: Math.max(0, Math.min(asset.revisionIndex, versions.length - 1)) };
  }
  const prior = asset.revisions?.length ? asset.revisions : asset.originalRevision ? [asset.originalRevision] : [];
  if (!prior.length) return null;
  const labeledPrior = withVersionLabels(prior);
  if (asset.originalRevision) {
    const curBlob = await getAssetBlob(assetId);
    if (!curBlob || curBlob.size === 0) return null;
    const curRevId = uid('ast');
    if (!(await writeVerifiedBlob(curRevId, curBlob))) return null;
    const versions: AssetRevision[] = [
      ...labeledPrior,
      { assetId: curRevId, width: asset.width, height: asset.height, mime: asset.mime, createdAt: Date.now(), label: 'Guardado' },
    ];
    const index = versions.length - 1;
    useStore.setState((st) => {
      const cur = st.assets[assetId];
      if (!cur) return {};
      return { assets: { ...st.assets, [assetId]: { ...cur, revisions: versions, revisionIndex: index, originalRevision: undefined } } };
    });
    return { versions, index };
  }
  useStore.setState((st) => {
    const cur = st.assets[assetId];
    if (!cur) return {};
    return { assets: { ...st.assets, [assetId]: { ...cur, revisions: labeledPrior, revisionIndex: 0 } } };
  });
  return { versions: labeledPrior, index: 0 };
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
 * Saves an edited library/gallery asset:
 * - `'copy'` («Guardar como copia»): creates a new asset with `copiedFromAssetId: assetId`, leaving the original untouched.
 * - `'original'` («Guardar»): appends a new version at the end of `revisions` (never deleting prior versions, even when
 *   saving from an older version) and moves `revisionIndex` to the new version.
 */
export function saveAssetEdit(
  assetId: string,
  editedBlob: Blob,
  choice: 'copy' | 'original' = 'copy',
  dims?: { width: number; height: number },
  label = 'Pintura',
): Promise<Asset | null> {
  return enqueueRevision(assetId, () => saveAssetEditNow(assetId, editedBlob, choice, dims, label));
}

async function saveAssetEditNow(
  assetId: string,
  editedBlob: Blob,
  choice: 'copy' | 'original',
  dims?: { width: number; height: number },
  label = 'Pintura',
): Promise<Asset | null> {
  const source = useStore.getState().assets[assetId];
  if (!source) return null;
  const width = dims?.width ?? source.width;
  const height = dims?.height ?? source.height;
  const mime = editedBlob.type || source.mime || 'image/png';
  if (choice === 'copy') {
    const copyId = uid('ast');
    if (!(await writeVerifiedBlob(copyId, editedBlob))) {
      await deleteAssetBlobs([copyId]).catch(() => undefined);
      toast('No se pudo guardar la imagen editada', 'error');
      return null;
    }
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
      revisionIndex: undefined,
      revertedAt: undefined,
      stored: true,
      createdAt: Date.now(),
    };
    addAssets([copy]);
    toast('Guardado como copia', 'success');
    return copy;
  }

  let baseVersions: AssetRevision[] = [];
  const hasHistory = Boolean(source.revisions?.length || source.originalRevision);
  try {
    if (!hasHistory) {
      const prevBlob = await getAssetBlob(assetId);
      if (!prevBlob || prevBlob.size === 0) {
        toast('Copia original no disponible; guarda como copia', 'error');
        return null;
      }
      const origRevId = uid('ast');
      if (!(await writeVerifiedBlob(origRevId, prevBlob))) {
        toast('No se pudo guardar una copia verificable del original', 'error');
        return null;
      }
      baseVersions = [
        {
          assetId: origRevId,
          width: source.width,
          height: source.height,
          mime: source.mime,
          createdAt: source.createdAt,
          label: 'Original',
        },
      ];
    } else {
      const mat = await ensureMaterializedRevisions(assetId);
      if (!mat) {
        toast('Copia original no disponible; guarda como copia', 'error');
        return null;
      }
      const origBackup = await getAssetBlob(mat.versions[0].assetId);
      if (!origBackup || origBackup.size === 0) {
        toast('Copia original no disponible; guarda como copia', 'error');
        return null;
      }
      baseVersions = mat.versions;
    }
  } catch {
    toast('No se pudo guardar una copia verificable del original', 'error');
    return null;
  }

  const newRevId = uid('ast');
  const newRev: AssetRevision = {
    assetId: newRevId,
    width,
    height,
    mime,
    createdAt: Date.now(),
    label: label || 'Pintura',
  };
  const previousVisible = await getAssetBlob(assetId);
  try {
    if (!(await writeVerifiedBlob(newRevId, editedBlob))) {
      toast('No se pudo guardar la imagen editada', 'error');
      return null;
    }
    if (!(await writeVerifiedBlob(assetId, editedBlob))) {
      await deleteAssetBlobs([newRevId]).catch(() => undefined);
      if (previousVisible) await writeVerifiedBlob(assetId, previousVisible);
      toast('No se pudo guardar la imagen editada', 'error');
      return null;
    }
  } catch {
    await deleteAssetBlobs([newRevId]).catch(() => undefined);
    if (previousVisible) await writeVerifiedBlob(assetId, previousVisible).catch(() => undefined);
    toast('No se pudo guardar la imagen editada', 'error');
    return null;
  }

  const nextRevisions = [...baseVersions, newRev];
  const nextIndex = nextRevisions.length - 1;
  let updated: Asset | null = null;
  useStore.setState((st) => {
    const cur = st.assets[assetId];
    if (!cur) return {};
    updated = {
      ...cur,
      width,
      height,
      mime,
      revisions: nextRevisions,
      revisionIndex: nextIndex,
      originalRevision: undefined,
      revertedAt: undefined,
      stored: true,
    };
    return { assets: { ...st.assets, [assetId]: updated } };
  });
  if (!updated) {
    if (previousVisible) await writeVerifiedBlob(assetId, previousVisible);
    await deleteAssetBlobs([newRevId]).catch(() => undefined);
    return null;
  }
  toast('Guardado', 'success', 5000, {
    label: 'Deshacer',
    run: () => void undoAssetRevision(assetId),
  });
  return updated;
}

/** Jumps the displayed bytes and metadata of `assetId` to `targetIndex` without deleting any version in history. */
export function jumpToAssetRevision(assetId: string, targetIndex: number): Promise<boolean> {
  return enqueueRevision(assetId, () => jumpToAssetRevisionNow(assetId, targetIndex));
}

async function jumpToAssetRevisionNow(assetId: string, targetIndex: number): Promise<boolean> {
  const asset = useStore.getState().assets[assetId];
  if (!asset) return false;
  const mat = await ensureMaterializedRevisions(assetId);
  if (!mat || mat.versions.length < 2) return false;
  if (targetIndex < 0 || targetIndex >= mat.versions.length) return false;
  if (targetIndex === mat.index) return true;
  const target = mat.versions[targetIndex];
  let previousBlob: Blob | undefined;
  let writeAttempted = false;
  try {
    const targetBlob = await getAssetBlob(target.assetId);
    if (!targetBlob || targetBlob.size === 0) {
      toast('Falta la copia de esa versión; se mantiene la versión actual', 'error');
      return false;
    }
    previousBlob = await getAssetBlob(assetId);
    if (!previousBlob || previousBlob.size === 0) previousBlob = await getAssetBlob(mat.versions[mat.index].assetId);
    writeAttempted = true;
    if (!(await writeVerifiedBlob(assetId, targetBlob))) throw new Error('Verification failed');
  } catch {
    let restored = !writeAttempted;
    if (writeAttempted && previousBlob) {
      try { restored = await writeVerifiedBlob(assetId, previousBlob); } catch { restored = false; }
    }
    toast(restored ? 'No se pudo restaurar la versión; se mantiene la actual' : 'No se pudo recuperar la imagen actual; las versiones guardadas siguen disponibles', 'error');
    return false;
  }
  let updated = false;
  useStore.setState((st) => {
    const cur = st.assets[assetId];
    if (!cur) return {};
    updated = true;
    return {
      assets: {
        ...st.assets,
        [assetId]: {
          ...cur,
          width: target.width,
          height: target.height,
          mime: target.mime,
          revisions: mat.versions,
          revisionIndex: targetIndex,
          originalRevision: undefined,
          revertedAt: targetIndex === 0 ? Date.now() : undefined,
        },
      },
    };
  });
  return updated;
}

/** Moves the version pointer one step back without deleting any version. */
export function undoAssetRevision(assetId: string): Promise<boolean> {
  return enqueueRevision(assetId, async () => {
    const { versions, index } = normalizeAssetRevisions(useStore.getState().assets[assetId]);
    if (versions.length < 2 || index <= 0) return false;
    return jumpToAssetRevisionNow(assetId, index - 1);
  });
}

/** Moves the version pointer one step forward without deleting any version. */
export function redoAssetRevision(assetId: string): Promise<boolean> {
  return enqueueRevision(assetId, async () => {
    const { versions, index } = normalizeAssetRevisions(useStore.getState().assets[assetId]);
    if (versions.length < 2 || index >= versions.length - 1) return false;
    return jumpToAssetRevisionNow(assetId, index + 1);
  });
}

/** Collects asset IDs plus any preserved revision blob IDs when deleting assets. */
export function collectAssetBlobIds(assets: Record<string, Asset>, ids: string[]): string[] {
  const out = new Set(ids);
  for (const id of ids) {
    const a = assets[id];
    if (a?.originalRevision?.assetId) out.add(a.originalRevision.assetId);
    for (const r of a?.revisions ?? []) out.add(r.assetId);
  }
  return [...out];
}

/** Jumps to the first version (Original) while keeping all versions intact so redo still works. */
export async function revertAssetToOriginal(assetId: string): Promise<boolean> {
  const { versions, index } = normalizeAssetRevisions(useStore.getState().assets[assetId]);
  if (versions.length < 2 || index === 0) return false;
  const ok = await jumpToAssetRevision(assetId, 0);
  if (ok) toast('Original restaurado', 'success');
  return ok;
}
