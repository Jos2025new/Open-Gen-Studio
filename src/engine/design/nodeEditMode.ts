import { create } from 'zustand';

/*
 * The mode of the node editor (labelled mode bar in the context strip). 'move' is the classic behaviour; 'bend' drags
 * a segment so the curve passes through the pointer and turns node dragging off. 'cut', 'erase' and 'lasso' are
 * each work on the edited path (cut it, erase part of it, lasso-select nodes). Not persisted; it returns to 'move' whenever node editing starts or ends.
 */
export type NodeEditMode = 'move' | 'bend' | 'cut' | 'erase' | 'lasso';
export const NODE_EDIT_MODES: NodeEditMode[] = ['move', 'bend', 'cut', 'erase', 'lasso'];
/** Modes that do something; a mode not listed shows disabled. */
export const NODE_EDIT_MODES_READY: NodeEditMode[] = ['move', 'bend', 'cut', 'erase', 'lasso'];

export const useNodeEditMode = create<{ mode: NodeEditMode; /** Erase radius in screen px (page units = px / zoom). */ eraseRadius: number }>(() => ({ mode: 'move', eraseRadius: 10 }));
export function setNodeEditMode(mode: NodeEditMode): void {
  if (NODE_EDIT_MODES_READY.includes(mode)) useNodeEditMode.setState({ mode });
}
export function resetNodeEditMode(): void {
  if (useNodeEditMode.getState().mode !== 'move') useNodeEditMode.setState({ mode: 'move' });
}
export function setEraseRadius(px: number): void {
  useNodeEditMode.setState({ eraseRadius: Math.min(200, Math.max(1, Math.round(px))) });
}
