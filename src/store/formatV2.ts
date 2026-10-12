/*
 * Format 2 of the saved state (ADR 0014), as the browser sees it: one global record plus one text per session. The
 * assembled text is byte-compatible with the server's (server/store-v2.js), so the load path reads either the same way.
 * Pure string work: a session's text is never parsed to write it.
 */

export interface V2Parts {
  savedAt: number;
  version: number;
  /** The state without sessions, as JSON (`{...}`). */
  globals: string;
  /** Session ids in order. */
  order: string[];
  /** Each session's JSON text by id. */
  sessions: Map<string, string>;
}

/** The format-1 text of a state (what the app reads and the server assembles). */
export function assembleText(p: V2Parts): string {
  const inner = p.globals.slice(1, -1);
  const body = p.order.map((id) => `${JSON.stringify(id)}:${p.sessions.get(id)}`).join(',');
  return `{"savedAt":${p.savedAt},"state":{${inner}${inner ? ',' : ''}"sessions":{${body}}},"version":${p.version}}`;
}

/** Splits a whole format-1 state text into parts (migration, adoption of a disk copy). */
export function splitText(text: string): V2Parts & { baseAt?: number } {
  const obj = JSON.parse(text) as { savedAt?: number; baseAt?: number; state?: Record<string, unknown>; version?: number };
  const { sessions = {}, ...rest } = (obj.state ?? {}) as Record<string, Record<string, unknown>>;
  const order = Object.keys(sessions);
  return {
    savedAt: obj.savedAt ?? 0,
    baseAt: obj.baseAt,
    version: obj.version ?? 1,
    globals: JSON.stringify(rest),
    order,
    sessions: new Map(order.map((id) => [id, JSON.stringify(sessions[id])])),
  };
}
