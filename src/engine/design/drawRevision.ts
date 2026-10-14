import type { Layer } from '../types';

/*
 * Two revisions per layer. The content revision is the pixels' version (raster.ts bufferVersion): it moves only when
 * pixels or strokes change. The drawing revision is what the layer's drawn result depends on besides those pixels.
 * Raster layers drop their placement and blend: the editor's FX cache keeps the box-local result and places it at
 * composite time, so moving or fading a layer keeps it. Anything else (transform, size, FX inputs) still compares.
 */
const PLACEMENT_ONLY = new Set(['x', 'y', 'opacity', 'blend', 'name']);

export function drawRevision(l: Layer): unknown[] {
  if (l.type !== 'raster') return [l];
  const fields = l as unknown as Record<string, unknown>;
  const out: unknown[] = [];
  for (const k of Object.keys(fields).sort()) if (!PLACEMENT_ONLY.has(k)) out.push(k, fields[k]);
  return out;
}
