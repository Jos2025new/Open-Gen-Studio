import { useMemo } from 'react';
import { patchNodeData } from '../../engine/flow/actions';
import { setAgentLlm } from '../../engine/nodes/system';
import { chatAgents } from '../../engine/agent/runtimeShared';
import { useStore } from '../../store/store';

/* Two small controls the node core needs (ADR 0031, strip 2). They write the node's own data through the single
 * editing layer: which LLM an agent node uses, and which connected agent a chat node writes to. */

/** The agent's own LLM; «Default» follows Settings → Agent. Hidden while the local planner is the only engine. */
export function AgentLlmSelect({ sessionId, nodeId, llm }: { sessionId: string; nodeId: string; llm?: { provider: string; model: string } }) {
  const agent = useStore((s) => s.settings.agent);
  const models = useStore((s) => (agent.provider === 'offline' ? undefined : s.catalog.llm[agent.provider]));
  if (agent.provider === 'offline') return null;
  const known = models?.some((m) => m.id === llm?.model);
  return (
    <label className="nc-sys-llm nodrag">
      <span>Model</span>
      <select aria-label="Agent model" value={llm?.model ?? ''} onChange={(e) => setAgentLlm(sessionId, nodeId, e.target.value ? { provider: agent.provider, model: e.target.value } : null)}>
        <option value="">Default{agent.model ? ` · ${agent.model}` : ''}</option>
        {llm && !known ? <option value={llm.model}>{llm.model}</option> : null}
        {(models ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
    </label>
  );
}

/** Which agent a chat node writes to. Shown only when several agents are connected to it. */
export function ChatRecipientSelect({ sessionId, nodeId, recipient }: { sessionId: string; nodeId: string; recipient?: string }) {
  const graph = useStore((s) => s.sessions[sessionId]?.graph);
  const agents = useMemo(() => (graph ? chatAgents(sessionId, nodeId).flatMap((id) => { const n = graph.nodes.find((x) => x.id === id); return n ? [{ id, title: n.data.title }] : []; }) : []), [graph, sessionId, nodeId]);
  if (agents.length < 2) return null;
  return (
    <label className="nc-sys-llm nodrag">
      <span>To</span>
      <select aria-label="Send messages to" value={recipient && agents.some((a) => a.id === recipient) ? recipient : agents[0].id} onChange={(e) => patchNodeData(sessionId, nodeId, { recipient: e.target.value })}>
        {agents.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
      </select>
    </label>
  );
}
