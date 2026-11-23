import { isOmniSpace } from '../nodes/omniSpaces';
import type { GraphEdge, GraphNode, GraphNodeData } from '../types';

/* Node editor layout: sizes, rectangles, free-position search and auto layout. */

export const NODE_WIDTH = 260;

/** Width in flow coordinates for a node (matches RefNode / omni cards). */
export function nodeWidth(data: GraphNodeData): number {
  if (data.kind === 'ref') {
    if (data.type === 'chat') return 440;
    if (data.type === 'space' && isOmniSpace(data.ref)) return 320;
  }
  return NODE_WIDTH;
}

export function estimatedHeight(data: GraphNodeData): number {
  switch (data.kind) {
    // Media-first cards: a preview (or the text) plus the label above it; controls float outside.
    case 'text':
      return 170;
    case 'ref':
      if (data.type === 'chat') return 560;
      if (data.type === 'space' && isOmniSpace(data.ref)) return 360;
      return 220;
    case 'image':
    case 'model3d':
    case 'video':
    case 'audio':
    case 'tool':
    case 'asset':
      return 220;
  }
}

/** `panel`: the floating composer zone under the card when it has one (see `panelZone`); set by `nodeRect`, never part of the card box. */
export interface NodeRect { x: number; y: number; width: number; height: number; panel?: NodeRect | null }

/** Bounding box in flow coordinates using measured dimensions when available. */
export function nodeRect(node: GraphNode, measured?: Map<string, { width: number; height: number }>): NodeRect {
  const m = measured?.get(node.id);
  const rect: NodeRect = { x: node.position.x, y: node.position.y, width: m?.width ?? nodeWidth(node.data), height: m?.height ?? estimatedHeight(node.data) };
  const panel = panelZone(node.data, rect);
  return panel ? { ...rect, panel } : rect;
}

/** Whether two rectangles intersect when padded by `(gapX, gapY)`. */
export function rectsOverlap(a: NodeRect, b: NodeRect, gapX = 0, gapY = 0): boolean {
  return a.x < b.x + b.width + gapX && a.x + a.width + gapX > b.x && a.y < b.y + b.height + gapY && a.y + a.height + gapY > b.y;
}

/** Pick the closest non-overlapping flow position starting from `desired` (searching outward in a grid).
 *  Existing cards bring their floating composer panel (`NodeRect.panel`): the new card keeps clear of it. `opts.panel` is the new
 *  card's own panel (`panelZone` of a card at 0,0): it keeps clear of existing cards (no gap beyond the panel itself); panels never
 *  collide with panels, since only the selected card shows one. Both callers share this single mechanism. */
export function findFreePosition(
  desired: { x: number; y: number },
  size: { width: number; height: number },
  occupied: readonly NodeRect[],
  opts?: { gapX?: number; gapY?: number; preferRight?: boolean; panel?: NodeRect | null },
): { x: number; y: number } {
  const gapX = opts?.gapX ?? 48;
  const gapY = opts?.gapY ?? 56;
  // A non-finite coordinate (an unmeasured pointer, an imported node) never reaches the result: the desired one falls to the origin, a broken rect is ignored.
  const finite = (n: number) => Number.isFinite(n);
  if (!finite(desired.x) || !finite(desired.y)) desired = { x: finite(desired.x) ? desired.x : 0, y: finite(desired.y) ? desired.y : 0 };
  occupied = occupied.filter((o) => finite(o.x) && finite(o.y) && finite(o.width) && finite(o.height));
  const panels = occupied.flatMap((o) => (o.panel ? [o.panel] : [])).filter((p) => finite(p.x) && finite(p.y) && finite(p.width) && finite(p.height));
  const own = opts?.panel ?? null;
  const clear = (x: number, y: number) => {
    const r: NodeRect = { x, y, width: size.width, height: size.height };
    if (occupied.some((o) => rectsOverlap(r, o, gapX, gapY)) || panels.some((p) => rectsOverlap(r, p))) return false;
    return !own || !occupied.some((o) => rectsOverlap({ ...own, x: x + own.x, y: y + own.y }, o));
  };
  if (clear(desired.x, desired.y)) return desired;
  const stepX = size.width + gapX;
  const stepY = size.height + gapY;
  // Ordered rings around desired so the node lands at the nearest clear slot without covering headers or composers.
  const offsets: Array<{ dx: number; dy: number; dist: number }> = [];
  const maxRing = 8;
  for (let r = 1; r <= maxRing; r++) {
    for (let gx = -r; gx <= r; gx++) {
      for (let gy = -r; gy <= r; gy++) {
        if (Math.max(Math.abs(gx), Math.abs(gy)) !== r) continue;
        const dx = gx * stepX;
        const dy = gy * stepY;
        offsets.push({ dx, dy, dist: dx * dx + dy * dy });
      }
    }
  }
  offsets.sort((a, b) => a.dist - b.dist || (opts?.preferRight ? b.dx - a.dx : 0));
  for (const { dx, dy } of offsets) {
    const x = desired.x + dx;
    const y = desired.y + dy;
    if (clear(x, y)) return { x, y };
  }
  const bottom = occupied.reduce((m, o) => Math.max(m, o.y + o.height), desired.y);
  return { x: desired.x, y: bottom + gapY };
}

/** Image, video, audio, 3D and tool cards open a composer panel under the card while selected (400 px wide, 12 px below). It is
 *  not part of the card, so a neighbour placed under the card at the usual gap sat beneath it. The height is the panel at its
 *  tallest common size: .nt-prompt grown to its 13.75rem max (220) + padding 2×12 + border 2 + gap 10 + the model row (~44). */
const PANEL = { width: 400, gap: 12, height: 300 };

export function panelZone(data: GraphNodeData, card: NodeRect): NodeRect | null {
  if (data.kind === 'text' || data.kind === 'asset' || data.kind === 'ref') return null;
  return { x: card.x + card.width / 2 - PANEL.width / 2, y: card.y + card.height + PANEL.gap, width: PANEL.width, height: PANEL.height };
}

/** `findFreePosition` for a node about to be added: the spot also leaves the node's composer panel clear of other cards (see `findFreePosition`). */
export function findFreePositionFor(
  data: GraphNodeData,
  desired: { x: number; y: number },
  occupied: readonly NodeRect[],
  opts?: { gapX?: number; gapY?: number; width?: number; preferRight?: boolean },
): { x: number; y: number } {
  const width = opts?.width ?? nodeWidth(data);
  const height = estimatedHeight(data);
  const panel = panelZone(data, { x: 0, y: 0, width, height });
  return findFreePosition(desired, { width, height }, occupied, { gapX: opts?.gapX, gapY: opts?.gapY, preferRight: opts?.preferRight, panel });
}

/** Nodes whose size is known only now (first measurement) move off the nodes they stack on. Placement before the
 *  measurement works with estimated sizes, which are smaller than the cards, so new nodes landed on each other.
 *  `fresh`: ids measured for the first time. Returns new positions for those that overlap; the rest stay put. */
export function settleFresh(nodes: readonly GraphNode[], fresh: ReadonlySet<string>, measured: Map<string, { width: number; height: number }>): Map<string, { x: number; y: number }> {
  const moves = new Map<string, { x: number; y: number }>();
  const occupied: NodeRect[] = nodes.filter((n) => !fresh.has(n.id)).map((n) => nodeRect(n, measured));
  for (const n of nodes) {
    if (!fresh.has(n.id)) continue;
    const r = nodeRect(n, measured);
    if (occupied.some((o) => rectsOverlap(r, o, 48, 56))) {
      const at = findFreePosition(n.position, { width: r.width, height: r.height }, occupied, { gapX: 48, gapY: 56 });
      moves.set(n.id, at);
      occupied.push({ ...r, x: at.x, y: at.y });
    } else {
      occupied.push(r);
    }
  }
  return moves;
}

/** Layered left-to-right layout by dependency depth. Returns new positions for the given node ids. */
export function autoLayout(nodes: GraphNode[], edges: GraphEdge[], origin = { x: 0, y: 0 }): Map<string, { x: number; y: number }> {
  const ids = new Set(nodes.map((n) => n.id));
  const incoming = new Map<string, string[]>();
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    incoming.set(e.target, [...(incoming.get(e.target) ?? []), e.source]);
  }
  const depth = new Map<string, number>();
  const dfs = (id: string, trail: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (trail.has(id)) return 0;
    trail.add(id);
    const d = Math.max(-1, ...(incoming.get(id) ?? []).map((s) => dfs(s, trail))) + 1;
    trail.delete(id);
    depth.set(id, d);
    return d;
  };
  nodes.forEach((n) => dfs(n.id, new Set()));
  const columns = new Map<number, GraphNode[]>();
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    columns.set(d, [...(columns.get(d) ?? []), n]);
  }
  const gapX = 90;
  const gapY = 56;
  const heights = [...columns.values()].map((col) => col.reduce((h, n) => h + estimatedHeight(n.data) + gapY, -gapY));
  const tallest = Math.max(0, ...heights);
  const out = new Map<string, { x: number; y: number }>();
  let colX = origin.x;
  [...columns.entries()]
    .sort((a, b) => a[0] - b[0])
    .forEach(([, col]) => {
      // Keep sibling order stable by the average position of their parents.
      col.sort((a, b) => avgParent(a.id) - avgParent(b.id));
      const colH = col.reduce((h, n) => h + estimatedHeight(n.data) + gapY, -gapY);
      const colW = col.reduce((w, n) => Math.max(w, nodeWidth(n.data)), NODE_WIDTH);
      let y = origin.y + (tallest - colH) / 2;
      for (const n of col) {
        out.set(n.id, { x: colX, y });
        y += estimatedHeight(n.data) + gapY;
      }
      colX += colW + gapX;
    });
  return out;

  function avgParent(id: string): number {
    const ps = incoming.get(id) ?? [];
    if (!ps.length) return nodes.findIndex((n) => n.id === id);
    return ps.reduce((s, p) => s + (out.get(p)?.y ?? 0), 0) / ps.length;
  }
}

/** Bounding box of existing nodes (to place new flows beside them). */
export function graphBounds(nodes: GraphNode[]): { x: number; y: number; w: number; h: number } | null {
  if (!nodes.length) return null;
  const x0 = Math.min(...nodes.map((n) => n.position.x));
  const y0 = Math.min(...nodes.map((n) => n.position.y));
  const x1 = Math.max(...nodes.map((n) => n.position.x + NODE_WIDTH));
  const y1 = Math.max(...nodes.map((n) => n.position.y + estimatedHeight(n.data)));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
