import type { DesignDoc, ObjectGroup, VectorLayer } from '../types';
import { getDoc, mutateDoc } from './actions';
import { groupShapes, ungroupShapes } from './objectGroupTree';

/* Undoable object-group actions on a vector layer (the pure tree lives in objectGroupTree.ts). */
function onLayer(sessionId: string, docId: string, layerId: string, fn: (l: VectorLayer) => VectorLayer | null): boolean {
  const doc = getDoc(sessionId, docId);
  const layer = doc?.layers.find((l) => l.id === layerId);
  if (!doc || layer?.type !== 'vector' || layer.locked) return false;
  const next = fn(layer);
  if (!next) return false;
  mutateDoc(sessionId, docId, (d: DesignDoc) => ({ ...d, layers: d.layers.map((l) => (l.id === layerId ? next : l)) }));
  return true;
}

export function groupPicked(sessionId: string, docId: string, layerId: string, ids: string[]): string | null {
  let gid: string | null = null;
  onLayer(sessionId, docId, layerId, (l) => { const r = groupShapes(l, ids); gid = r?.groupId ?? null; return r?.layer ?? null; });
  return gid;
}

export function ungroupPicked(sessionId: string, docId: string, layerId: string, ids: string[]): boolean {
  return onLayer(sessionId, docId, layerId, (l) => ungroupShapes(l, ids));
}

export function renameObjectGroup(sessionId: string, docId: string, layerId: string, groupId: string, patch: Partial<Pick<ObjectGroup, 'name' | 'collapsed'>>): void {
  onLayer(sessionId, docId, layerId, (l) => ({ ...l, objectGroups: (l.objectGroups ?? []).map((g) => (g.id === groupId ? { ...g, ...patch } : g)) }));
}

