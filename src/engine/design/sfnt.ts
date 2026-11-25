export interface SfntTable { tag: Uint8Array; data: Uint8Array; /** Its checksum, when the file it comes from has it. */ sum?: number }

function checksum(d: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < d.length; i += 4) n = (n + ((d[i] << 24) | ((d[i + 1] ?? 0) << 16) | ((d[i + 2] ?? 0) << 8) | (d[i + 3] ?? 0))) >>> 0;
  return n;
}

/** A TrueType/OpenType file of these tables, in tag order. */
export function buildSfnt(flavor: number, list: readonly SfntTable[]): Uint8Array {
  const name = (t: SfntTable) => String.fromCharCode(...t.tag), tables = [...list].sort((a, b) => (name(a) < name(b) ? -1 : 1));
  const count = tables.length, head = 12 + count * 16;
  const out = new Uint8Array(tables.reduce((size, t) => size + ((t.data.length + 3) & ~3), head));
  const dv = new DataView(out.buffer);
  dv.setUint32(0, flavor);
  dv.setUint16(4, count);
  const pow = 2 ** Math.floor(Math.log2(count));
  dv.setUint16(6, pow * 16); dv.setUint16(8, Math.log2(pow)); dv.setUint16(10, count * 16 - pow * 16);
  let at = head;
  tables.forEach((t, i) => {
    const o = 12 + i * 16;
    out.set(t.tag, o); dv.setUint32(o + 4, t.sum ?? checksum(t.data)); dv.setUint32(o + 8, at); dv.setUint32(o + 12, t.data.length);
    out.set(t.data, at);
    at += (t.data.length + 3) & ~3;
  });
  return out;
}
