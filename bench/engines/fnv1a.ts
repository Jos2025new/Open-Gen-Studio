/*
 * FNV-1a (32 bit) over bytes, as hex. Used by the parity regression guard: a digest of the CPU reference composition
 * of each fixture, compared with the stored value in parity-digests.json. A change means the rendered bytes changed.
 */
export function fnv1a32(bytes: ArrayLike<number>): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i] & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
