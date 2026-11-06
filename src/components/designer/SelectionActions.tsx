import type { DesignDoc } from '../../engine/types';
import { getDoc } from '../../engine/design/actions';
import { record } from '../../engine/design/history';
import { clearSelected, fillSelection, getSelection, growSelection, selectionToLayer, setSelection, useSelectionVersion } from '../../engine/design/pixelSelection';
import { toast, useStore } from '../../store/store';

const GROW_STEP = 2;

/** What can be done with a selection that exists: it edits or uses what is selected, unlike the tool's settings for the next pick. */
export function SelectionActions({ sessionId, doc }: { sessionId: string; doc: DesignDoc }) {
  const brush = useStore((s) => s.ui.brush);
  const cur = () => getDoc(sessionId, doc.id)!;
  const run = (fn: () => string | null) => { const err = fn(); if (err) toast(err, 'error'); };
  return <>
    <button type="button" className="opt" onClick={() => { record(cur()); setSelection(doc.id, null); }} data-tip="Removes the selection · Ctrl+D">Deselect</button>
    <button type="button" className="opt" onClick={() => { record(cur()); growSelection(cur(), -GROW_STEP); }} data-tip={`Shrinks the selection ${GROW_STEP} px on every side`}>Shrink</button>
    <button type="button" className="opt" onClick={() => { record(cur()); growSelection(cur(), GROW_STEP); }} data-tip={`Grows the selection ${GROW_STEP} px on every side`}>Grow</button>
    <button type="button" className="opt" onClick={() => run(() => fillSelection(sessionId, cur(), brush.color, brush.opacity))} data-tip="Fills the selection with the brush color, on a new layer">Fill</button>
    <button type="button" className="opt" onClick={() => run(() => clearSelected(sessionId, cur()))} data-tip="Erases the selected pixels of the active layer · Delete">Delete</button>
    <button type="button" className="opt" onClick={() => run(() => selectionToLayer(sessionId, cur()))} data-tip="Copies the selected pixels of the active layer to a new layer · Ctrl+J">To layer</button>
  </>;
}

/** The row's part of them: there only while something is selected. */
export function SelectionQuick({ sessionId, doc }: { sessionId: string; doc: DesignDoc }) {
  useSelectionVersion();
  return getSelection(doc.id) ? <SelectionActions sessionId={sessionId} doc={doc} /> : null;
}
