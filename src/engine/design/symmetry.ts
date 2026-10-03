import type { Layer, VectorLayer } from '../types';
import { shapeBox } from './doc';
import { pathTransform } from './path';

/* Did a flip or turn change anything visible? (A symmetric shape looks the same afterwards.) */

type Turn = 'flip-h' | 'flip-v' | 'rotate-cw' | 'rotate-ccw' | 'rotate-180';

/** Every point that defines the vector content, in page coordinates (paths, boxes of shapes, stroke points). */
function vectorPoints(layer: VectorLayer, ids?: string[]): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (const s of layer.shapes) {
    if (ids && !ids.includes(s.id)) continue;
    if (s.type === 'path' && s.d) {
      const t = pathTransform(s);
      const n = (s.d.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? []).map(Number);
      for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i] * t.sx + t.tx, n[i + 1] * t.sy + t.ty]);
    } else if (s.type === 'line') pts.push([s.x, s.y], [s.x + s.w, s.y + s.h]);
    else { const b = shapeBox(s); pts.push([b.x, b.y], [b.x + b.w, b.y + b.h]); }
  }
  for (const st of layer.strokes ?? []) if (!ids || ids.includes(st.id)) for (const [x, y] of st.points) pts.push([x, y]);
  return pts;
}

/**
 * True when a flip or turn left vector content looking exactly the same (a symmetric shape): the same set of
 * points within half a pixel. Used to say so, instead of leaving the user to think the button did nothing.
 */
export function looksUnchanged(before: Layer, after: Layer, ids?: string[]): boolean {
  if (before.type !== 'vector' || after.type !== 'vector') return false;
  const key = (p: Array<[number, number]>) => p.map(([x, y]) => [Math.round(x * 2) / 2, Math.round(y * 2) / 2]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const a = key(vectorPoints(before, ids)), b = key(vectorPoints(after, ids));
  return a.length > 0 && a.length === b.length && a.every((p, i) => Math.abs(p[0] - b[i][0]) <= 0.5 && Math.abs(p[1] - b[i][1]) <= 0.5);
}

const TURN_NAMES: Record<Turn, string> = { 'flip-h': 'left ↔ right', 'flip-v': 'top ↕ bottom', 'rotate-180': 'under a half turn', 'rotate-cw': 'under a quarter turn', 'rotate-ccw': 'under a quarter turn' };
export function noChangeNote(name: string, turn: Turn): string {
  return `No visible change: "${name}" is symmetric ${TURN_NAMES[turn]}. Try it on a shape that is not.`;
}

