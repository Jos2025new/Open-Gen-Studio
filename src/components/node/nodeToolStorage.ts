import type { Generation } from '../../engine/types';
import type { NodeTool } from './CanvasNavigation';

const TOOL_KEY = 'ogs.nodeTool.v2';

/** The remembered canvas tool (select or pan); the passing cut tool is never stored. */
export function loadNodeTool(): NodeTool {
  try { return localStorage.getItem(TOOL_KEY) === 'select' ? 'select' : 'pan'; } catch { return 'pan'; }
}

/** A chat result offered for import into the canvas. */
export function chatItem(g: Generation): { id: string; assetId: string; label: string } {
  return { id: g.id, assetId: g.assetIds[0], label: g.op ? g.op.id.replace(/_/g, ' ') : g.prompt.split(/[.,\n]/)[0].slice(0, 60) || g.kind };
}
