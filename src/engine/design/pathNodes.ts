import type { ShapeSpec } from '../types';
import { mapPathShape, parsePath } from './path';

/*
 * Node editing of a path shape (Inkscape's Node tool, N): every segment end is a node; a cubic's two control points
 * are the handles of the nodes on each side (quadratics are read as the same cubic). Dragging a node carries its
 * handles; dragging a handle moves only it (a cusp node). The path is edited in page coordinates and written back
 * as a plain path whose own box is where it sits (path.ts mapPathShape), so it moves, scales and exports as before.
 */

type Pt = [number, number];
/** One absolute command; S, Q and T become C (Inkscape edits every curve as a cubic), so every control point drags. */
export interface Seg { c: 'M' | 'L' | 'C' | 'Z'; p: Pt[] }
/** A draggable point: a node (segment end) or a handle (control point `k` of segment `seg`). */
export interface NodePoint { kind: 'node' | 'handle'; seg: number; k: number; at: Pt; /** handle: the node it hangs from */ from?: Pt }

/** Toggle a node in the current selection, keeping a stable drawing order. */
export function toggleNodeSelection(selected: number[], node: number): number[] {
  return selected.includes(node) ? selected.filter((n) => n !== node) : [...selected, node].sort((a, b) => a - b);
}

/** Apply a node-tool marquee. Ctrl selects outside; Shift adds; Ctrl+Shift removes. */
export function marqueeNodeSelection(selected: number[], nodes: Pt[], bounds: { left: number; top: number; right: number; bottom: number }, mods: { shift: boolean; ctrl: boolean }): number[] {
  const inside = nodes.flatMap(([x, y], i) => x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom ? [i] : []);
  if (mods.ctrl && mods.shift) return selected.filter((n) => !inside.includes(n));
  const hits = mods.ctrl ? nodes.map((_, i) => i).filter((i) => !inside.includes(i)) : inside;
  if (mods.shift) return [...new Set([...selected, ...hits])].sort((a, b) => a - b);
  return hits;
}

/** Move a group from its original geometry; callers write the resulting shape once per pointer frame. */
export function moveSelectedNodes(segs: Seg[], selected: number[], dx: number, dy: number, types?: NodeType[]): Seg[] {
  const indices = nodeSegs(segs).seg;
  return [...new Set(selected)].sort((a, b) => a - b).reduce((out, n) => {
    const seg = indices[n];
    return seg == null ? out : moveNodePoint(out, { kind: 'node', seg, k: segs[seg]?.c === 'M' ? 0 : segs[seg]?.p.length - 1 }, dx, dy, types);
  }, segs);
}

/** Delete the picked nodes as one geometry change; a path's final node and its type are preserved by deleteNode. */
export function deleteSelectedNodes(segs: Seg[], types: NodeType[], selected: number[], mode: 'auto' | 'line' = 'auto'): { segs: Seg[]; types: NodeType[] } | null {
  let out = segs, nextTypes = types, origins = nodeSegs(segs).seg.map((_, i) => i);
  for (const original of [...new Set(selected)].sort((a, b) => b - a)) {
    const n = origins.indexOf(original);
    if (n < 0) continue;
    const subpath = nodeSegs(out).subpaths.find((sp) => n >= sp.from && n < sp.to);
    const changed = deleteNode(out, nextTypes, n, mode);
    if (changed) {
      const removed = subpath && subpath.to - subpath.from <= 2
        ? new Set(origins.slice(subpath.from, subpath.to))
        : new Set([original]);
      origins = origins.filter((id) => !removed.has(id));
      out = changed.segs; nextTypes = changed.types;
    }
  }
  return out === segs ? null : { segs: out, types: nextTypes };
}

const ARGS: Record<string, number> = { M: 2, L: 2, T: 2, C: 6, S: 4, Q: 4, Z: 0 };

export function parseSegs(d: string): Seg[] {
  const t = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const out: Seg[] = [];
  let i = 0, cmd = '', cur: Pt = [0, 0], start: Pt = [0, 0], prevCtrl: Pt | null = null, prevKind = '';
  while (i < t.length) {
    if (/[A-Za-z]/.test(t[i])) { cmd = t[i++]; if (cmd === 'Z') { out.push({ c: 'Z', p: [] }); cur = start; prevKind = 'Z'; continue; } }
    const n = ARGS[cmd] ?? 0;
    if (!n) break;
    const v = t.slice(i, i + n).map(Number), pts: Pt[] = [];
    for (let k = 0; k < n; k += 2) pts.push([v[k], v[k + 1]]);
    i += n;
    const refl = (c: Pt | null): Pt => (c ? [2 * cur[0] - c[0], 2 * cur[1] - c[1]] : cur);
    if (cmd === 'M') { out.push({ c: 'M', p: pts }); start = pts[0]; cmd = 'L'; prevCtrl = null; }
    else if (cmd === 'L') { out.push({ c: 'L', p: pts }); prevCtrl = null; }
    else if (cmd === 'C') { out.push({ c: 'C', p: pts }); prevCtrl = pts[1]; }
    else if (cmd === 'S') { const c1 = refl(prevKind === 'C' ? prevCtrl : null); out.push({ c: 'C', p: [c1, ...pts] }); prevCtrl = pts[0]; cmd = 'S'; }
    else if (cmd === 'Q' || cmd === 'T') {
      // Quadratics become the same cubic (exact degree elevation), as Inkscape edits every curve: each end gets
      // its own handle, so moving a node carries its handle like any other.
      const q: Pt = cmd === 'Q' ? pts[0] : refl(prevKind === 'Q' ? prevCtrl : null), end = pts[pts.length - 1];
      out.push({ c: 'C', p: [[cur[0] + (2 / 3) * (q[0] - cur[0]), cur[1] + (2 / 3) * (q[1] - cur[1])], [end[0] + (2 / 3) * (q[0] - end[0]), end[1] + (2 / 3) * (q[1] - end[1])], end] });
      prevCtrl = q;
    }
    prevKind = cmd === 'Q' || cmd === 'T' ? 'Q' : out[out.length - 1].c;
    cur = pts[pts.length - 1];
  }
  return out;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
export function serializeSegs(segs: Seg[]): string {
  return segs.map((s) => [s.c, ...s.p.flatMap(([x, y]) => [r2(x), r2(y)])].join(' ')).join(' ');
}

/** The path's segments in page coordinates. */
export function pageSegs(s: ShapeSpec): Seg[] {
  return parseSegs(mapPathShape(s, (x, y) => [x, y]).d ?? '');
}

/** Nodes and handles to draw and drag (handles hang from the node they shape). */
export function nodePoints(segs: Seg[]): NodePoint[] {
  const out: NodePoint[] = [];
  let prevEnd: Pt | null = null;
  segs.forEach((s, i) => {
    if (s.c === 'Z' || !s.p.length) return;
    const end = s.p[s.p.length - 1];
    if (s.c === 'C') {
      if (prevEnd) out.push({ kind: 'handle', seg: i, k: 0, at: s.p[0], from: prevEnd });
      out.push({ kind: 'handle', seg: i, k: 1, at: s.p[1], from: end });
    }
    // A closing segment that lands on its subpath's start is the same node: drawn once (the M).
    if (!(closesOnStart(segs, i))) out.push({ kind: 'node', seg: i, k: s.p.length - 1, at: end });
    prevEnd = end;
  });
  return out;
}

/** The M that starts the subpath segment `i` belongs to. */
function subpathStart(segs: Seg[], i: number): number {
  for (let j = i; j >= 0; j--) if (segs[j].c === 'M') return j;
  return 0;
}
/** Segment `i` ends where its subpath began and a Z follows: the closing duplicate of the start node. */
function closesOnStart(segs: Seg[], i: number): boolean {
  if (segs[i + 1]?.c !== 'Z' || segs[i].c === 'M') return false;
  const a = segs[i].p[segs[i].p.length - 1], b = segs[subpathStart(segs, i)].p[0];
  return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
}

/** Move one node or handle by (dx, dy). A node carries its handles (and its closing twin on a closed subpath). */
export function moveNodePoint(segs: Seg[], pt: Pick<NodePoint, 'kind' | 'seg' | 'k'>, dx: number, dy: number, types?: NodeType[]): Seg[] {
  const out = segs.map((s) => ({ c: s.c, p: s.p.map((q) => [...q] as Pt) }));
  const shift = (i: number, k: number) => { const q = out[i]?.p[k]; if (q) { q[0] += dx; q[1] += dy; } };
  if (pt.kind === 'handle') {
    shift(pt.seg, pt.k);
    // A smooth node keeps its other handle in line (its own length); a symmetric one mirrors it (Inkscape).
    const node = handleNode(segs, pt.seg, pt.k), type = node != null ? types?.[node] : undefined;
    if (node != null && (type === 's' || type === 'z')) {
      const h = nodeHandles(segs, node), mine = pt.seg === h.in?.[0] && pt.k === h.in?.[1] ? h.in : h.out, other = mine === h.in ? h.out : h.in;
      if (mine && other) {
        const at = nodeAt(out, node), m = out[mine[0]].p[mine[1]], o = out[other[0]].p[other[1]];
        const dm = Math.hypot(m[0] - at[0], m[1] - at[1]);
        if (dm > 1e-9) {
          const len = type === 'z' ? dm : Math.hypot(o[0] - at[0], o[1] - at[1]);
          o[0] = at[0] - ((m[0] - at[0]) / dm) * len; o[1] = at[1] - ((m[1] - at[1]) / dm) * len;
        }
      }
    }
    return out;
  }
  const carry = (i: number) => {
    const s = out[i];
    shift(i, s.p.length - 1);
    if (s.c === 'C') shift(i, 1);
    if (out[i + 1]?.c === 'C') shift(i + 1, 0);
  };
  carry(pt.seg);
  // The start of a closed subpath: its closing twin (and the handle into it) move too.
  if (out[pt.seg].c === 'M') {
    for (let j = pt.seg + 1; j < out.length && out[j].c !== 'M'; j++) if (closesOnStart(segs, j)) { const s = out[j]; shift(j, s.p.length - 1); if (s.c === 'C') shift(j, 1); }
  }
  return out;
}

/** The shape with these segments (page coordinates): a plain path whose own box is where it sits. */
export function withSegs<T extends ShapeSpec>(s: T, segs: Seg[]): T {
  // A turned path (rot about its box centre): editing a node moves the centre, which would shift every other node on
  // the page. Shifting the own coordinates by t = (L − I)(C′ − C) keeps every untouched node exactly where it was.
  if (s.rot) {
    const r0 = parsePath(serializeSegs(segs));
    if (!('error' in r0)) {
      const [a, b, c, dd] = s.rot, C = [s.x + s.w / 2, s.y + s.h / 2], C2 = [r0.box.x + r0.box.w / 2, r0.box.y + r0.box.h / 2];
      const ex = C2[0] - C[0], ey = C2[1] - C[1], tx = (a - 1) * ex + c * ey, ty = b * ex + (dd - 1) * ey;
      segs = segs.map((g) => ({ c: g.c, p: g.p.map(([x, y]) => [x + tx, y + ty] as Pt) }));
    }
  }
  const d = serializeSegs(segs), r = parsePath(d);
  if ('error' in r) return s;
  const box = { x: r.box.x, y: r.box.y, w: Math.max(1, r.box.w), h: Math.max(1, r.box.h) };
  return { ...s, d, box0: box, ...box };
}

/*
 * Node types (Inkscape's Node tool: Shift+C cusp, Shift+S smooth, Shift+Y symmetric), stored as Inkscape stores them
 * in sodipodi:nodetypes (path-manipulator.cpp _createTypeString, L1642–1654): one letter per node and subpath, and on
 * a closed subpath the first node's letter once more at the end. Missing or unknown letters read as cusp; Inkscape's
 * 'a' (auto) reads as smooth.
 */
export type NodeType = 'c' | 's' | 'z';

/** The segment each node ends (in node order, closing twins left out), and the subpaths' node ranges. */
export function nodeSegs(segs: Seg[]): { seg: number[]; subpaths: Array<{ from: number; to: number; closed: boolean }> } {
  const seg: number[] = [], subpaths: Array<{ from: number; to: number; closed: boolean }> = [];
  segs.forEach((g, i) => {
    if (g.c === 'M') subpaths.push({ from: seg.length, to: seg.length, closed: false });
    if (g.c === 'Z') { if (subpaths.length) subpaths[subpaths.length - 1].closed = true; return; }
    if (!closesOnStart(segs, i)) { seg.push(i); if (subpaths.length) subpaths[subpaths.length - 1].to = seg.length; }
  });
  return { seg, subpaths };
}

export function readTypes(segs: Seg[], s?: string): NodeType[] {
  const { seg, subpaths } = nodeSegs(segs), out: NodeType[] = [];
  let i = 0;
  for (const sp of subpaths) {
    for (let n = sp.from; n < sp.to; n++) { const ch = s?.[i++]; out.push(ch === 's' || ch === 'a' ? 's' : ch === 'z' ? 'z' : 'c'); }
    if (sp.closed) i++;
  }
  return out.length === seg.length ? out : seg.map(() => 'c');
}

export function writeTypes(segs: Seg[], types: NodeType[]): string {
  return nodeSegs(segs).subpaths.map((sp) => types.slice(sp.from, sp.to).join('') + (sp.closed ? types[sp.from] ?? 'c' : '')).join('');
}

/** Where node `n` sits. */
function nodeAt(segs: Seg[], n: number): Pt {
  const i = nodeSegs(segs).seg[n], g = segs[i];
  return g.p[g.p.length - 1];
}

/** A node's two handles as [segment, point]: in (end of the curve into it) and out (start of the curve out). */
export function nodeHandles(segs: Seg[], n: number): { in?: [number, number]; out?: [number, number] } {
  const i = nodeSegs(segs).seg[n], out: { in?: [number, number]; out?: [number, number] } = {};
  if (segs[i].c === 'C') out.in = [i, 1];
  if (segs[i].c === 'M') { for (let j = i + 1; j < segs.length && segs[j].c !== 'M'; j++) if (closesOnStart(segs, j) && segs[j].c === 'C') out.in = [j, 1]; }
  if (segs[i + 1]?.c === 'C') out.out = [i + 1, 0];
  return out;
}

/** The node a handle hangs from. */
function handleNode(segs: Seg[], i: number, k: number): number | null {
  const ns = nodeSegs(segs).seg;
  let j = k === 1 ? i : i - 1;
  if (k === 1 && closesOnStart(segs, i)) j = subpathStart(segs, i);
  const n = ns.indexOf(j);
  return n < 0 ? null : n;
}

/** Make node `n` cusp, smooth (handles in line) or symmetric (in line and of equal length), as Inkscape does. */
export function setNodeType(segs: Seg[], n: number, type: NodeType): Seg[] {
  const out = segs.map((g) => ({ c: g.c, p: g.p.map((q) => [...q] as Pt) }));
  if (type === 'c') return out;
  const h = nodeHandles(out, n);
  if (!h.in || !h.out) return out;
  const at = nodeAt(out, n), a = out[h.in[0]].p[h.in[1]], b = out[h.out[0]].p[h.out[1]];
  const la = Math.hypot(a[0] - at[0], a[1] - at[1]), lb = Math.hypot(b[0] - at[0], b[1] - at[1]);
  // The line through the node: from the in handle to the out handle.
  let dx = b[0] - a[0], dy = b[1] - a[1];
  const d = Math.hypot(dx, dy);
  if (d < 1e-9) return out;
  dx /= d; dy /= d;
  const len = type === 'z' ? (la + lb) / 2 : 0;
  a[0] = at[0] - dx * (len || la); a[1] = at[1] - dy * (len || la);
  b[0] = at[0] + dx * (len || lb); b[1] = at[1] + dy * (len || lb);
  return out;
}

/*
 * Adding and deleting nodes (Inkscape: double-click a segment adds one; Delete removes the picked one). Each subpath
 * is read as its nodes and the edges between them (a closed one's last edge comes back to its first node), edited,
 * and written back; node types move with their nodes.
 */
interface Edge { c: 'L' | 'C'; c1?: Pt; c2?: Pt }
interface Sub { nodes: Pt[]; edges: Edge[]; closed: boolean }

function toSubs(segs: Seg[]): Sub[] {
  const subs: Sub[] = [];
  let cur: Sub | null = null;
  for (const g of segs) {
    if (g.c === 'M') { cur = { nodes: [g.p[0]], edges: [], closed: false }; subs.push(cur); continue; }
    if (!cur) continue;
    if (g.c === 'Z') {
      const last = cur.nodes[cur.nodes.length - 1], first = cur.nodes[0];
      // The closing twin (an edge that already landed on the start) is that edge back, not a new node.
      if (cur.nodes.length > 1 && Math.abs(last[0] - first[0]) < 1e-6 && Math.abs(last[1] - first[1]) < 1e-6) cur.nodes.pop();
      else cur.edges.push({ c: 'L' });
      cur.closed = true;
      continue;
    }
    cur.edges.push(g.c === 'C' ? { c: 'C', c1: g.p[0], c2: g.p[1] } : { c: 'L' });
    cur.nodes.push(g.p[g.p.length - 1]);
  }
  return subs;
}

function fromSubs(subs: Sub[]): Seg[] {
  const out: Seg[] = [];
  for (const s of subs) {
    out.push({ c: 'M', p: [s.nodes[0]] });
    s.edges.forEach((e, k) => {
      const to = s.nodes[(k + 1) % s.nodes.length];
      out.push(e.c === 'C' ? { c: 'C', p: [e.c1!, e.c2!, to] } : { c: 'L', p: [to] });
    });
    if (s.closed) out.push({ c: 'Z', p: [] });
  }
  return out;
}

const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
function edgePoint(a: Pt, e: Edge, b: Pt, t: number): Pt {
  if (e.c === 'L') return lerp(a, b, t);
  const p = lerp(lerp(lerp(a, e.c1!, t), lerp(e.c1!, e.c2!, t), t), lerp(lerp(e.c1!, e.c2!, t), lerp(e.c2!, b, t), t), t);
  return p;
}

/** The nearest point of the outline to `p`: which edge, where on it (t) and how far. */
export function nearestOnPath(segs: Seg[], p: Pt): { sub: number; edge: number; t: number; dist: number } | null {
  let best: { sub: number; edge: number; t: number; dist: number } | null = null;
  toSubs(segs).forEach((s, si) => s.edges.forEach((e, k) => {
    const a = s.nodes[k], b = s.nodes[(k + 1) % s.nodes.length];
    let bt = 0, bd = Infinity;
    for (let i = 0; i <= 64; i++) { const q = edgePoint(a, e, b, i / 64), d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; bt = i / 64; } }
    // Refine around the best sample.
    for (let step = 1 / 128; step > 1e-5; step /= 2) for (const t of [bt - step, bt + step]) { if (t < 0 || t > 1) continue; const q = edgePoint(a, e, b, t), d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; bt = t; } }
    if (!best || bd < best.dist) best = { sub: si, edge: k, t: bt, dist: bd };
  }));
  return best;
}

/** Global node index of node `j` of subpath `si`. */
function globalIndex(subs: Sub[], si: number, j: number): number {
  return subs.slice(0, si).reduce((n, s) => n + s.nodes.length, 0) + j;
}

/** Add a node on edge `edge` of subpath `sub` at `t`: the outline stays the same (De Casteljau for curves). */
export function insertNode(segs: Seg[], types: NodeType[], at: { sub: number; edge: number; t: number }): { segs: Seg[]; types: NodeType[]; node: number } {
  const subs = toSubs(segs), s = subs[at.sub], k = at.edge, e = s.edges[k], a = s.nodes[k], b = s.nodes[(k + 1) % s.nodes.length], t = at.t;
  let mid: Pt, left: Edge, right: Edge;
  if (e.c === 'L') { mid = lerp(a, b, t); left = { c: 'L' }; right = { c: 'L' }; }
  else {
    const p01 = lerp(a, e.c1!, t), p12 = lerp(e.c1!, e.c2!, t), p23 = lerp(e.c2!, b, t), p012 = lerp(p01, p12, t), p123 = lerp(p12, p23, t);
    mid = lerp(p012, p123, t); left = { c: 'C', c1: p01, c2: p012 }; right = { c: 'C', c1: p123, c2: p23 };
  }
  s.nodes.splice(k + 1, 0, mid);
  s.edges.splice(k, 1, left, right);
  const node = globalIndex(subs, at.sub, k + 1), out = [...types];
  // A node added on a curve keeps it smooth there; on a straight line it is a cusp.
  out.splice(node, 0, e.c === 'C' ? 's' : 'c');
  return { segs: fromSubs(subs), types: out, node };
}

/**
 * Delete node `n`, as Inkscape (path-manipulator.cpp L812–907): Delete ('auto') keeps the shape of a smooth or
 * symmetric node, fitting one cubic to the old curve with the neighbours' outer handle directions fixed; a cusp
 * node, or Ctrl+Delete ('line'), joins its neighbours plainly ('line': a straight segment). Null when it would leave
 * the path without a drawable subpath (the last node of the last subpath).
 */
export function deleteNode(segs: Seg[], types: NodeType[], n: number, mode: 'auto' | 'line' = 'auto'): { segs: Seg[]; types: NodeType[] } | null {
  const subs = toSubs(segs);
  let si = 0, j = n;
  while (si < subs.length && j >= subs[si].nodes.length) { j -= subs[si].nodes.length; si++; }
  const s = subs[si];
  if (!s) return null;
  const m = s.nodes.length, outTypes = [...types];
  outTypes.splice(n, 1);
  if (m <= 2) {
    // A subpath of two nodes loses its last edge: it goes, unless it is the only one.
    if (subs.length === 1) return null;
    subs.splice(si, 1);
    outTypes.splice(globalIndex(subs.concat(), si, 0), m - 1);
    return { segs: fromSubs(subs), types: outTypes };
  }
  const join = (a: Pt, ein: Edge, mid: Pt, eout: Edge, b: Pt): Edge => joinEdges(a, ein, mid, eout, b, mode, types[n] ?? 'c');
  if (s.closed) {
    const kin = (j - 1 + m) % m;
    s.edges[kin] = join(s.nodes[kin], s.edges[kin], s.nodes[j], s.edges[j], s.nodes[(j + 1) % m]);
    s.edges.splice(j, 1);
    s.nodes.splice(j, 1);
    // Edge k still runs from node k to node k + 1 (the merged one closes back to the new first node when j is 0).
  } else if (j === 0) { s.nodes.shift(); s.edges.shift(); }
  else if (j === m - 1) { s.nodes.pop(); s.edges.pop(); }
  else {
    s.edges.splice(j - 1, 2, join(s.nodes[j - 1], s.edges[j - 1], s.nodes[j], s.edges[j], s.nodes[j + 1]));
    s.nodes.splice(j, 1);
  }
  return { segs: fromSubs(subs), types: outTypes };
}

/** The edge that replaces in-edge + out-edge around a deleted node. */
function joinEdges(a: Pt, ein: Edge, mid: Pt, eout: Edge, b: Pt, mode: 'auto' | 'line', type: NodeType): Edge {
  if (mode === 'line' || (ein.c === 'L' && eout.c === 'L')) return { c: 'L' };
  const plain: Edge = { c: 'C', c1: ein.c === 'C' ? ein.c1 : a, c2: eout.c === 'C' ? eout.c2 : b };
  if (type === 'c') return plain;
  // Inkscape samples the old curve 10 times per segment, uniformly in t, and keeps the end tangents.
  const pts: Pt[] = [];
  for (let i = 0; i <= 10; i++) pts.push(edgePoint(a, ein, mid, i / 10));
  for (let i = 1; i <= 10; i++) pts.push(edgePoint(mid, eout, b, i / 10));
  // The samples are uniform in t on each old edge: their parameters on the new curve start from that, with the
  // deleted node at the share of the length before it (far faster to settle than plain chord lengths).
  const len = (from: number, to: number) => { let l = 0; for (let i = from + 1; i <= to; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return l; };
  const tau = len(0, 10) / (len(0, 20) || 1);
  const u0 = pts.map((_, i) => (i <= 10 ? (tau * i) / 10 : tau + ((1 - tau) * (i - 10)) / 10));
  const fit = fitCubic(pts, plain.c1!, plain.c2!, u0);
  return fit ? { c: 'C', c1: fit[0], c2: fit[1] } : plain;
}

/**
 * One cubic through the first and last of `pts`, its end tangents along the given handles (a zero handle: the
 * direction of the samples there, as Inkscape's splinefit does). Handle lengths by least squares with chord-length
 * parameters and Newton reparameterization (Schneider; Inkscape's bezier-utils.cpp estimate_lengths, reparameterize),
 * repeated until the parameters settle. Returns the two control points, or null when there is nothing to fit.
 */
export function fitCubic(pts: Pt[], h1: Pt, h2: Pt, u0?: number[]): [Pt, Pt] | null {
  const n = pts.length, p0 = pts[0], p3 = pts[n - 1];
  if (n < 3) return null;
  const unit = (v: Pt): Pt | null => { const l = Math.hypot(v[0], v[1]); return l > 1e-9 ? [v[0] / l, v[1] / l] : null; };
  const t1 = unit([h1[0] - p0[0], h1[1] - p0[1]]) ?? unit([pts[1][0] - p0[0], pts[1][1] - p0[1]]);
  const t2 = unit([h2[0] - p3[0], h2[1] - p3[1]]) ?? unit([pts[n - 2][0] - p3[0], pts[n - 2][1] - p3[1]]);
  if (!t1 || !t2) return null;
  // Chord-length parameters, unless the caller knows better ones.
  const u = u0 && u0.length === n ? [...u0] : [0];
  if (!u0 || u0.length !== n) {
    for (let i = 1; i < n; i++) u.push(u[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = u[n - 1] || 1;
    for (let i = 0; i < n; i++) u[i] /= total;
  }
  const chord = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
  const at = (c1: Pt, c2: Pt, t: number): Pt => { const s = 1 - t; return [s * s * s * p0[0] + 3 * s * s * t * c1[0] + 3 * s * t * t * c2[0] + t * t * t * p3[0], s * s * s * p0[1] + 3 * s * s * t * c1[1] + 3 * s * t * t * c2[1] + t * t * t * p3[1]]; };
  const solve = (): [Pt, Pt] => {
    let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
    for (let i = 0; i < n; i++) {
      const t = u[i], s = 1 - t, b0 = s * s * s, b1 = 3 * s * s * t, b2 = 3 * s * t * t, b3 = t * t * t;
      const a1: Pt = [t1[0] * b1, t1[1] * b1], a2: Pt = [t2[0] * b2, t2[1] * b2];
      c00 += a1[0] * a1[0] + a1[1] * a1[1]; c01 += a1[0] * a2[0] + a1[1] * a2[1]; c11 += a2[0] * a2[0] + a2[1] * a2[1];
      const r: Pt = [pts[i][0] - (p0[0] * (b0 + b1) + p3[0] * (b2 + b3)), pts[i][1] - (p0[1] * (b0 + b1) + p3[1] * (b2 + b3))];
      x0 += a1[0] * r[0] + a1[1] * r[1]; x1 += a2[0] * r[0] + a2[1] * r[1];
    }
    const det = c00 * c11 - c01 * c01;
    let al = det ? (x0 * c11 - c01 * x1) / det : 0, ar = det ? (c00 * x1 - c01 * x0) / det : 0;
    // As bezier-utils.cpp: a degenerate or negative length falls back to a third of the chord.
    if (!(al > 1e-6) || !(ar > 1e-6)) { al = chord / 3; ar = chord / 3; }
    return [[p0[0] + t1[0] * al, p0[1] + t1[1] * al], [p3[0] + t2[0] * ar, p3[1] + t2[1] * ar]];
  };
  let c = solve();
  // Inkscape stops after 4 extra rounds (a handle ~2 % off on an exact cubic); the alternation converges slowly, so
  // it goes on until the handles settle (at most 5000 rounds of ~21 samples; only when a node is deleted).
  for (let it = 0, moved = 1; it < 5000 && moved > 1e-4; it++) {
    const prev = c;
    // Newton: each sample's parameter moves to its nearest point on the current curve.
    for (let i = 1; i < n - 1; i++) {
      const t = u[i], s = 1 - t, q = at(c[0], c[1], t);
      const d1: Pt = [3 * (s * s * (c[0][0] - p0[0]) + 2 * s * t * (c[1][0] - c[0][0]) + t * t * (p3[0] - c[1][0])), 3 * (s * s * (c[0][1] - p0[1]) + 2 * s * t * (c[1][1] - c[0][1]) + t * t * (p3[1] - c[1][1]))];
      const d2: Pt = [6 * (s * (c[1][0] - 2 * c[0][0] + p0[0]) + t * (p3[0] - 2 * c[1][0] + c[0][0])), 6 * (s * (c[1][1] - 2 * c[0][1] + p0[1]) + t * (p3[1] - 2 * c[1][1] + c[0][1]))];
      const num = (q[0] - pts[i][0]) * d1[0] + (q[1] - pts[i][1]) * d1[1], den = d1[0] * d1[0] + d1[1] * d1[1] + (q[0] - pts[i][0]) * d2[0] + (q[1] - pts[i][1]) * d2[1];
      if (den) u[i] = Math.min(1, Math.max(0, t - num / den));
    }
    c = solve();
    // Settled when the handles move less than 1e-4 page units a round (paths keep 2 decimals).
    moved = Math.max(Math.abs(c[0][0] - prev[0][0]), Math.abs(c[0][1] - prev[0][1]), Math.abs(c[1][0] - prev[1][0]), Math.abs(c[1][1] - prev[1][1]));
  }
  return c;
}

/**
 * Make the segments between selected neighbouring nodes straight or curved (Inkscape Shift+L / Shift+U,
 * path-manipulator.cpp L1015–1038): a line gets its handles onto its nodes; a curve is made only from a line, its
 * handles at a third of the segment from each end. A node that loses a handle to a line cannot stay smooth or
 * symmetric (node.cpp L203–239 changes the type when a handle retracts): here it becomes a cusp. Null if no segment
 * has both ends selected.
 */
export function segmentsTo(segs: Seg[], types: NodeType[], selected: number[], to: 'line' | 'curve'): { segs: Seg[]; types: NodeType[] } | null {
  const subs = toSubs(segs), sel = new Set(selected), out = [...types];
  let changed = false;
  subs.forEach((s, si) => {
    const base = globalIndex(subs, si, 0), m = s.nodes.length;
    s.edges.forEach((e, k) => {
      const a = base + k, b = base + ((k + 1) % m);
      if (!sel.has(a) || !sel.has(b)) return;
      if (to === 'line' && e.c === 'C') {
        s.edges[k] = { c: 'L' };
        for (const n of [a, b]) if (out[n] !== 'c') out[n] = 'c';
        changed = true;
      } else if (to === 'curve' && e.c === 'L') {
        const p = s.nodes[k], q = s.nodes[(k + 1) % m], dx = (q[0] - p[0]) / 3, dy = (q[1] - p[1]) / 3;
        s.edges[k] = { c: 'C', c1: [p[0] + dx, p[1] + dy], c2: [q[0] - dx, q[1] - dy] };
        changed = true;
      }
    });
  });
  return changed ? { segs: fromSubs(subs), types: out } : null;
}
