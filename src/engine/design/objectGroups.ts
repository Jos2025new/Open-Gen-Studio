import type { DesignDoc, ObjectGroup, VectorLayer } from '../types';
import { getDoc, mutateDoc } from './actions';
import { groupShapes, ungroupShapes } from './objectGroupTree';
import type { ObjectMeta } from '../objectMeta';
import { groupAcrossLayers } from './groupAcross';
import type { ObjectPick } from './objectSelection';

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

/** Group the picked shapes, of one layer or several (they gather in the topmost one's layer). One undo step. Null = not a group; `error` = why it cannot be done. */
export function groupPicks(sessionId: string, docId: string, picks: readonly ObjectPick[]): { layerId: string; ids: string[] } | { error: string } | null {
  const doc = getDoc(sessionId, docId);
  const r = doc && groupAcrossLayers(doc, picks);
  if (!r || 'error' in r) return r || null;
  mutateDoc(sessionId, docId, () => r.doc);
  return { layerId: r.layerId, ids: r.ids };
}

export function ungroupPicked(sessionId: string, docId: string, layerId: string, ids: string[]): boolean {
  return onLayer(sessionId, docId, layerId, (l) => ungroupShapes(l, ids));
}

export function renameObjectGroup(sessionId: string, docId: string, layerId: string, groupId: string, patch: Partial<Pick<ObjectGroup, 'name' | 'collapsed'>>): void {
  onLayer(sessionId, docId, layerId, (l) => ({ ...l, objectGroups: (l.objectGroups ?? []).map((g) => (g.id === groupId ? { ...g, ...patch } : g)) }));
}


/** Name, hide or lock a shape or a group of a vector layer (an empty name returns to the generated one). What stops being pickable leaves the selection (prunePicks, after every change). */
export function setObjectMeta(sessionId: string, docId: string, layerId: string, id: string, patch: Pick<ObjectMeta, 'name' | 'hidden' | 'locked'>): void {
  const clean = (o: ObjectMeta) => { for (const k of ['name', 'hidden', 'locked'] as const) if (!o[k]) delete o[k]; return o; };
  onLayer(sessionId, docId, layerId, (l) => (l.objectGroups?.some((g) => g.id === id)
    ? { ...l, objectGroups: l.objectGroups.map((g) => (g.id === id ? { ...g, ...patch, name: patch.name || g.name } : g)) }
    : { ...l, shapes: l.shapes.map((s) => (s.id === id ? (clean({ ...s, ...patch }) as typeof s) : s)) }));
}
