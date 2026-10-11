import { nodeSegs, type NodeType, type Pt, type Seg } from './pathNodes';

/*
 * Node operations that change a path's structure (Inkscape's Node tool): add, delete (keeping the shape), segments to
 * line or curve, join ends. Each works on the subpaths as nodes and edges (pathNodes.ts toSubs/fromSubs) and keeps the
 * node types with their nodes. Split from pathNodes.ts (files stay under 30 KB).
 */

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

/*
 * Joining endpoints (Inkscape multi-path-manipulator.cpp): only selected ends of open subpaths count, paired by
 * closest distance (L57–79). Shift+J merges each pair into one cusp node at their midpoint, keeping the curve into
 * one and out of the other (L386–426); Alt+J joins them with a straight segment, both ends cusp (L457–475). The same
 * subpath closes; two subpaths become one. Returns the new segments, types and the selected nodes after.
 */
type TSub = Sub & { types: NodeType[] };
const reverseSub = (s: TSub): TSub => ({
  nodes: [...s.nodes].reverse(),
  edges: [...s.edges].reverse().map((e) => (e.c === 'C' ? { c: 'C' as const, c1: e.c2, c2: e.c1 } : e)),
  closed: s.closed, types: [...s.types].reverse(),
});

export function joinEnds(segs: Seg[], types: NodeType[], selected: number[], how: 'merge' | 'segment'): { segs: Seg[]; types: NodeType[]; nodes: number[] } | null {
  const plain = toSubs(segs);
  let subs: TSub[] = plain.map((s, si) => ({ ...s, types: types.slice(globalIndex(plain, si, 0), globalIndex(plain, si, 0) + s.nodes.length) }));
  // Selected ends: [subpath, 'start' | 'end'] of open subpaths with two nodes or more.
  type End = { sub: TSub; at: 'start' | 'end' };
  const ends: End[] = [];
  subs.forEach((s, si) => {
    if (s.closed || s.nodes.length < 2) return;
    const base = globalIndex(plain, si, 0);
    if (selected.includes(base)) ends.push({ sub: s, at: 'start' });
    if (selected.includes(base + s.nodes.length - 1)) ends.push({ sub: s, at: 'end' });
  });
  const pos = (e: End) => (e.at === 'start' ? e.sub.nodes[0] : e.sub.nodes[e.sub.nodes.length - 1]);
  const pairs: Array<[End, End]> = [];
  const left = [...ends];
  while (left.length >= 2) {
    let best: [number, number] | null = null, bd = Infinity;
    for (let i = 0; i < left.length; i++) for (let j = i + 1; j < left.length; j++) {
      const a = pos(left[i]), b = pos(left[j]), d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (d < bd) { bd = d; best = [i, j]; }
    }
    const [i, j] = best!;
    pairs.push([left[i], left[j]]);
    left.splice(j, 1); left.splice(i, 1);
  }
  if (!pairs.length) return null;
  const marks: Pt[] = [];
  for (const [a0, b0] of pairs) {
    // Find each end again in the current subpaths (review: an earlier join replaced the subpath objects, so later
    // pairs were skipped). Node points keep their identity through joins and reversals.
    const find = (pt: Pt): End | null => {
      for (const t of subs) {
        if (t.closed) continue;
        if (t.nodes[0] === pt) return { sub: t, at: 'start' };
        if (t.nodes[t.nodes.length - 1] === pt) return { sub: t, at: 'end' };
      }
      return null;
    };
    const ea = find(pos(a0)), eb = find(pos(b0));
    if (!ea || !eb) continue;
    let a = ea.sub, b = eb.sub;
    if (a === b) {
      // One subpath: close it.
      if (how === 'segment') { a.edges.push({ c: 'L' }); a.types[0] = 'c'; a.types[a.types.length - 1] = 'c'; }
      else {
        const p = a.nodes[0], q = a.nodes[a.nodes.length - 1], m: Pt = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
        shiftNode(a, 0, m); shiftNode(a, a.nodes.length - 1, m);
        a.nodes.pop(); a.types.pop(); a.types[0] = 'c';
      }
      a.closed = true;
      marks.push(a.nodes[0]);
      continue;
    }
    // Two subpaths: a ends where b starts.
    if (ea.at === 'start') { const r = reverseSub(a); subs = subs.map((s) => (s === a ? r : s)); a = r; }
    if (eb.at === 'end') { const r = reverseSub(b); subs = subs.map((s) => (s === b ? r : s)); b = r; }
    const merged: TSub = { nodes: [...a.nodes], edges: [...a.edges], closed: false, types: [...a.types] };
    if (how === 'segment') {
      merged.edges.push({ c: 'L' }, ...b.edges);
      merged.nodes.push(...b.nodes);
      merged.types[merged.types.length - 1] = 'c';
      merged.types.push('c', ...b.types.slice(1));
      marks.push(a.nodes[a.nodes.length - 1], b.nodes[0]);
    } else {
      const p = a.nodes[a.nodes.length - 1], q = b.nodes[0], m: Pt = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      shiftNode(merged, merged.nodes.length - 1, m);
      const bb: TSub = { ...b, nodes: [...b.nodes], edges: b.edges.map((e) => ({ ...e })) };
      shiftNode(bb, 0, m);
      merged.edges.push(...bb.edges);
      merged.nodes.push(...bb.nodes.slice(1));
      merged.types[merged.types.length - 1] = 'c';
      merged.types.push(...b.types.slice(1));
      marks.push(m);
    }
    subs = subs.filter((s) => s !== b).map((s) => (s === a ? merged : s));
  }
  const outSegs = fromSubs(subs), outTypes = subs.flatMap((s) => s.types);
  // Selected after: the joined node(s), found again by position.
  const flat = subs.flatMap((s) => s.nodes);
  const nodes = marks.map((m) => flat.findIndex((p) => Math.hypot(p[0] - m[0], p[1] - m[1]) < 1e-6)).filter((i) => i >= 0);
  return { segs: outSegs, types: outTypes, nodes: [...new Set(nodes)].sort((x, y) => x - y) };
}

/** Move node `j` of a subpath to `to`, carrying the handles of its edges (in and out). */
function shiftNode(s: Sub, j: number, to: Pt): void {
  const m = s.nodes.length, p = s.nodes[j], dx = to[0] - p[0], dy = to[1] - p[1];
  const kin = j - 1 >= 0 ? j - 1 : s.closed ? m - 1 : -1, kout = j < s.edges.length ? j : -1;
  if (kin >= 0 && s.edges[kin].c === 'C') s.edges[kin] = { ...s.edges[kin], c2: [s.edges[kin].c2![0] + dx, s.edges[kin].c2![1] + dy] };
  if (kout >= 0 && s.edges[kout].c === 'C') s.edges[kout] = { ...s.edges[kout], c1: [s.edges[kout].c1![0] + dx, s.edges[kout].c1![1] + dy] };
  s.nodes[j] = to;
}

/**
 * Break the path at the selected nodes (Inkscape Shift+B, path-manipulator.cpp L646–676): an interior node of an open
 * subpath splits it into two, ending and starting at two coincident nodes (one keeps the curve in, the other the
 * curve out), both cusp; on a closed subpath the first selected node opens it there. Ends of open subpaths stay as
 * they are. Returns the new geometry and, selected, the starting node of each new piece. Null if nothing breaks.
 */
export function breakNodes(segs: Seg[], types: NodeType[], selected: number[]): { segs: Seg[]; types: NodeType[]; nodes: number[] } | null {
  const plain = toSubs(segs), sel = new Set(selected);
  const out: TSub[] = [], starts: TSub[] = [];
  let changed = false;
  plain.forEach((s0, si) => {
    const base = globalIndex(plain, si, 0);
    let s: TSub = { ...s0, nodes: [...s0.nodes], edges: [...s0.edges], types: types.slice(base, base + s0.nodes.length) };
    let picks = s.nodes.map((_, j) => j).filter((j) => sel.has(base + j));
    if (s.closed && picks.length && s.nodes.length >= 2) {
      // Open it at the first selected node: that node starts and (as a coincident copy) ends the subpath.
      const j0 = picks[0], m = s.nodes.length;
      const order = s.nodes.map((_, k) => (j0 + k) % m);
      s = { nodes: [...order.map((k) => s.nodes[k]), s.nodes[j0]], edges: order.map((k) => s.edges[k]), closed: false, types: [...order.map((k) => s.types[k]), 'c'] };
      s.types[0] = 'c';
      picks = picks.slice(1).map((j) => (j - j0 + m) % m);
      changed = true;
      starts.push(s);
    }
    // Interior picks split it, from the last one back so earlier indices hold.
    const pieces: TSub[] = [];
    let rest = s;
    for (const j of picks.filter((j) => j > 0 && j < rest.nodes.length - 1).sort((a, b) => b - a)) {
      const tail: TSub = { nodes: rest.nodes.slice(j), edges: rest.edges.slice(j), closed: false, types: ['c', ...rest.types.slice(j + 1)] };
      rest = { nodes: rest.nodes.slice(0, j + 1), edges: rest.edges.slice(0, j), closed: false, types: [...rest.types.slice(0, j), 'c'] };
      pieces.unshift(tail);
      starts.push(tail);
      changed = true;
    }
    out.push(rest, ...pieces);
  });
  if (!changed) return null;
  // The first node of each new piece, found in the final pieces (review: a piece split again was a discarded object).
  const firsts = new Set(starts.map((t) => t.nodes[0]));
  const nodes = out.flatMap((t, i) => (firsts.has(t.nodes[0]) ? [globalIndex(out, i, 0)] : []));
  return { segs: fromSubs(out), types: out.flatMap((t) => t.types), nodes };
}
