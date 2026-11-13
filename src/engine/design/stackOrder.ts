import type { DesignDoc, VectorLayer, VectorShape } from '../types';
import type { ObjectPick } from './objectSelection';
import { groupChain, pickable } from './objectGroupTree';

/*
 * Stacking order (who covers whom): the list order, bottom first. To front / forward / backward / to back move the
 * picked items among their siblings: shapes and whole groups inside their layer or group (a group moves as one block,
 * its members stay together), layers inside the document. Lineart and painted strokes have no order of their own yet.
 */
export type StackOp = 'front' | 'forward' | 'backward' | 'back';
export const STACK_OPS: Array<{ op: StackOp; label: string; key: string }> = [
  { op: 'front', label: 'Bring to front', key: 'Home' },
  { op: 'forward', label: 'Bring forward', key: 'PageUp' },
  { op: 'backward', label: 'Send backward', key: 'PageDown' },
  { op: 'back', label: 'Send to back', key: 'End' },
];

/** Pure: the list with its picked items moved; the picked keep their order among themselves. */
export function restack<T>(list: readonly T[], picked: (t: T) => boolean, op: StackOp): T[] {
  const out = [...list];
  if (op === 'front') return [...out.filter((t) => !picked(t)), ...out.filter(picked)];
  if (op === 'back') return [...out.filter(picked), ...out.filter((t) => !picked(t))];
  if (op === 'forward') { for (let i = out.length - 2; i >= 0; i--) if (picked(out[i]) && !picked(out[i + 1])) [out[i], out[i + 1]] = [out[i + 1], out[i]]; }
  else for (let i = 1; i < out.length; i++) if (picked(out[i]) && !picked(out[i - 1])) [out[i], out[i - 1]] = [out[i - 1], out[i]];
  return out;
}

type Node = { shape: VectorShape } | { groupId: string; children: Node[] };
const leaves = (n: Node): VectorShape[] => ('shape' in n ? [n.shape] : n.children.flatMap(leaves));

/** Pure: reorder the picked shapes of a vector layer; a fully picked group moves whole, among its siblings. Null = nothing moves. */
export function restackShapes(layer: VectorLayer, ids: readonly string[], op: StackOp): VectorLayer | null {
  const set = new Set(ids);
  const root: Node[] = [];
  const open = new Map<string, Node[]>();
  for (const s of layer.shapes) {
    let into = root;
    for (const g of groupChain(layer, s.groupId).reverse()) {
      let kids = open.get(g.id);
      if (!kids) { kids = []; open.set(g.id, kids); into.push({ groupId: g.id, children: kids }); }
      into = kids;
    }
    into.push({ shape: s });
  }
  const whole = (n: Node) => { const ls = leaves(n); return ls.some((s) => set.has(s.id)) && ls.every((s) => set.has(s.id) || !pickable(layer, s)); };
  const moving = new Set<VectorShape>();
  const collect = (n: Node): void => {
    if (whole(n)) leaves(n).forEach((s) => moving.add(s));
    else if ('children' in n) n.children.forEach(collect);
  };
  root.forEach(collect);
  // Only a real move counts: members of a group that are not together (older files) are left as they are.
  let moved = false;
  const walk = (ns: Node[]): Node[] => {
    const next = restack(ns, whole, op);
    if (next.some((n, i) => n !== ns[i])) moved = true;
    return next.map((n) => ('shape' in n || whole(n) ? n : { ...n, children: walk(n.children) }));
  };
  const ordered = walk(root).flatMap(leaves);
  const shapes = layer.shapes.filter((s) => !moving.has(s));
  const runs: VectorShape[][] = [];
  for (let i = 0; i < ordered.length; i++) {
    const s = ordered[i];
    if (moving.has(s)) {
      if (!i || !moving.has(ordered[i - 1])) runs.push([]);
      runs[runs.length - 1].push(s);
    }
  }
  for (const run of runs) {
    const first = ordered.indexOf(run[0]), last = first + run.length - 1;
    const anchor = op === 'front' || op === 'forward' ? ordered.slice(0, first).reverse().find((s) => !moving.has(s)) : ordered.slice(last + 1).find((s) => !moving.has(s));
    const at = anchor ? shapes.indexOf(anchor) + (op === 'front' || op === 'forward' ? 1 : 0) : (op === 'front' || op === 'forward' ? 0 : shapes.length);
    shapes.splice(at, 0, ...run);
  }
  return moved ? { ...layer, shapes } : null;
}

/** Pure: reorder the layers of a document (locked ones move too: order is not content). Null = nothing moves. */
export function restackLayers(doc: DesignDoc, ids: readonly string[], op: StackOp): DesignDoc | null {
  const layers = restack(doc.layers, (l) => ids.includes(l.id), op);
  return layers.every((l, i) => l === doc.layers[i]) ? null : { ...doc, layers };
}

/** Pure: Objects mode. Shapes reorder inside their layer; an image or text picked as an object (id = its layer) moves its layer. */
export function restackPicks(doc: DesignDoc, picks: readonly ObjectPick[], op: StackOp): DesignDoc | null {
  let changed = false;
  const whole = picks.filter((p) => p.ids.includes(p.layerId)).map((p) => p.layerId);
  let next: DesignDoc = { ...doc, layers: doc.layers.map((l) => {
    const ids = picks.find((p) => p.layerId === l.id)?.ids;
    const moved = ids && l.type === 'vector' && !l.locked ? restackShapes(l, ids, op) : null;
    if (moved) changed = true;
    return moved ?? l;
  }) };
  const moved = whole.length ? restackLayers(next, whole, op) : null;
  if (moved) { next = moved; changed = true; }
  return changed ? next : null;
}
