import type { DesignDoc, ObjectGroup, VectorLayer, VectorShape } from '../types';
import type { ObjectPick } from './objectSelection';
import { groupMembers, groupShapes, liveObjectGroups } from './objectGroupTree';
import { fxTarget } from '../fx/plan';

const plain = (l: VectorLayer) => l.opacity >= 1 && l.blend === 'normal';

/*
 * Ctrl+G on shapes picked in several layers, as Inkscape: they move to the layer of the topmost one, keeping look,
 * place and relative order, and group there. A source layer left with nothing stays, empty, as in Inkscape and Illustrator. The look is kept: the shapes of a layer with its
 * own opacity, blend mode or hidden state go in a subgroup that carries it. What a group cannot carry (a pixel mask, an
 * effects layer that reaches only some of them) stops the grouping, and the caller tells why. Pure; one undo step upstream.
 */

/** The picked shapes of a layer, ready for another one: fully picked groups travel with them. */
function carry(src: VectorLayer, ids: Set<string>): { shapes: VectorShape[]; groups: ObjectGroup[] } {
  const whole = new Set((src.objectGroups ?? []).filter((g) => { const m = groupMembers(src, g.id); return m.length > 0 && m.every((s) => ids.has(s.id)); }).map((g) => g.id));
  const shapes = src.shapes.filter((s) => ids.has(s.id)).map((s) => ({ ...s, groupId: s.groupId && whole.has(s.groupId) ? s.groupId : undefined }));
  const groups = (src.objectGroups ?? []).filter((g) => whole.has(g.id)).map((g) => (g.parentId && !whole.has(g.parentId) ? { ...g, parentId: undefined } : g));
  return { shapes, groups };
}

export type GroupAcross = { doc: DesignDoc; layerId: string; groupId: string; ids: string[] } | { error: string };

/**
 * Null = nothing to group (fewer than two shapes). `error` = the pick cannot be grouped without changing how it looks
 * or touching what is locked; nothing changes and the reason is for the user.
 */
export function groupAcrossLayers(doc: DesignDoc, picks: readonly ObjectPick[], name?: string): GroupAcross | null {
  // Layers bottom first, each with its picked shapes.
  const parts = doc.layers.flatMap((l) => {
    if (l.type !== 'vector') return [];
    const want = picks.find((p) => p.layerId === l.id)?.ids ?? [];
    const ids = new Set(l.shapes.filter((s) => want.includes(s.id)).map((s) => s.id));
    return ids.size ? [{ layer: l, ids }] : [];
  });
  if (parts.reduce((n, p) => n + p.ids.size, 0) < 2) return null;
  const locked = parts.find((p) => p.layer.locked);
  if (locked) return { error: `"${locked.layer.name}" is locked. Unlock it to group its shapes.` };
  const target = parts[parts.length - 1].layer;
  // The target becomes a plain layer when it gives its own opacity and blend to a subgroup (below).
  let home: VectorLayer = target;
  const looks: Array<{ ids: string[]; name: string; look: Pick<ObjectGroup, 'opacity' | 'blend' | 'hidden'> }> = [];
  if (parts.length > 1) {
    // What a group cannot carry stops the grouping, with the reason: nothing may look different afterwards.
    const cannot = (why: string) => ({ error: `Not grouped: ${why}, and a group cannot carry that, so the shapes would look different.` });
    const masked = parts.find((p) => p.layer.pixelMask);
    if (masked) return cannot(`"${masked.layer.name}" has a pixel mask`);
    const involved = new Set(parts.map((p) => p.layer.id)), from = doc.layers.indexOf(parts[0].layer), to = doc.layers.indexOf(target);
    const fx = doc.layers.find((l, i) => l.type === 'fx' && ((i > from && i < to) || involved.has(fxTarget(doc.layers, l.id)?.id ?? '')));
    if (fx) return cannot(`the effects layer "${fx.name}" acts on some of these shapes and not on others`);
    if (!target.visible) return cannot(`the top layer "${target.name}" is hidden`);
    if (!plain(target)) {
      // Its opacity and blend can move to a subgroup only when that subgroup holds everything the layer draws.
      if (target.strokes?.length || target.shapes.some((s) => !parts[parts.length - 1].ids.has(s.id))) return cannot(`the top layer "${target.name}" has its own opacity or blend mode and holds more than the picked shapes`);
      home = { ...target, opacity: 1, blend: 'normal' };
    }
    // Keep the look (the default; adopting the target layer's look instead would go here): the shapes of a layer
    // that draws unlike a plain layer go in a subgroup with that layer's opacity, blend and hidden state.
    for (const p of parts) {
      const look = { ...(p.layer.opacity < 1 ? { opacity: p.layer.opacity } : {}), ...(p.layer.blend !== 'normal' ? { blend: p.layer.blend } : {}), ...(p.layer.visible ? {} : { hidden: true }) };
      if (Object.keys(look).length) looks.push({ ids: [...p.ids], name: p.layer.name, look });
    }
  }
  const below = parts.slice(0, -1).map((p) => ({ ...p, ...carry(p.layer, p.ids) }));
  const all = parts.flatMap((p) => [...p.ids]);
  let merged: VectorLayer = {
    ...home,
    shapes: [...below.flatMap((p) => p.shapes), ...home.shapes],
    objectGroups: [...(home.objectGroups ?? []), ...below.flatMap((p) => p.groups)],
  };
  for (const k of looks) {
    const sub = groupShapes(merged, k.ids, k.name, 1);
    if (sub) merged = { ...sub.layer, objectGroups: sub.layer.objectGroups!.map((g) => (g.id === sub.groupId ? { ...g, ...k.look } : g)) };
  }
  const grouped = groupShapes(merged, all, name);
  if (!grouped) return null;
  const sources = new Map(below.map((p) => {
    const shapes = p.layer.shapes.filter((s) => !p.ids.has(s.id));
    const groups = liveObjectGroups({ ...p.layer, shapes });
    return [p.layer.id, { ...p.layer, shapes, objectGroups: groups.length ? groups : undefined } as VectorLayer];
  }));
  const next: DesignDoc = { ...doc, layers: doc.layers.map((l) => (l.id === target.id ? grouped.layer : sources.get(l.id) ?? l)) };
  const members = groupMembers(grouped.layer, grouped.groupId).map((s) => s.id);
  return { doc: { ...next, activeLayerId: target.id }, layerId: target.id, groupId: grouped.groupId, ids: members };
}
