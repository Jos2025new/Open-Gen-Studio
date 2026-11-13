import type { DesignDoc, Layer } from '../types';

/** Whether every number reachable from this value is finite (NaN or Infinity would write invalid SVG). */
export function allFinite(value: unknown, seen = new WeakSet<object>()): boolean {
  const pending: unknown[] = [value];
  while (pending.length) {
    const v = pending.pop();
    if (typeof v === 'number' && !Number.isFinite(v)) return false;
    if (!v || typeof v !== 'object' || seen.has(v)) continue;
    seen.add(v);
    for (const child of Object.values(v)) pending.push(child);
  }
  return true;
}

/**
 * The document without what holds a non-finite number: such a shape (or layer) is left out and named, never invented
 * at 0,0 and never failing the whole export. Inkscape drops it silently; we say so (docs/history/061-2026-11-W46-cierre.md).
 */
export function finiteDoc(doc: DesignDoc): { doc: DesignDoc; dropped: string[] } {
  const dropped: string[] = [];
  const layers: Layer[] = [];
  for (const l of doc.layers) {
    if (l.type === 'vector') {
      const shapes = l.shapes.filter((s) => allFinite(s) || (dropped.push(`${s.name ?? s.type} in “${l.name}”`), false));
      const rest = { ...l, shapes: [] };
      if (!allFinite(rest)) { dropped.push(`layer “${l.name}”`); continue; }
      layers.push(shapes.length === l.shapes.length ? l : { ...l, shapes });
    } else if (allFinite(l)) layers.push(l);
    else dropped.push(`layer “${l.name}”`);
  }
  return dropped.length ? { doc: { ...doc, layers }, dropped } : { doc, dropped };
}
