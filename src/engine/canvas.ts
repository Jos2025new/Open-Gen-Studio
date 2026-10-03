import type { Asset, Generation, Session, Workspace } from './types';

/**
 * Which canvas (chat, node, designer) a result belongs to, so the agent and the chat viewer only see the active
 * canvas's assets. `undefined` = not tied to one canvas (an upload used nowhere yet): visible everywhere.
 */
export function canvasIndex(session: Session, generations: Record<string, Generation>) {
  const byGeneration = new Map<string, Workspace>();
  const byPlan = new Map<string, Workspace>();
  const byUpload = new Map<string, Workspace>();
  for (const f of session.feed) {
    // A Nodes result may also have a card in Chat. That card is only another view of the same generation.
    if (f.type === 'generation' && !f.mirroredFrom) byGeneration.set(f.generationId, f.workspace);
    else if (f.type === 'plan') byPlan.set(f.plan.id, f.plan.workspace);
    else if (f.type === 'user') for (const id of f.attachments) if (!byUpload.has(id)) byUpload.set(id, f.workspace);
  }
  const inGraph = new Set<string>();
  const graphGens = new Set<string>();
  for (const n of session.graph.nodes) {
    if ('generationId' in n.data && n.data.generationId) graphGens.add(n.data.generationId);
    if (n.data.kind !== 'asset') continue;
    if (n.data.assetId) inGraph.add(n.data.assetId);
    if (n.data.sketchAssetId) inGraph.add(n.data.sketchAssetId);
  }
  const ofGeneration = (g: Generation): Workspace | undefined =>
    byGeneration.get(g.id) ??
    (g.planId ? byPlan.get(g.planId) : undefined) ??
    (g.origin === 'node' ? 'node' : g.origin === 'designer' ? 'designer' : g.origin === 'agent' ? undefined : 'chat');
  const ofAsset = (a: Asset): Workspace | undefined => {
    const g = a.generationId ? generations[a.generationId] : undefined;
    if (g) return ofGeneration(g);
    return byUpload.get(a.id) ?? (inGraph.has(a.id) ? 'node' : undefined);
  };
  return {
    generation: ofGeneration,
    asset: ofAsset,
    /** The asset is shown on this canvas (or belongs to none). */
    visible: (a: Asset, workspace: Workspace) => {
      const c = ofAsset(a);
      // A chat result brought to the node canvas is shown there too.
      return c == null || c === workspace || (workspace === 'node' && (inGraph.has(a.id) || (a.generationId != null && graphGens.has(a.generationId))));
    },
  };
}

/**
 * The canvas of any asset or generation across sessions (each session's index built once). An upload not used on
 * any canvas yet counts as Chat, where uploads arrive.
 */
export function canvasLookup(sessions: Record<string, Session>, generations: Record<string, Generation>) {
  const cache = new Map<string, ReturnType<typeof canvasIndex>>();
  const index = (sid: string) => {
    if (!cache.has(sid) && sessions[sid]) cache.set(sid, canvasIndex(sessions[sid], generations));
    return cache.get(sid);
  };
  return {
    asset: (a: Asset): Workspace => index(a.sessionId)?.asset(a) ?? 'chat',
    generation: (g: Generation): Workspace => index(g.sessionId)?.generation(g) ?? 'chat',
  };
}
