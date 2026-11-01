import { create } from 'zustand';
import type { SelectMode } from './selectMode';

/*
 * The mode of the node editor (labelled mode bar in the context strip). 'move' is the classic behaviour; 'bend' drags
 * a segment so the curve passes through the pointer and turns node dragging off. 'cut', 'erase' and 'lasso' are
 * each work on the edited path (cut it, erase part of it, lasso-select nodes). Not persisted; it returns to 'move' whenever node editing starts or ends.
 */
export type NodeEditMode = 'move' | 'bend' | 'cut' | 'erase' | 'lasso';
export const NODE_EDIT_MODES: NodeEditMode[] = ['move', 'bend', 'cut', 'erase', 'lasso'];
/** Modes that do something; a mode not listed shows disabled. */
export const NODE_EDIT_MODES_READY: NodeEditMode[] = ['move', 'bend', 'cut', 'erase', 'lasso'];

export const useNodeEditMode = create<{ mode: NodeEditMode; /** Element the selection works on in Move and Lasso: node, segment or face (selectMode.ts); back to node when node editing starts. */ select: SelectMode; /** Erase radius in screen px (page units = px / zoom). */ eraseRadius: number; /** Set when a cut or erase left several pieces as subpaths of the one edited shape; leaving node editing then separates them (pathPieces.ts). */ split: { sessionId: string; before: number } | null }>(() => ({ mode: 'move', select: 'node', eraseRadius: 10, split: null }));
/** `before`: the shape's subpath count before the first cut, so an undone cut (same count again) separates nothing on exit. */
export function markNodeEditSplit(sessionId: string, before = 1): void {
  if (useNodeEditMode.getState().split?.sessionId !== sessionId) useNodeEditMode.setState({ split: { sessionId, before } });
}
export function setNodeEditMode(mode: NodeEditMode): void {
  if (NODE_EDIT_MODES_READY.includes(mode)) useNodeEditMode.setState({ mode });
}
export function resetNodeEditMode(): void {
  const st = useNodeEditMode.getState();
  if (st.mode !== 'move' || st.split || st.select !== 'node') useNodeEditMode.setState({ mode: 'move', select: 'node', split: null });
}
export function setEraseRadius(px: number): void {
  useNodeEditMode.setState({ eraseRadius: Math.min(200, Math.max(1, Math.round(px))) });
}
