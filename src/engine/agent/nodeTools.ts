import { coerceSettings } from '../params';
import { resolveModel } from '../catalog';
import { connectNodes, deleteNodesWithUndo, disconnectEdges, patchNodeData, setNodeModel } from '../flow/actions';
import { useStore } from '../../store/store';
import { connectNodesSchema, disconnectNodesSchema, editNodeSchema, nodeIdsSchema } from './tools';
import type { DeletedNodes } from '../flow/actions';

/** Tool inputs only; graph validation and mutation stay in the shared UI actions. */
export async function editGraphTool(sessionId: string, name: string, input: unknown): Promise<{ text: string; deleted?: DeletedNodes }> {
  if (name === 'edit_node') {
    const parsed = editNodeSchema.safeParse(input);
    if (!parsed.success) return { text: `Invalid edit_node: ${parsed.error.message}` };
    const args = parsed.data, st = useStore.getState();
    const n = st.sessions[sessionId]?.graph.nodes.find(n => n.id === args.node_id);
    if (!n) return { text: `No such node: ${args.node_id}.` };
    const d = n.data;
    if ((args.model_ref || args.settings) && !('modelRef' in d)) return { text: 'This node has no generation model/settings.' };
    if (args.params && d.kind !== 'tool') return { text: 'Only tool nodes have operation params.' };
    if (args.prompt !== undefined && !('prompt' in d) && d.kind !== 'text') return { text: 'This node has no prompt. For a tool, edit its instruction in params.' };
    let error: string | null = null;
    if ('modelRef' in d && (args.model_ref || args.settings)) {
      const modelRef = args.model_ref ?? d.modelRef;
      const resolved = await resolveModel(modelRef);
      if (!resolved) return { text: `Unknown or unavailable model: ${modelRef}.` };
      const requested = { ...d.settings, ...args.settings, advanced: { ...d.settings.advanced, ...args.settings?.advanced }, extras: { ...d.settings.extras, ...args.settings?.extras } };
      const { settings } = coerceSettings(resolved.schema, d.kind, requested);
      error = setNodeModel(sessionId, n.id, { modelRef, settings });
    }
    if (error) return { text: error };
    const patch = { ...(args.title !== undefined ? { title: args.title } : {}), ...(args.prompt !== undefined ? d.kind === 'text' ? { text: args.prompt } : { prompt: args.prompt } : {}), ...(args.params && d.kind === 'tool' ? { params: { ...d.params, ...args.params } } : {}) };
    error = patchNodeData(sessionId, n.id, patch);
    return { text: error ?? `Updated existing node ${n.id}.` };
  }
  if (name === 'connect_nodes') {
    const v = connectNodesSchema.safeParse(input);
    if (!v.success) return { text: `Invalid connect_nodes: ${v.error.message}` };
    return { text: connectNodes(sessionId, { source: v.data.source, target: v.data.target, targetHandle: v.data.port }) ?? 'Connected existing nodes.' };
  }
  if (name === 'disconnect_nodes') {
    const v = disconnectNodesSchema.safeParse(input);
    if (!v.success) return { text: `Invalid disconnect_nodes: ${v.error.message}` };
    return { text: disconnectEdges(sessionId, v.data.edge_ids) ?? 'Disconnected existing connections.' };
  }
  const v = nodeIdsSchema.safeParse(input);
  if (!v.success) return { text: `Invalid delete_nodes: ${v.error.message}` };
  const result = deleteNodesWithUndo(sessionId, v.data.node_ids);
  return { text: result.error ?? `Deleted ${v.data.node_ids.length} existing node(s). Results remain in the gallery. Undo is available in the chat.`, deleted: result.deleted };
}
