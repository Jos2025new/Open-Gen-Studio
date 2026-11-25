const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Short, sortable-enough unique id with a readable prefix (e.g. `gen_k3x9...`). */
export function uid(prefix: string): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${Date.now().toString(36)}${out}`;
}

/** When an id was made; 0 for an id without it. */
export function uidTime(id: string): number {
  const t = parseInt(id.slice(id.lastIndexOf('_') + 1).slice(0, 8), 36);
  return t > 1.5e12 && t < 2.8e12 ? t : 0;
}
