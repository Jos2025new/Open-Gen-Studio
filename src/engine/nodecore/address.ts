/*
 * Identity (ADR 0031 point 2). Cables keep their own id; an approval's pins are keyed by structured [node, port, cable]
 * (action.ts), never by a delimited string. A reference is moving (follows the current
 * revision) or pinned (fixed to one); a broken one stays visible as invalid and blocks a required input.
 */
export type RefMode = 'moving' | 'pinned';
export type RefStatus = 'ok' | 'empty' | 'invalid';

/** Stable 32-bit FNV-1a, as base-36: a revision label, not a security hash. */
export function digest(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
