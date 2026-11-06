import { rotateAbout, scaleAbout, skewAbout, type Mat } from './matrix';

/** What a handle drag knows: the handle, where it began, the pivot and the box. Structurally the Stage's `xform` drag. */
export interface XformDrag {
  op: 'scale' | 'rotate' | 'skew' | 'pivot';
  h: { x: number; y: number; fx: number; fy: number };
  startX: number; startY: number; cx: number; cy: number;
  box: { x: number; y: number; w: number; h: number };
}

/** The transform a handle drag means, in page coordinates (Shift: keep proportions / 15° steps). `alt` is accepted and not used yet. */
export function xformMatrix(d: XformDrag, p: { x: number; y: number }, mods: { shift: boolean; alt: boolean }): Mat {
  const { box, h } = d;
  const { shift } = mods;
  if (d.op === 'scale') {
    // The opposite side or corner stays put.
    const ax = box.x + box.w / 2 - (h.fx * box.w) / 2, ay = box.y + box.h / 2 - (h.fy * box.h) / 2;
    const clamp = (v: number) => (Math.abs(v) < 0.01 ? Math.sign(v || 1) * 0.01 : v);
    let sx = h.fx ? (p.x - ax) / (h.x - ax) : 1, sy = h.fy ? (p.y - ay) / (h.y - ay) : 1;
    // Ctrl or Shift (Inkscape's Ctrl): width and height keep their ratio. A side handle scales both axes,
    // about the opposite side's middle.
    if (shift && h.fx && h.fy) { const s = Math.max(Math.abs(sx), Math.abs(sy)); sx = Math.sign(sx || 1) * s; sy = Math.sign(sy || 1) * s; }
    else if (shift && h.fx) return scaleAbout(clamp(sx), clamp(Math.abs(sx)), ax, box.y + box.h / 2);
    else if (shift && h.fy) return scaleAbout(clamp(Math.abs(sy)), clamp(sy), box.x + box.w / 2, ay);
    return scaleAbout(clamp(sx), clamp(sy), ax, ay);
  }
  if (d.op === 'rotate') {
    let a = Math.atan2(p.y - d.cy, p.x - d.cx) - Math.atan2(d.startY - d.cy, d.startX - d.cx);
    if (shift) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
    return rotateAbout(a, d.cx, d.cy);
  }
  if (d.op === 'skew') {
    // Top/bottom sides slide sideways (skew x); left/right sides slide up and down (skew y). About the center.
    if (h.fy) { let k = (p.x - d.startX) / (h.y - d.cy || 1); if (shift) k = Math.tan(Math.round(Math.atan(k) / (Math.PI / 12)) * (Math.PI / 12)); return skewAbout(k, 0, d.cx, d.cy); }
    let k = (p.y - d.startY) / (h.x - d.cx || 1); if (shift) k = Math.tan(Math.round(Math.atan(k) / (Math.PI / 12)) * (Math.PI / 12));
    return skewAbout(0, k, d.cx, d.cy);
  }
  return [1, 0, 0, 1, 0, 0];
}
