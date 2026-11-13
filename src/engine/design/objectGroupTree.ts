import type { ObjectGroup, VectorLayer, VectorShape } from '../types';
import { uid } from '../../lib/id';
import { project } from './projection';

/*
 * Object groups inside a vector layer, the SVG/Inkscape/Illustrator model: layer → groups (nesting) → shapes.
 * Stored flat (shape.groupId = innermost group, group.parentId = outer group) and kept contiguous in `shapes`, so the
 * paint order is the tree order and export can write nested <g> directly.
 */

/** What the tree answers, read once per layer object (layers are never changed in place): O(shapes × depth). */
interface GroupIndex { groups: Map<string, ObjectGroup>; shapes: Map<string, VectorShape>; chains: Map<string, ObjectGroup[]>; members: Map<string, VectorShape[]> }
const indexes = new WeakMap<VectorLayer, GroupIndex>();
const NONE: never[] = [];
function chainOf(ix: GroupIndex, groupId: string | undefined): readonly ObjectGroup[] {
  if (!groupId) return NONE;
  let chain = ix.chains.get(groupId);
  if (!chain) {
    chain = [];
    for (let g = ix.groups.get(groupId); g && !chain.includes(g); g = g.parentId ? ix.groups.get(g.parentId) : undefined) chain.push(g);
    ix.chains.set(groupId, chain);
  }
  return chain;
}
function indexOf(layer: VectorLayer): GroupIndex {
  let ix = indexes.get(layer);
  if (!ix) {
    ix = { groups: new Map((layer.objectGroups ?? []).map((g) => [g.id, g])), shapes: new Map(), chains: new Map(), members: new Map() };
    for (const s of layer.shapes) {
      ix.shapes.set(s.id, s);
      for (const g of chainOf(ix, s.groupId)) { const m = ix.members.get(g.id); if (m) m.push(s); else ix.members.set(g.id, [s]); }
    }
    indexes.set(layer, ix);
  }
  return ix;
}

/** The chain of groups of a shape, innermost first. */
export function groupChain(layer: VectorLayer, groupId: string | undefined): ObjectGroup[] {
  return [...chainOf(indexOf(layer), groupId)];
}

/** The shapes of a group, nested ones too, in paint order. */
export function groupMembers(layer: VectorLayer, groupId: string): readonly VectorShape[] {
  return indexOf(layer).members.get(groupId) ?? NONE;
}

/** Whether a shape sits (directly or nested) in this group. */
export function inGroup(layer: VectorLayer, shape: VectorShape, groupId: string): boolean {
  return chainOf(indexOf(layer), shape.groupId).some((g) => g.id === groupId);
}

/** A shape is hidden or locked by itself or by any group above it (objectMeta.ts). */
export function shapeIs(layer: VectorLayer, shape: VectorShape, flag: 'hidden' | 'locked'): boolean {
  return !!shape[flag] || chainOf(indexOf(layer), shape.groupId).some((g) => g[flag]);
}
/** Shapes that can be picked: neither hidden nor locked. */
export const pickable = (layer: VectorLayer, shape: VectorShape): boolean => !shapeIs(layer, shape, 'hidden') && !shapeIs(layer, shape, 'locked');

const shown = new WeakMap<VectorLayer, VectorLayer>();
/** The layer as it is seen: without its hidden shapes, in projected order. Same object for the same layer (render caches by identity). */
export function shownLayer(layer: VectorLayer): VectorLayer {
  let out = shown.get(layer);
  if (!out) {
    const shapes = project(layer.shapes.filter((s) => !shapeIs(layer, s, 'hidden')), layer.depthOrder) as VectorShape[];
    out = shapes.length === layer.shapes.length ? layer : { ...layer, shapes };
    shown.set(layer, out);
  }
  return out;
}

/**
 * A click picks the whole outermost group, as in Inkscape; shapes outside groups pick themselves. A hidden or locked
 * shape is never picked by itself (empty), but it belongs to its group: picking the group through another member
 * takes it along, so the group moves, turns, scales and deletes whole (Figma).
 */
export function clickPick(layer: VectorLayer, id: string): string[] {
  const ix = indexOf(layer), shape = ix.shapes.get(id);
  if (!shape || !pickable(layer, shape)) return [];
  const top = chainOf(ix, shape.groupId).at(-1);
  return top ? ix.members.get(top.id)!.map((s) => s.id) : [id];
}

/** Ids of every shape of the outermost groups these ids open by a click (each group read once). */
function clickPicks(layer: VectorLayer, ids: readonly string[]): Set<string> {
  const ix = indexOf(layer), out = new Set<string>(), seen = new Set<string>();
  for (const id of ids) {
    const shape = ix.shapes.get(id);
    if (!shape || !pickable(layer, shape)) continue;
    const top = chainOf(ix, shape.groupId).at(-1);
    if (!top) out.add(id);
    else if (!seen.has(top.id)) { seen.add(top.id); for (const s of ix.members.get(top.id)!) out.add(s.id); }
  }
  return out;
}

/** The picked ids that may stay picked: shapes that can be picked, and the hidden or locked ones a picked group carries. Other ids (strokes) are kept. */
export function validPicks(layer: VectorLayer, ids: readonly string[]): string[] {
  const shapes = indexOf(layer).shapes, carried = clickPicks(layer, ids);
  return ids.filter((id) => !shapes.has(id) || carried.has(id));
}

/** Expand picked ids to whole outermost groups (so every pick is a set of top-level items). */
export function expandPicks(layer: VectorLayer, ids: string[]): string[] {
  const set = clickPicks(layer, ids), shapes = indexOf(layer).shapes;
  // Shapes in paint order; anything else picked (lineart strokes) is kept as it was.
  return [...layer.shapes.filter((s) => set.has(s.id)).map((s) => s.id), ...ids.filter((x) => !shapes.has(x))];
}

/** Groups that still have shapes. */
export function liveObjectGroups(layer: VectorLayer): ObjectGroup[] {
  const members = indexOf(layer).members;
  return (layer.objectGroups ?? []).filter((g) => members.has(g.id));
}

/**
 * Pure: group these shapes, as Inkscape and Illustrator do. A group whose members are all picked goes in whole, as a
 * subgroup; a shape picked from inside a group (entered with a double click) leaves it alone, and the old group keeps
 * the rest (an emptied group disappears). The new group takes the place of the topmost pick: its position in the
 * layer, inside the group that one was in.
 */
export function groupShapes(layer: VectorLayer, ids: string[], name?: string, min = 2): { layer: VectorLayer; groupId: string } | null {
  // Only shapes group (lineart strokes are drawn above every shape, outside the tree).
  const ix = indexOf(layer), set = new Set(ids.filter((id) => ix.shapes.has(id)));
  if (set.size < min) return null;
  // Its locked or hidden members travel with a group whose other members are all picked.
  for (const g of layer.objectGroups ?? []) {
    const inside = groupMembers(layer, g.id);
    if (inside.some((s) => set.has(s.id)) && inside.every((s) => set.has(s.id) || !pickable(layer, s))) for (const s of inside) set.add(s.id);
  }
  // Whole = every member is picked.
  const wholes = new Map<string, boolean>();
  const whole = (g: ObjectGroup) => { let w = wholes.get(g.id); if (w === undefined) wholes.set(g.id, w = groupMembers(layer, g.id).every((s) => set.has(s.id))); return w; };
  // Per picked shape: the outermost fully picked group above it (its item), and the groups that hold the item, outermost first.
  const items = layer.shapes.filter((s) => set.has(s.id)).map((s) => {
    const chain = chainOf(ix, s.groupId);
    let top = -1;
    chain.forEach((g, i) => { if (whole(g)) top = i; });
    return { shape: s, item: top >= 0 ? chain[top] : null, path: chain.slice(top + 1).reverse() };
  });
  const last = items[items.length - 1];
  const id = uid('og');
  const group: ObjectGroup = { id, name: name ?? `Group ${liveObjectGroups(layer).length + 1}`, parentId: last.path.at(-1)?.id };
  const subgroups = new Set(items.map((x) => x.item?.id).filter(Boolean));
  const groups = (layer.objectGroups ?? []).map((g) => (subgroups.has(g.id) ? { ...g, parentId: id } : g));
  const members = items.map((x) => (x.item ? x.shape : { ...x.shape, groupId: id }));
  const end = layer.shapes.indexOf(last.shape);
  const rest = layer.shapes.filter((s) => !set.has(s.id));
  const at = layer.shapes.slice(0, end + 1).filter((s) => !set.has(s.id)).length;
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

/** A group that is composed apart: it has an opacity under 1 or a blend mode of its own. */
export const groupLook = (g: ObjectGroup): boolean => (g.opacity ?? 1) < 1 || (g.blend ?? 'normal') !== 'normal';

/** Hidden and locked as Inkscape writes them, so its Objects panel and this app's import read them back. */
const stateAttrs = (o: { hidden?: boolean; locked?: boolean }): string => `${o.hidden ? ' display="none"' : ''}${o.locked ? ' sodipodi:insensitive="true"' : ''}`;
const groupAttrs = (g: ObjectGroup): string => `${stateAttrs(g)}${(g.opacity ?? 1) < 1 ? ` opacity="${+(g.opacity!).toFixed(4)}"` : ''}${g.blend && g.blend !== 'normal' ? ` style="mix-blend-mode:${g.blend}"` : ''}`;

/**
 * SVG of a layer's shapes as nested <g> following the group tree (paint order unchanged). Pass the layer itself to
 * keep its hidden shapes (display="none"), or shownLayer(layer) to leave them out.
 */
export function shapesSvgTree(layer: VectorLayer, shapeSvg: (s: VectorShape) => string, esc: (s: string) => string): string {
  const ix = indexOf(layer);
  let out = '';
  let open: readonly ObjectGroup[] = []; // outermost first
  for (const s of layer.shapes) {
    const chain = [...chainOf(ix, s.groupId)].reverse();
    let k = 0;
    while (k < open.length && k < chain.length && open[k].id === chain[k].id) k++;
    for (let i = open.length - 1; i >= k; i--) out += '</g>';
    for (let i = k; i < chain.length; i++) out += `<g id="${esc(`${layer.id}-${chain[i].id}`)}" inkscape:label="${esc(chain[i].name)}"${groupAttrs(chain[i])}>`;
    open = chain;
    // Its name (Inkscape's label) and state go on the shape's outer element.
    const own = `${s.name ? ` inkscape:label="${esc(s.name)}"` : ''}${stateAttrs(s)}`;
    out += own ? shapeSvg(s).replace(/^<[\w:]+/, (m) => m + own) : shapeSvg(s);
  }
  for (let i = 0; i < open.length; i++) out += '</g>';
  return out;
}
