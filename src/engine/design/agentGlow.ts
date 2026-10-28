import type { DesignDoc } from '../types';

/*
 * The agent's canvas edits, flashed on the Designer for a moment. In memory only: it is never written into the document,
 * its history, its storage or an export. The overlay (AgentGlow.tsx) reads it; a timer tells it when a glow fades.
 */

/** How long a changed layer glows (the CSS keyframe runs for the same time). */
export const GLOW_MS = 1200;

/** docId → layerId → the time (ms) its glow ends. */
const glows = new Map<string, Map<string, number>>();
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((f) => f());

/** The layers the agent changed: new objects in the after-document (an edit replaces the layer object, undo keeps it). */
export function agentChangedIds(before: Pick<DesignDoc, 'layers'>, after: Pick<DesignDoc, 'layers'>): string[] {
  const prev = new Map(before.layers.map((l) => [l.id, l]));
  return after.layers.filter((l) => prev.get(l.id) !== l).map((l) => l.id);
}

/** Starts the glow for the layers the agent changed between `before` and `after`. Called only on the agent's path. */
export function markAgentEdit(docId: string, before: Pick<DesignDoc, 'layers'>, after: Pick<DesignDoc, 'layers'>, now = Date.now()): void {
  const ids = agentChangedIds(before, after);
  if (!ids.length) return;
  const map = glows.get(docId) ?? new Map<string, number>();
  glows.set(docId, map);
  for (const id of ids) map.set(id, now + GLOW_MS);
  tell();
  setTimeout(() => { prune(docId); tell(); }, GLOW_MS + 5);
}

function prune(docId: string, now = Date.now()): void {
  const map = glows.get(docId);
  if (!map) return;
  for (const [id, until] of map) if (until <= now) map.delete(id);
  if (!map.size) glows.delete(docId);
}

/** The layers glowing now in a document. */
export function glowingLayers(docId: string, now = Date.now()): string[] {
  const map = glows.get(docId);
  if (!map) return [];
  return [...map].filter(([, until]) => until > now).map(([id]) => id);
}

/** Called when the glows of any document change (a glow starts, or fades). Returns the unsubscribe. */
export function subscribeGlow(f: () => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}
