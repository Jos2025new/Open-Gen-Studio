import { describe, expect, it } from 'vitest';
import { turnVector } from '../src/engine/design/transform';
import { looksUnchanged } from '../src/engine/design/symmetry';
import { newVectorLayer } from '../src/engine/design/doc';
import { pathBox } from '../src/engine/design/shapeTools';
import type { VectorLayer } from '../src/engine/types';

// The user's real "Polygon 28" (data/state.json, 2026-10-03): a pentagon pointing right, so top↕bottom changes nothing.
const d = 'M 595.05 773.97 L 367.77 1080 L 0 963.11 L 0 584.84 L 367.77 467.97 Z';
const b = pathBox(d)!;
const layer = { ...newVectorLayer('Polygon 28'), shapes: [{ id: 's', type: 'path', d, box0: b, ...b, fill: '#d4f25a', stroke: '#a33', strokeWidth: 40, radius: 0 }] } as VectorLayer;

describe('a flip that changes nothing visible is said, not silent', () => {
  it('pentagon pointing right: top↕bottom looks the same; left↔right does not', () => {
    expect(looksUnchanged(layer, turnVector(layer, 'flip-v'))).toBe(true);
    expect(looksUnchanged(layer, turnVector(layer, 'flip-h'))).toBe(false);
    expect(looksUnchanged(layer, turnVector(layer, 'rotate-cw'))).toBe(false);
  });
});
