import { uid } from '../../lib/id';
import { putAssetBlob } from '../../lib/idb';
import { addAssets, useStore } from '../../store/store';
import { placeFor } from '../place';
import type { Asset } from '../types';

export async function storeDesignAsset(sessionId: string, blob: Blob, width: number, height: number, origin: Asset['origin']): Promise<Asset> {
  const id = uid('ast');
  await putAssetBlob(id, blob);
  const ui = useStore.getState().ui;
  const asset: Asset = { id, kind: 'image', mime: blob.type || 'image/png', width, height, sessionId, origin, place: ui.space ? placeFor(ui, ui.workspace) : 'designer', mode: 'image', stored: true, favorite: false, createdAt: Date.now() };
  addAssets([asset]);
  return asset;
}

/** Save a canvas as a new image asset (PNG). */
export async function canvasToAsset(sessionId: string, canvas: HTMLCanvasElement, origin: Asset['origin'] = 'design'): Promise<Asset> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Export failed'))), 'image/png'));
  return storeDesignAsset(sessionId, blob, canvas.width, canvas.height, origin);
}
