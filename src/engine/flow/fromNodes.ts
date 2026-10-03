import { uid } from '../../lib/id';
import { appendFeed, useStore } from '../../store/store';
import type { GenerationFeedItem } from '../types';

export interface NodeChatResult {
  nodeId: string;
  generationId: string;
  outputIndex: number;
  assetId: string;
  label: string;
}

/** Current node outputs that have a real selected file and no imported card in Chat yet. */
export function nodeWorkNotInChat(sessionId: string): NodeChatResult[] {
  const st = useStore.getState();
  const session = st.sessions[sessionId];
  if (!session) return [];

  const shown = new Set(
    session.feed
      .filter((item): item is GenerationFeedItem => item.type === 'generation' && item.workspace === 'chat')
      .map((item) => item.generationId),
  );
  const found = new Set<string>();
  const results: NodeChatResult[] = [];
  for (const node of session.graph.nodes) {
    const data = node.data;
    if (data.kind === 'text' || data.kind === 'asset' || !data.generationId || found.has(data.generationId) || shown.has(data.generationId)) continue;
    const generation = st.generations[data.generationId];
    const assetId = generation?.assetIds[data.outputIndex];
    if (!generation || generation.sessionId !== sessionId || !assetId || !st.assets[assetId]) continue;
    found.add(generation.id);
    results.push({ nodeId: node.id, generationId: generation.id, outputIndex: data.outputIndex, assetId, label: data.title });
  }
  return results;
}

/** Add Chat feed references to existing node generations. No generation, asset or provider call is created. */
export function nodesToChat(sessionId: string, only?: string[]): { added: NodeChatResult[] } {
  const requested = only ? new Set(only) : undefined;
  const added = nodeWorkNotInChat(sessionId).filter((item) => !requested || requested.has(item.nodeId));
  for (const item of added) {
    appendFeed(sessionId, {
      id: uid('fd'),
      createdAt: Date.now(),
      workspace: 'chat',
      type: 'generation',
      generationId: item.generationId,
      mirroredFrom: 'node',
      outputIndex: item.outputIndex,
    });
  }
  return { added };
}
