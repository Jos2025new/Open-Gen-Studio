import type { Graph } from '../types';
import { useStore } from '../../store/store';
import { editPresentation } from '../nodecore/edit';

/** Where a canvas was left: flow offset and zoom, as React Flow reports them. */
export interface CanvasView { x: number; y: number; zoom: number }
/** The two canvases that draw a session's graph; each remembers its own view. */
export type CanvasVariant = 'nodes' | 'omni';

const FIELD = { nodes: 'viewport', omni: 'omniViewport' } as const;
const valid = (v: CanvasView | undefined): v is CanvasView => !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.zoom) && v.zoom > 0;

/** The view this canvas was left in, or undefined the first time (the canvas then frames its content once). */
export function savedView(graph: Graph | undefined, variant: CanvasVariant): CanvasView | undefined {
  const v = graph?.[FIELD[variant]];
  return valid(v) ? { x: v.x, y: v.y, zoom: v.zoom } : undefined;
}

/**
 * Remember the view in the session's graph, so it also survives a reload. A presentation change with no undo step:
 * node data, cables and `updatedAt` stay as they are (node revisions, plans and approvals do not read it). Returns
 * whether something was written.
 */
export function rememberView(sessionId: string, variant: CanvasVariant, view: CanvasView): boolean {
  const graph = useStore.getState().sessions[sessionId]?.graph;
  if (!graph || !valid(view)) return false;
  const old = savedView(graph, variant);
  if (old && old.x === view.x && old.y === view.y && old.zoom === view.zoom) return false;
  const next = { x: view.x, y: view.y, zoom: view.zoom };
  return editPresentation(sessionId, (g) => ({ ...g, [FIELD[variant]]: next }), { silent: true }) === null;
}
