import { buildSfnt, type SfntTable } from './sfnt';

/* WOFF2 → plain sfnt (TrueType/OpenType), as the specification describes it (https://www.w3.org/TR/WOFF2/). */
export type Unbrotli = (packed: Uint8Array) => Promise<Uint8Array>;
export const isWoff2 = (b: Uint8Array) => String.fromCharCode(...b.subarray(0, 4)) === 'wOF2';
const KNOWN = 'cmap head hhea hmtx maxp name OS/2 post cvt  fpgm glyf loca prep CFF  VORG EBDT EBLC gasp hdmx kern LTSH PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG  sbix acnt avar bdat bloc bsln cvar fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill'
  .match(/.{4}(?: |$)/g)!.map((t) => t.slice(0, 4));
const MAX_OUT = 60 * 1024 * 1024;

class Reader {
  at = 0;
  private v: DataView;
  constructor(readonly b: Uint8Array) { this.v = new DataView(b.buffer, b.byteOffset, b.byteLength); }
  u8() { return this.v.getUint8(this.at++); }
  u16() { this.at += 2; return this.v.getUint16(this.at - 2); }
  i16() { this.at += 2; return this.v.getInt16(this.at - 2); }
  u32() { this.at += 4; return this.v.getUint32(this.at - 4); }
  take(n: number) { if (n > this.b.length - this.at) throw new RangeError('short font'); this.at += n; return this.b.subarray(this.at - n, this.at); }
  base128() {
    let n = 0;
    for (let i = 0; i < 5; i++) { const c = this.u8(); n = n * 128 + (c & 127); if (!(c & 128)) return n; }
    throw new RangeError('bad number');
  }
  short() { const c = this.u8(); return c === 253 ? this.u16() : c === 255 ? this.u8() + 253 : c === 254 ? this.u8() + 506 : c; }
}
class Writer {
  b = new Uint8Array(1 << 16); at = 0;
  bytes(x: ArrayLike<number>) {
    if (this.at + x.length > this.b.length) { if (this.at + x.length > MAX_OUT) throw new RangeError('font too large'); const n = new Uint8Array(Math.max(this.b.length * 2, this.at + x.length)); n.set(this.b); this.b = n; }
    this.b.set(x, this.at); this.at += x.length;
  }
  u8(n: number) { this.bytes([n & 255]); }
  i16(...list: number[]) { for (const n of list) this.bytes([(n >> 8) & 255, n & 255]); }
  done() { return this.b.slice(0, this.at); }
}

const signed = (flag: number, n: number) => (flag & 1 ? n : -n);
/** One point of a glyph: its move from the previous one. */
function move(f: number, r: Reader): [number, number] {
  if (f < 10) return [0, signed(f, ((f & 14) << 7) + r.u8())];
  if (f < 20) return [signed(f, (((f - 10) & 14) << 7) + r.u8()), 0];
  if (f < 84) { const k = f - 20, b = r.u8(); return [signed(f, 1 + (k & 0x30) + (b >> 4)), signed(f >> 1, 1 + ((k & 0x0c) << 2) + (b & 15))]; }
  if (f < 120) { const k = f - 84; return [signed(f, 1 + (Math.floor(k / 12) << 8) + r.u8()), signed(f >> 1, 1 + (((k % 12) >> 2) << 8) + r.u8())]; }
  if (f < 124) { const a = r.u8(), b = r.u8(), c = r.u8(); return [signed(f, (a << 4) + (b >> 4)), signed(f >> 1, ((b & 15) << 8) + c)]; }
  const x = r.u16(), y = r.u16();
  return [signed(f, x), signed(f >> 1, y)];
}

/** The outlines of a transformed `glyf` table, with its `loca` (long offsets) and each glyph's left edge. */
function glyphs(data: Uint8Array): { glyf: Uint8Array; loca: Uint8Array; xMin: Int16Array } {
  const h = new Reader(data);
  h.u16();
  const options = h.u16(), count = h.u16();
  h.u16();
  const sizes = Array.from({ length: 7 }, () => h.u32());
  const [contours, points, flags, coords, composite, boxes, code] = sizes.map((n) => new Reader(h.take(n)));
  const overlap = options & 1 ? h.take((count + 7) >> 3) : null;
  const hasBox = boxes.take(((count + 31) >> 5) * 4), bit = (b: Uint8Array, i: number) => (b[i >> 3] & (0x80 >> (i & 7))) !== 0;
  const out = new Writer(), loca = new DataView(new ArrayBuffer((count + 1) * 4)), xMin = new Int16Array(count);
  for (let g = 0; g < count; g++) {
    loca.setUint32(g * 4, out.at);
    const n = contours.i16();
    if (n === 0) { if (bit(hasBox, g)) throw new RangeError('bad glyph'); continue; }
    if (n < 0) {
      if (n !== -1 || !bit(hasBox, g)) throw new RangeError('bad glyph');
      const box = boxes.take(8), start = composite.at;
      let f: number, hinted = false;
      do {
        f = composite.u16();
        composite.take(2 + (f & 1 ? 4 : 2) + (f & 8 ? 2 : f & 0x40 ? 4 : f & 0x80 ? 8 : 0));
        hinted ||= (f & 0x100) !== 0;
      } while (f & 0x20);
      out.i16(-1); out.bytes(box); out.bytes(composite.b.subarray(start, composite.at));
      xMin[g] = (box[0] << 8) | box[1];
      if (hinted) { const len = coords.short(); out.i16(len); out.bytes(code.take(len)); }
    } else {
      const ends: number[] = [];
      let total = 0;
      for (let c = 0; c < n; c++) { total += points.short(); if (total > 65535) throw new RangeError('bad glyph'); ends.push(total - 1); }
      const on: boolean[] = [], dx: number[] = [], dy: number[] = [];
      let x = 0, y = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let p = 0; p < total; p++) {
        const f = flags.u8(), [mx, my] = move(f & 127, coords);
        on.push(!(f & 128)); dx.push(mx); dy.push(my);
        x += mx; y += my;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
      const len = coords.short();
      out.i16(n);
      if (bit(hasBox, g)) { const box = boxes.take(8); out.bytes(box); xMin[g] = (box[0] << 8) | box[1]; }
      else { const box = total ? [x0, y0, x1, y1] : [0, 0, 0, 0]; out.i16(...box); xMin[g] = box[0]; }
      ends.forEach((e) => out.i16(e));
      out.i16(len); out.bytes(code.take(len));
      const kind = (d: number, short: number, same: number) => (d === 0 ? same : Math.abs(d) < 256 ? short | (d > 0 ? same : 0) : 0);
      for (let p = 0; p < total; p++) out.u8((on[p] ? 1 : 0) | kind(dx[p], 2, 16) | kind(dy[p], 4, 32) | (p === 0 && overlap && bit(overlap, g) ? 64 : 0));
      for (const list of [dx, dy]) for (const d of list) { if (d === 0) continue; if (Math.abs(d) < 256) out.u8(Math.abs(d)); else out.i16(d); }
    }
    while (out.at & 3) out.u8(0);
  }
  loca.setUint32(count * 4, out.at);
  return { glyf: out.done(), loca: new Uint8Array(loca.buffer), xMin };
}

/** A transformed `hmtx`: left side bearings equal to the glyph's left edge are not written. */
function metrics(data: Uint8Array, wide: number, xMin: Int16Array): Uint8Array {
  const r = new Reader(data), f = r.u8(), count = xMin.length, advance = Array.from({ length: wide }, () => r.u16()), bearing: number[] = [];
  for (let g = 0; g < count; g++) bearing.push(f & (g < wide ? 1 : 2) ? xMin[g] : r.i16());
  const out = new Writer();
  for (let g = 0; g < count; g++) { if (g < wide) out.i16(advance[g]); out.i16(bearing[g]); }
  return out.done();
}

/** Throws when the file is not a WOFF2 of one font. */
export async function woff2ToSfnt(file: Uint8Array, unbrotli: Unbrotli): Promise<Uint8Array> {
  const r = new Reader(file);
  if (!isWoff2(file)) throw new Error('not WOFF2');
  r.at = 4;
  const flavor = r.u32();
  r.u32();
  const count = r.u16();
  r.at = 20;
  const packedSize = r.u32();
  if (flavor === 0x74746366) throw new Error('a font collection');
  r.at = 48;
  const entries = Array.from({ length: count }, () => {
    const f = r.u8(), tag = (f & 63) === 63 ? String.fromCharCode(...r.take(4)) : KNOWN[f & 63], version = f >> 6, size = r.base128();
    const outlines = tag === 'glyf' || tag === 'loca', changed = outlines ? version === 0 : version !== 0;
    return { tag, changed, size: changed ? r.base128() : size };
  });
  const all = new Reader(await unbrotli(r.take(packedSize)));
  const raw = new Map<string, { data: Uint8Array; changed: boolean }>();
  for (const e of entries) raw.set(e.tag, { data: all.take(e.size), changed: e.changed });
  const view = (t: string) => { const d = raw.get(t)?.data; if (!d) throw new Error(`no ${t}`); return new DataView(d.buffer, d.byteOffset, d.byteLength); };
  const tables: SfntTable[] = [], shapes = raw.get('glyf')?.changed ? glyphs(raw.get('glyf')!.data) : null;
  for (const [tag, t] of raw) {
    let data = t.data.slice();
    if (shapes && tag === 'glyf') data = shapes.glyf.slice();
    else if (shapes && tag === 'loca') data = shapes.loca.slice();
    else if (tag === 'hmtx' && t.changed) { if (!shapes) throw new Error('bad hmtx'); data = metrics(t.data, view('hhea').getUint16(34), shapes.xMin).slice(); }
    else if (t.changed) throw new Error(`unknown ${tag}`);
    if (tag === 'head') { const head = new DataView(data.buffer); head.setUint32(8, 0); if (shapes) head.setUint16(50, 1); }
    tables.push({ tag: Uint8Array.from(tag, (c) => c.charCodeAt(0)), data });
  }
  return buildSfnt(flavor, tables);
}
