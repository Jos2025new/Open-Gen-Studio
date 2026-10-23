import type { DesignDoc } from '../../engine/types';
import { toast, useStore } from '../../store/store';
import { clearSelected, getSelection, selectedCrop } from '../../engine/design/pixelSelection';
import { activeLayer } from '../../engine/design/doc';
import { uploadFiles } from '../../engine/actions';
import { getDoc, openAssetInDesigner, placeAsset } from '../../engine/design/actions';
import { cloneCanvas, getBuffer } from '../../engine/design/raster';
import { canvasToBlob } from '../../lib/media';

/**
 * Paste, copy and cut of images for a design, on the document. The full Designer registers it always; Studio's embedded
 * one passes `allowed` (focus inside the board), so the chat composer's clipboard is never taken. Returns the cleanup.
 */
export function designerClipboard(sessionId: string, doc: DesignDoc | undefined, allowed: () => boolean = () => true): () => void {
  const inField = (e: Event) => e.target instanceof Element && !!e.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
  const paste = (e: ClipboardEvent) => {
    if (e.defaultPrevented || !allowed() || inField(e)) return;
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    const targetDocId = doc?.id;
    void (async () => {
      const ids = await uploadFiles(files);
      if (useStore.getState().activeSessionId !== sessionId) return;
      if (!targetDocId) {
        if (!ids.length) return;
        await openAssetInDesigner(sessionId, ids[0]);
        const newDocId = useStore.getState().sessions[sessionId]?.activeDocId;
        if (newDocId) for (const id of ids.slice(1)) await placeAsset(sessionId, newDocId, id, 'new');
      } else if (getDoc(sessionId, targetDocId)) {
        for (const id of ids) await placeAsset(sessionId, targetDocId, id, 'new');
      }
    })().catch((err) => toast(err instanceof Error ? err.message : 'Could not paste image.', 'error'));
  };
  /** Writes the image; `then` runs only once the clipboard has confirmed it (a cut erases then, never before). */
  const toClipboard = (canvas: HTMLCanvasElement, done: string, then?: () => void) => {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') { toast('This browser cannot copy images to the clipboard.', 'error'); return false; }
    void navigator.clipboard.write([new ClipboardItem({ 'image/png': canvasToBlob(canvas, 'image/png') })])
      .then(() => { toast(done, 'success'); then?.(); })
      .catch(() => toast('Could not copy image to the clipboard.', 'error'));
    return true;
  };
  const copy = (e: ClipboardEvent) => {
    if (e.defaultPrevented || !allowed() || inField(e) || window.getSelection()?.toString() || !doc) return;
    // With a pixel selection: only the selected pixels of the active layer (Ctrl+X also erases them).
    if (getSelection(doc.id)) {
      e.preventDefault();
      const crop = selectedCrop(doc);
      if (typeof crop === 'string') { toast(crop, 'error'); return; }
      toClipboard(crop, e.type === 'cut' ? 'Selection cut' : 'Selection copied', e.type === 'cut' ? () => {
        const err = clearSelected(sessionId, doc);
        if (err) toast(err, 'error');
      } : undefined);
      return;
    }
    if (e.type === 'cut') return;
    const layer = activeLayer(doc);
    if (layer?.type !== 'raster') return;
    const buffer = getBuffer(layer.id);
    if (!buffer) { toast('Image pixels are still loading.', 'error'); return; }
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') { toast('This browser cannot copy images to the clipboard.', 'error'); return; }
    e.preventDefault();
    const png = canvasToBlob(cloneCanvas(buffer), 'image/png');
    void navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
      .then(() => toast('Image copied', 'success'))
      .catch(() => toast('Could not copy image to the clipboard.', 'error'));
  };
  document.addEventListener('paste', paste);
  document.addEventListener('copy', copy);
  document.addEventListener('cut', copy);
  return () => { document.removeEventListener('paste', paste); document.removeEventListener('copy', copy); document.removeEventListener('cut', copy); };
}
