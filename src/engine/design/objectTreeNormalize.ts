import type { DesignDoc, ObjectGroup, VectorLayer } from '../types';
import { uid } from '../../lib/id';

/*
 * The group tree every reader relies on (objectGroupTree.ts): each groupId and parentId names a group of the layer,
 * no group is its own ancestor, no group is empty, and the shapes of a group are one run in `shapes`. Operations keep
 * it; this puts back a layer that lost it (an older document, a file from elsewhere, a bug) without changing what is
 * drawn: paint order is never touched, and a group met again after another one closed it continues as a copy with the
 * same name and look.
 */

/** The same layer object when its tree already holds. */
export function normalizeObjectTree(layer: VectorLayer): VectorLayer {
  const src = layer.objectGroups ?? [];
  if (!src.length && !layer.shapes.some((s) => s.groupId)) return layer;
  const byId = new Map(src.map((g) => [g.id, g]));
  const chains = new Map<string, ObjectGroup[]>();
  /** Outermost first; a missing parent or a cycle ends the chain there. */
  const chainOf = (id: string): ObjectGroup[] => {
    let chain = chains.get(id);
    if (!chain) {
      chain = [];
      for (let g = byId.get(id); g && !chain.includes(g); g = g.parentId ? byId.get(g.parentId) : undefined) chain.unshift(g);
      chains.set(id, chain);
    }
    return chain;
  };
  const groups: ObjectGroup[] = [], used = new Set<string>();
  let open: string[] = [], openSrc: ObjectGroup[] = [], changed = false;
  const shapes = layer.shapes.map((s) => {
    const chain = s.groupId ? chainOf(s.groupId) : [];
    let k = 0;
    while (k < chain.length && openSrc[k] === chain[k]) k++;
    const ids = open.slice(0, k);
    for (let i = k; i < chain.length; i++) {
      const g = chain[i], id = used.has(g.id) ? uid('og') : g.id, parentId = i ? ids[i - 1] : undefined;
      used.add(g.id);
      const same = id === g.id && parentId === g.parentId;
      if (!same) changed = true;
      groups.push(same ? g : { ...g, id, parentId });
      ids.push(id);
    }
    open = ids;
    openSrc = chain;
    const groupId = ids.at(-1);
    if (groupId === s.groupId) return s;
    changed = true;
    return { ...s, groupId };
  });
  if (!changed && groups.length === src.length) return layer;
  return { ...layer, shapes, objectGroups: groups.length ? groups : undefined };
}

/** The same document object when every vector layer already holds. */
export function normalizeObjectTrees(doc: DesignDoc): DesignDoc {
  let changed = false;
  const layers = doc.layers.map((l) => {
    const next = l.type === 'vector' ? normalizeObjectTree(l) : l;
    if (next !== l) changed = true;
    return next;
  });
  return changed ? { ...doc, layers } : doc;
}
