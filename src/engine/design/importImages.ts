import { getDoc, placeAsset } from './actions';

/** Place uploaded images in order, keeping the first image as the base of an empty document. */
export async function placeImportedImages(sessionId: string, docId: string, assetIds: string[]): Promise<void> {
  for (const id of assetIds) {
    const doc = getDoc(sessionId, docId);
    if (!doc) return;
    await placeAsset(sessionId, docId, id, doc.layers.length ? 'new' : 'base');
  }
}
