import type { DesignDoc, Layer, LayerGroup } from '../types';
import { uid } from '../../lib/id';
import { getDoc, mutateDoc } from './actions';
import { useLayerSelection } from './selection';

/*
 * Layer folders. A group is a name over a run of layers (each layer says its groupId). Its eye and lock act on every
 * layer in it, and clicking it selects them all, so the Edit tool moves them together. Rendering, export and every
 * tool keep working layer by layer: nothing else needs to know about groups.
 */

export function groupMembers(doc: DesignDoc, groupId: string): Layer[] {
  return doc.layers.filter((l) => l.groupId === groupId);
}

/** Groups that still have layers (a group whose layers were all deleted or moved out is gone). */
export function liveGroups(doc: DesignDoc): LayerGroup[] {
  return (doc.groups ?? []).filter((g) => doc.layers.some((l) => l.groupId === g.id));
}

/** Put these layers in a new group; they are gathered next to each other where the topmost one was. One undo step. */
export function groupLayers(sessionId: string, docId: string, ids: string[]): string | null {
  const doc = getDoc(sessionId, docId);
  if (!doc) return null;
  const set = new Set(ids);
  const members = doc.layers.filter((l) => set.has(l.id));
  if (members.length < 2) return null;
  const group: LayerGroup = { id: uid('grp'), name: `Group ${liveGroups(doc).length + 1}` };
  const top = Math.max(...members.map((l) => doc.layers.indexOf(l)));
  const before = doc.layers.slice(0, top + 1).filter((l) => !set.has(l.id));
  const after = doc.layers.slice(top + 1);
  const grouped = members.map((l) => ({ ...l, groupId: group.id }));
  mutateDoc(sessionId, docId, (d) => ({ ...d, updatedAt: Date.now(), groups: [...liveGroups(d), group], layers: [...before, ...grouped, ...after] }));
  return group.id;
}

export function ungroup(sessionId: string, docId: string, groupId: string): void {
  mutateDoc(sessionId, docId, (d) => ({ ...d, updatedAt: Date.now(), groups: (d.groups ?? []).filter((g) => g.id !== groupId), layers: d.layers.map((l) => (l.groupId === groupId ? { ...l, groupId: undefined } : l)) }));
}

/** Show or hide, lock or unlock every layer of the group. */
export function setGroupFlag(sessionId: string, docId: string, groupId: string, flag: 'visible' | 'locked', value: boolean): void {
  mutateDoc(sessionId, docId, (d) => ({ ...d, updatedAt: Date.now(), layers: d.layers.map((l) => (l.groupId === groupId ? { ...l, [flag]: value } : l)) }));
}

export function patchGroup(sessionId: string, docId: string, groupId: string, patch: Partial<Pick<LayerGroup, 'name' | 'collapsed'>>, record = true): void {
  mutateDoc(sessionId, docId, (d) => ({ ...d, groups: (d.groups ?? []).map((g) => (g.id === groupId ? { ...g, ...patch } : g)) }), { record });
}

/** Select every layer of the group (the topmost becomes active), so Edit, Align and Transform act on all of them. */
export function selectGroup(doc: DesignDoc, groupId: string): string | null {
  const ids = groupMembers(doc, groupId).map((l) => l.id);
  if (!ids.length) return null;
  useLayerSelection.setState((s) => ({ byDoc: { ...s.byDoc, [doc.id]: ids } }));
  return ids[ids.length - 1];
}
