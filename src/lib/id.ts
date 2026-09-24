const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Short, sortable-enough unique id with a readable prefix (e.g. `gen_k3x9...`). */
export function uid(prefix: string): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${Date.now().toString(36)}${out}`;
}
