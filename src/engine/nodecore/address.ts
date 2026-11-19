/*
 * Identity and addresses (ADR 0031 point 2). A port is addressed by session, graph, node and port, all stable: system
 * ids repeat across sessions, so a bare node id never names a port. A reference is moving (follows the current
 * revision) or pinned (fixed to one); a broken one stays visible as invalid and blocks a required input.
 */
export interface PortAddress { session: string; graph: string; node: string; port: string }

/** One graph per session today; the id leaves room for subnets without changing the address shape. */
export const MAIN_GRAPH = 'main';

export const portAddress = (session: string, node: string, port: string, graph = MAIN_GRAPH): PortAddress => ({ session, graph, node, port });
export const addressKey = (a: PortAddress): string => `${a.session}/${a.graph}/${a.node}.${a.port}`;
export function parseAddress(key: string): PortAddress | null {
  const m = /^([^/]+)\/([^/]+)\/([^/.]+)\.(.+)$/.exec(key);
  return m ? { session: m[1], graph: m[2], node: m[3], port: m[4] } : null;
}

export type RefMode = 'moving' | 'pinned';
export type RefStatus = 'ok' | 'empty' | 'invalid';

/** Stable 32-bit FNV-1a, as base-36: a revision label, not a security hash. */
export function digest(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
