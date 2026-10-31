import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

export interface Pt { x: number; y: number }

/** True when segment a–b crosses segment c–d (touching counts). */
export function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const side = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = side(c, d, a), d2 = side(c, d, b), d3 = side(a, b, c), d4 = side(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0) || d1 === 0 || d2 === 0) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0) || d3 === 0 || d4 === 0)
    && Math.max(a.x, b.x) >= Math.min(c.x, d.x) && Math.max(c.x, d.x) >= Math.min(a.x, b.x)
    && Math.max(a.y, b.y) >= Math.min(c.y, d.y) && Math.max(c.y, d.y) >= Math.min(a.y, b.y);
}

/** The connections a cut trail crosses: each connection is a polyline sampled along its curve. */
export function trailCuts(trail: Pt[], lines: Array<{ id: string; points: Pt[] }>): string[] {
  return lines.filter(({ points }) => {
    for (let i = 1; i < trail.length; i++) for (let j = 1; j < points.length; j++) if (segmentsCross(trail[i - 1], trail[i], points[j - 1], points[j])) return true;
    return false;
  }).map((l) => l.id);
}

const SAMPLES = 48;
/** Every drawn connection as points in the canvas box's coordinates (sampled once, when the cut starts). */
function sampleEdges(canvas: HTMLElement): Array<{ id: string; points: Pt[] }> {
  const box = canvas.getBoundingClientRect();
  return [...canvas.querySelectorAll<SVGGElement>('.react-flow__edge[data-id]')].flatMap((g) => {
    const path = g.querySelector<SVGPathElement>('path.react-flow__edge-path');
    const m = path?.getScreenCTM?.();
    if (!path || !m || typeof path.getTotalLength !== 'function') return [];
    const length = path.getTotalLength();
    const points = Array.from({ length: SAMPLES + 1 }, (_, i) => {
      const q = path.getPointAtLength((length * i) / SAMPLES);
      const p = new DOMPoint(q.x, q.y).matrixTransform(m);
      return { x: p.x - box.left, y: p.y - box.top };
    });
    return [{ id: g.dataset.id!, points }];
  });
}

/** Cut tool (2026-10-31): a left drag on the empty canvas draws a trail; the connections it crosses light up and are
 *  cut on release (one undo step). Middle or right drag still pans. */
export function useCutTool({ active, canvasRef, onCut }: { active: boolean; canvasRef: RefObject<HTMLDivElement | null>; onCut: (ids: string[]) => void }) {
  const [trail, setTrail] = useState<Pt[] | null>(null);
  const lines = useRef<Array<{ id: string; points: Pt[] }>>([]);
  const hits = useRef<string[]>([]);
  const mark = (ids: string[]) => {
    const canvas = canvasRef.current;
    canvas?.querySelectorAll('.react-flow__edge.is-cut-hit').forEach((el) => el.classList.remove('is-cut-hit'));
    for (const id of ids) canvas?.querySelector(`.react-flow__edge[data-id="${CSS.escape(id)}"]`)?.classList.add('is-cut-hit');
    hits.current = ids;
  };
  const at = (e: ReactPointerEvent<HTMLDivElement>): Pt => { const r = e.currentTarget.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!active || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (!target.closest('.react-flow__pane, .react-flow__edge') || target.closest('.react-flow__node, .react-flow__panel')) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    lines.current = canvasRef.current ? sampleEdges(canvasRef.current) : [];
    setTrail([at(e)]);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!trail) return;
    e.stopPropagation();
    const next = [...trail, at(e)];
    setTrail(next);
    mark(trailCuts(next, lines.current));
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!trail) return;
    e.stopPropagation();
    const ids = hits.current;
    mark([]);
    setTrail(null);
    if (ids.length) onCut(ids);
  };
  const overlay = trail && trail.length > 1
    ? <svg className="cut-trail" aria-hidden><polyline points={trail.map((p) => `${p.x},${p.y}`).join(' ')} /></svg>
    : null;
  return { down, move, up, cutting: trail !== null, overlay };
}
