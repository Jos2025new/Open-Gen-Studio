import { create } from 'zustand';

/*
 * The mode of the node editor (labelled mode bar in the context strip). 'move' is the classic behaviour; 'bend' drags
 * a segment so the curve passes through the pointer and turns node dragging off. 'cut', 'erase' and 'lasso' are
 * placeholders a later phase wires. Not persisted; it returns to 'move' whenever node editing starts or ends.
 */
export type NodeEditMode = 'move' | 'bend' | 'cut' | 'erase' | 'lasso';
export const NODE_EDIT_MODES: NodeEditMode[] = ['move', 'bend', 'cut', 'erase', 'lasso'];
/** Modes that already do something; the rest show disabled. */
export const NODE_EDIT_MODES_READY: NodeEditMode[] = ['move', 'bend'];

export const useNodeEditMode = create<{ mode: NodeEditMode }>(() => ({ mode: 'move' }));
export function setNodeEditMode(mode: NodeEditMode): void {
  if (NODE_EDIT_MODES_READY.includes(mode)) useNodeEditMode.setState({ mode });
}
export function resetNodeEditMode(): void {
  if (useNodeEditMode.getState().mode !== 'move') useNodeEditMode.setState({ mode: 'move' });
}
