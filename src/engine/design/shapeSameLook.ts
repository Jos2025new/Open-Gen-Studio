import type { DesignDoc, VectorShape } from '../types';
import type { ObjectPick } from './objectSelection';
import { pickable } from './objectGroupTree';

/*
 * «Select same» by stroke cap and corner join (Illustrator's "Select paths by stroke cap and corner join" script, and
 * Inkscape's Select Same: the whole document, hidden and locked items skipped, several references give the union).
 * Pure: it only finds the shapes; selecting them neither saves nor records an undo step.
 */

export type CapChoice = 'any' | NonNullable<VectorShape['cap']>;
export type JoinChoice = 'any' | NonNullable<VectorShape['join']>;
export interface LookQuery { cap: CapChoice; join: JoinChoice }
export interface ShapeRef { layerId: string; shapeId: string }

/** Cap and join as they draw: an absent value is round (shapeLook.ts applyStrokeLook). */
export function strokeLook(s: Pick<VectorShape, 'cap' | 'join'>): { cap: NonNullable<VectorShape['cap']>; join: NonNullable<VectorShape['join']> } {
  return { cap: s.cap ?? 'round', join: s.join ?? 'round' };
}

/** Cap and join only show on a visible stroke. */
export const hasStroke = (s: Pick<VectorShape, 'stroke' | 'strokeWidth'>): boolean => Boolean(s.stroke) && s.strokeWidth > 0;

const matches = (s: VectorShape, q: LookQuery): boolean => {
  const look = strokeLook(s);
  return (q.cap === 'any' || q.cap === look.cap) && (q.join === 'any' || q.join === look.join);
};

/**
 * Every stroked shape, in the visible and unlocked vector layers of the whole document, that matches any of the queries.
 * A layer inside a hidden or locked folder is itself hidden or locked (groups.ts), so the layer flags are enough.
 * Lineart strokes, painted, text and FX layers are ignored.
 */
export function findShapesByLook(doc: DesignDoc, queries: LookQuery | readonly LookQuery[]): ShapeRef[] {
  const list = Array.isArray(queries) ? queries : [queries as LookQuery];
  const out: ShapeRef[] = [];
  if (!list.length) return out;
  for (const layer of doc.layers) {
    if (layer.type !== 'vector' || !layer.visible || layer.locked) continue;
    for (const shape of layer.shapes) if (hasStroke(shape) && pickable(layer, shape) && list.some((q) => matches(shape, q))) out.push({ layerId: layer.id, shapeId: shape.id });
  }
  return out;
}

/** The distinct cap + join pairs of the picked stroked shapes: each one a reference for the union. */
export function looksOfPicks(doc: DesignDoc, picks: readonly ObjectPick[]): Array<{ cap: NonNullable<VectorShape['cap']>; join: NonNullable<VectorShape['join']> }> {
  const seen = new Map<string, ReturnType<typeof strokeLook>>();
  for (const pick of picks) {
    const layer = doc.layers.find((l) => l.id === pick.layerId);
    if (layer?.type !== 'vector') continue;
    for (const shape of layer.shapes) if (pick.ids.includes(shape.id) && hasStroke(shape)) { const look = strokeLook(shape); seen.set(`${look.cap}/${look.join}`, look); }
  }
  return [...seen.values()];
}

/** Matches grouped by layer, ready for the object selection. */
export function refsToPicks(refs: readonly ShapeRef[]): ObjectPick[] {
  const by = new Map<string, string[]>();
  for (const r of refs) by.set(r.layerId, [...(by.get(r.layerId) ?? []), r.shapeId]);
  return [...by].map(([layerId, ids]) => ({ layerId, ids }));
}
