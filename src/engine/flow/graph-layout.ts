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

export interface NodeRect { x: number; y: number; width: number; height: number }

/** Bounding box in flow coordinates using measured dimensions when available. */
export function nodeRect(node: GraphNode, measured?: Map<string, { width: number; height: number }>): NodeRect {
  const m = measured?.get(node.id);
  return { x: node.position.x, y: node.position.y, width: m?.width ?? nodeWidth(node.data), height: m?.height ?? estimatedHeight(node.data) };
}

/** Whether two rectangles intersect when padded by `(gapX, gapY)`. */
export function rectsOverlap(a: NodeRect, b: NodeRect, gapX = 0, gapY = 0): boolean {
  return a.x < b.x + b.width + gapX && a.x + a.width + gapX > b.x && a.y < b.y + b.height + gapY && a.y + a.height + gapY > b.y;
}

/** Pick the closest non-overlapping flow position starting from `desired` (searching outward in a grid). */
export function findFreePosition(
  desired: { x: number; y: number },
  size: { width: number; height: number },
  occupied: readonly NodeRect[],
  opts?: { gapX?: number; gapY?: number },
): { x: number; y: number } {
  const gapX = opts?.gapX ?? 48;
  const gapY = opts?.gapY ?? 56;
  const clear = (x: number, y: number) => {
    const r: NodeRect = { x, y, width: size.width, height: size.height };
    return !occupied.some((o) => rectsOverlap(r, o, gapX, gapY));
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
  offsets.sort((a, b) => a.dist - b.dist);
  for (const { dx, dy } of offsets) {
    const x = desired.x + dx;
    const y = desired.y + dy;
    if (clear(x, y)) return { x, y };
  }
  const bottom = occupied.reduce((m, o) => Math.max(m, o.y + o.height), desired.y);
  return { x: desired.x, y: bottom + gapY };
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
