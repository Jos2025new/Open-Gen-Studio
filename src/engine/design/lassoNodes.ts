import { nodeSegs, type Pt, type Seg } from './pathNodes';

/** Even-odd point-in-polygon (ray casting). */
export function pointInPolygon(p: Pt, polygon: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Node indices (nodeSegs order, as the node tool selects them) whose position lies inside the lasso polygon. */
export function nodesInLasso(path: Seg[], polygon: Pt[]): number[] {
  if (polygon.length < 3) return [];
  return nodeSegs(path).seg.flatMap((si, n) => {
    const s = path[si];
    return pointInPolygon(s.p[s.p.length - 1], polygon) ? [n] : [];
  });
}
