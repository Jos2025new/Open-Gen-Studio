import type { GraphNode } from '../types';
import { omniOnly } from '../nodes/omniSpaces';

/** Omnicanvas-only cards (system/Space `ref` cards and auto-brought `omni: true` assets) are placed by the app, not by the user. */
const isSystemCard = omniOnly;

export type FitScope = 'auto' | 'all' | 'selection';

/**
 * The nodes a "fit to view" frames. `selection` / `auto` with a selection: just those. Otherwise everything the user
 * made; system cards stay on screen but do not count, unless they are all there is. `nodes` are the ones drawn.
 */
export function fitTargets(nodes: readonly GraphNode[], selected: Iterable<string>, scope: FitScope = 'auto'): string[] {
  const drawn = new Set(nodes.map((n) => n.id));
  const picked = [...new Set(selected)].filter((id) => drawn.has(id));
  if (scope === 'selection' || (scope === 'auto' && picked.length)) return picked;
  const mine = nodes.filter((n) => !isSystemCard(n));
  return (mine.length ? mine : nodes).map((n) => n.id);
}
