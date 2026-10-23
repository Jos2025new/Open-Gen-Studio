import { toast, saveNow, setUi, useStore } from '../../store/store';
import type { DesignDoc } from '../../engine/types';
import type { DesignTool } from '../../engine/design/rules';
import { deletePickedObjects, layerObjects } from '../../engine/design/objectOps';
import { objectPick, setObjectPick, useShapeEdit } from '../../engine/design/objectSelection';
import { nudgeObjects } from '../../engine/design/nudge';
import { groupLayers } from '../../engine/design/groups';
import { layerSelection } from '../../engine/design/selection';
import { clearSelected, getSelection, invertSelection, selectAll, selectionToLayer, setSelection } from '../../engine/design/pixelSelection';
import { deletePickedNode } from './PathNodes';
import { deleteLayers, mergeDown, redoDoc, undoDoc } from '../../engine/design/actions';
import { activeLayer } from '../../engine/design/doc';
import { record } from '../../engine/design/history';
import { toolBlockReason } from '../../engine/design/rules';
import { DESIGN_TOOL_KEYS } from '../../engine/shortcuts';

const ARROW_STEP: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** Objects picked on the canvas in a layer that still has them. */
function pickedHere(doc: DesignDoc): boolean {
  const pk = objectPick(doc.id);
  const l = pk && doc.layers.find((x) => x.id === pk.layerId);
  return Boolean(pk && l && pk.ids.length && layerObjects(l).some((o) => pk.ids.includes(o.id)));
}

/**
 * The Designer's keyboard shortcuts (undo, delete, nudge, tool keys…). The full workspace listens on the window;
 * Studio's embedded Designer calls it only while focus is inside the board and passes `tools`: the tool keys it
 * may switch to (and no ruler toggle), so a key never opens a tool its board does not show.
 */
export function designerKey(e: KeyboardEvent, sessionId: string, doc: DesignDoc | undefined, tools?: ReadonlySet<DesignTool>): void {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); void saveNow().catch(() => undefined); return; }
  if (!doc || (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]')) || document.querySelector('.popover:not(.designer-context), .lightbox')) return;
  const layer = activeLayer(doc);
  const k = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;
  if (mod && (k === 'z' || k === 'y')) {
    // Ctrl+Z undo; Ctrl+Shift+Z and Ctrl+Y redo.
    e.preventDefault();
    (e.shiftKey || k === 'y' ? redoDoc : undoDoc)(sessionId, doc.id);
  } else if (!tools && !mod && !e.altKey && e.shiftKey && k === 'r') {
    e.preventDefault();
    setUi({ rulers: !useStore.getState().ui.rulers });
  } else if (mod && k === 'g') {
    // Ctrl+G: the selected layers into a folder.
    e.preventDefault();
    const ids = layerSelection(doc.id, doc.activeLayerId, doc.layers.map((l) => l.id));
    if (ids.length < 2) toast('Select two or more layers (Ctrl or Shift-click) to group them.', 'info');
    else groupLayers(sessionId, doc.id, ids);
  } else if (mod && k === 'e' && !e.shiftKey && doc.activeLayerId) {
    // Ctrl+E: merge the active layer down, as in Photoshop, Krita and SAI.
    e.preventDefault();
    void mergeDown(sessionId, doc.id, doc.activeLayerId);
  } else if (mod && (k === 'a' || k === 'd' || k === 'j' || (k === 'i' && e.shiftKey))) {
    // Pixel selection: all, deselect, to a new layer, invert.
    e.preventDefault();
    if (k !== 'j') record(doc);
    if (k === 'a') selectAll(doc);
    else if (k === 'd') setSelection(doc.id, null);
    else if (k === 'i') invertSelection(doc);
    else { const err = selectionToLayer(sessionId, doc); if (err) toast(err, 'error'); }
  } else if (!e.altKey && !e.shiftKey && (e.key === 'Delete' || e.key === 'Backspace') && deletePickedNode(sessionId, doc.id, mod ? 'line' : 'auto')) {
    // Editing a path with a node picked: Delete removes that node keeping the shape, Ctrl+Delete joins its
    // neighbours straight (Inkscape); never the layer (PathNodes.tsx).
    e.preventDefault();
  } else if (!e.altKey && ((!mod && (e.key === 'Delete' || e.key === 'Backspace')) || (mod && k === 'x')) && getSelection(doc.id)) {
    // With a selection, Delete (or Ctrl+X, handled by cut) erases its pixels instead of deleting the layer.
    if (mod) return;
    e.preventDefault();
    const err = clearSelected(sessionId, doc);
    if (err) toast(err, 'error');
  } else if (!e.altKey && ((!mod && (e.key === 'Delete' || e.key === 'Backspace')) || (mod && k === 'x')) && pickedHere(doc)) {
    // Objects picked on the canvas (strokes, shapes): Delete, Backspace or Ctrl+X remove just them, not the layer.
    e.preventDefault();
    const pk = objectPick(doc.id)!;
    deletePickedObjects(sessionId, doc.id, pk.layerId, pk.ids);
    setObjectPick(doc.id, null);
  } else if (!mod && !e.altKey && ARROW_STEP[e.key] && !useShapeEdit.getState().byDoc[doc.id] && layer) {
    // Arrow keys move the picked objects (strokes, shapes; 1 px, Shift 10 px). Nothing picked: they pan the view.
    // Path-node editing keeps its own arrows (PathNodes.tsx).
    e.preventDefault();
    const [ux, uy] = ARROW_STEP[e.key];
    const k = e.shiftKey ? 10 : 1;
    const pk = objectPick(doc.id);
    if (pk && pickedHere(doc)) { if (!nudgeObjects(sessionId, doc.id, pk.layerId, pk.ids, ux * k, uy * k)) toast(`"${layer.name}" is locked. Unlock it to move it.`, 'info'); }
    else window.dispatchEvent(new CustomEvent('ogs:pan', { detail: { ux, uy, shift: e.shiftKey } }));
  } else if (!mod && !e.altKey && (e.key === 'Delete' || e.key === 'Backspace') && layer) {
    // Delete or Backspace: every picked layer at once (one undo step); locked ones stay.
    e.preventDefault();
    const ids = layerSelection(doc.id, doc.activeLayerId, doc.layers.map((l) => l.id));
    const kept = deleteLayers(sessionId, doc.id, ids);
    if (kept) toast(kept === ids.length ? `"${layer.name}" is locked. Unlock it to delete it.` : `${kept} locked layer${kept === 1 ? '' : 's'} kept.`, 'info');
  } else if (!mod && !e.altKey && !e.shiftKey && DESIGN_TOOL_KEYS[e.key.toLowerCase()]) {
    const tool = DESIGN_TOOL_KEYS[e.key.toLowerCase()];
    if ((!tools || tools.has(tool)) && !toolBlockReason(tool, layer)) { e.preventDefault(); setUi({ tool }); }
  }
}
