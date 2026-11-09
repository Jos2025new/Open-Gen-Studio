import type { ObjectGroup, VectorLayer, VectorShape } from '../types';
import { uid } from '../../lib/id';

/*
 * Object groups inside a vector layer, the SVG/Inkscape/Illustrator model: layer → groups (nesting) → shapes.
 * Stored flat (shape.groupId = innermost group, group.parentId = outer group) and kept contiguous in `shapes`, so the
 * paint order is the tree order and export can write nested <g> directly.
 */

/** The chain of groups of a shape, innermost first. */
export function groupChain(layer: VectorLayer, groupId: string | undefined): ObjectGroup[] {
  const out: ObjectGroup[] = [];
  const byId = new Map((layer.objectGroups ?? []).map((g) => [g.id, g]));
  for (let g = groupId ? byId.get(groupId) : undefined; g && !out.includes(g); g = g.parentId ? byId.get(g.parentId) : undefined) out.push(g);
  return out;
}

/** Whether a shape sits (directly or nested) in this group. */
export function inGroup(layer: VectorLayer, shape: VectorShape, groupId: string): boolean {
  return groupChain(layer, shape.groupId).some((g) => g.id === groupId);
}

/** A click picks the whole outermost group, as in Inkscape; shapes outside groups pick themselves. */
export function clickPick(layer: VectorLayer, id: string): string[] {
  const shape = layer.shapes.find((s) => s.id === id);
  if (!shape?.groupId) return [id];
  const top = groupChain(layer, shape.groupId).at(-1)!;
  return layer.shapes.filter((s) => inGroup(layer, s, top.id)).map((s) => s.id);
}

/** Expand picked ids to whole outermost groups (so every pick is a set of top-level items). */
export function expandPicks(layer: VectorLayer, ids: string[]): string[] {
  const set = new Set<string>();
  for (const id of ids) for (const x of clickPick(layer, id)) set.add(x);
  // Shapes in paint order; anything else picked (lineart strokes) is kept as it was.
  const shapes = new Set(layer.shapes.map((s) => s.id));
  return [...layer.shapes.filter((s) => set.has(s.id)).map((s) => s.id), ...ids.filter((x) => !shapes.has(x))];
}

/** Groups that still have shapes. */
export function liveObjectGroups(layer: VectorLayer): ObjectGroup[] {
  return (layer.objectGroups ?? []).filter((g) => layer.shapes.some((s) => inGroup(layer, s, g.id)));
}

/** Pure: group these shapes (whole outer groups are nested, not split). Members gather at the topmost one. */
export function groupShapes(layer: VectorLayer, ids: string[], name?: string): { layer: VectorLayer; groupId: string } | null {
  const picked = expandPicks(layer, ids);
  if (picked.length < 2) return null;
  const set = new Set(picked);
  const tops = new Set(picked.map((x) => groupChain(layer, layer.shapes.find((s) => s.id === x)!.groupId).at(-1)?.id ?? ''));
  const id = uid('og');
  const group: ObjectGroup = { id, name: name ?? `Group ${liveObjectGroups(layer).length + 1}` };
  // Outermost groups of the picks become children of the new group.
  const childGroups = new Set([...tops].filter(Boolean));
  const groups = (layer.objectGroups ?? []).map((g) => (childGroups.has(g.id) ? { ...g, parentId: id } : g));
  const members = layer.shapes.filter((s) => set.has(s.id)).map((s) => (s.groupId ? s : { ...s, groupId: id }));
  const topIndex = Math.max(...picked.map((x) => layer.shapes.findIndex((s) => s.id === x)));
  const rest = layer.shapes.filter((s) => !set.has(s.id));
  const at = layer.shapes.slice(0, topIndex + 1).filter((s) => !set.has(s.id)).length;
  const shapes = [...rest.slice(0, at), ...members, ...rest.slice(at)];
  return { layer: { ...layer, shapes, objectGroups: liveObjectGroups({ ...layer, shapes, objectGroups: [...groups, group] }) }, groupId: id };
}

/** Pure: take apart the outermost groups of these shapes (one level, as Inkscape's Ungroup). */
export function ungroupShapes(layer: VectorLayer, ids: string[]): VectorLayer | null {
  const tops = new Set<string>();
  for (const id of ids) {
    const s = layer.shapes.find((x) => x.id === id);
    const top = s ? groupChain(layer, s.groupId).at(-1) : undefined;
    if (top) tops.add(top.id);
  }
  if (!tops.size) return null;
  const groups = (layer.objectGroups ?? []).filter((g) => !tops.has(g.id)).map((g) => (g.parentId && tops.has(g.parentId) ? { ...g, parentId: undefined } : g));
  const shapes = layer.shapes.map((s) => (s.groupId && tops.has(s.groupId) ? { ...s, groupId: undefined } : s));
  return { ...layer, shapes, objectGroups: groups.length ? groups : undefined };
}

/** SVG of a layer's shapes as nested <g> following the group tree (paint order unchanged). */
export function shapesSvgTree(layer: VectorLayer, shapeSvg: (s: VectorShape) => string, esc: (s: string) => string): string {
  let out = '';
  let open: ObjectGroup[] = []; // outermost first
  for (const s of layer.shapes) {
    const chain = groupChain(layer, s.groupId).reverse();
    let k = 0;
    while (k < open.length && k < chain.length && open[k].id === chain[k].id) k++;
    for (let i = open.length - 1; i >= k; i--) out += '</g>';
    for (let i = k; i < chain.length; i++) out += `<g id="${esc(chain[i].id)}" inkscape:label="${esc(chain[i].name)}">`;
    open = chain;
    out += shapeSvg(s);
  }
  for (let i = 0; i < open.length; i++) out += '</g>';
  return out;
}
