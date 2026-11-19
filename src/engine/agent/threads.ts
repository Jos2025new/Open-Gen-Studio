import type { AgentState, Session } from '../types';

/*
 * One thread per agent (ADR 0031, strip 2): `session.agents[id]` is the whole state of that agent: history, cards waiting,
 * notes, model, settings, `busy`. There is no "current agent" copy: whatever needs an agent names its thread.
 * `session.agentLane` is only which thread the UI shows. A session with no agent node yet keeps its one thread under MAIN_THREAD;
 * the first agent node that is used takes it over (it inherits what the session had).
 */
export const MAIN_THREAD = 'main';

export const freshAgent = (): AgentState => ({ history: [], questionRound: 0, notes: [], busy: false });

/** The first agent node of a graph (the one a row from before agent ids belongs to), else the main thread. */
export const firstAgentId = (graph: Pick<Session['graph'], 'nodes'> | undefined): string => graph?.nodes.find((n) => n.data.kind === 'ref' && n.data.type === 'agent')?.id ?? MAIN_THREAD;

/** The thread the UI shows (display only). */
export const shownThread = (s: Pick<Session, 'agents' | 'agentLane'> | undefined): AgentState | undefined => (s?.agents ? s.agents[shownKey(s)] ?? s.agents[MAIN_THREAD] : undefined);

/** The key of the thread the UI shows. */
export const shownKey = (s: Pick<Session, 'agents' | 'agentLane'>): string => s.agentLane ?? MAIN_THREAD;

/**
 * One thread by agent id, from a session value. An id the session has no thread for reads as nothing, except that the session's
 * only thread (still under MAIN_THREAD) is the first agent's. No id: the thread the UI shows.
 */
export function threadOf(s: Pick<Session, 'agents' | 'graph'> | undefined, nodeId: string): AgentState | undefined {
  if (!s?.agents) return undefined;
  return s.agents[nodeId] ?? (onlyMain(s.agents) && nodeId === firstAgentId(s.graph) ? s.agents[MAIN_THREAD] : undefined);
}

const onlyMain = (agents: Record<string, AgentState>) => Object.keys(agents).length === 1 && MAIN_THREAD in agents;

/** Every thread of the session. */
export const allThreads = (s: Pick<Session, 'agents'> | undefined): AgentState[] => Object.values(s?.agents ?? {});

/** The agents map with `nodeId`'s thread present: the session's main thread is taken over by the first agent, any other agent starts fresh. */
export function withThread(agents: Record<string, AgentState>, nodeId: string, firstAgent: string): Record<string, AgentState> {
  if (agents[nodeId]) return agents;
  if (onlyMain(agents) && nodeId === firstAgent) { const { [MAIN_THREAD]: main, ...rest } = agents; return { ...rest, [nodeId]: main }; }
  return { ...agents, [nodeId]: freshAgent() };
}

/** A turn cut by a reload is over: nothing is working or waiting on the network. */
export const interrupted = (a: AgentState): AgentState => ({
  ...a, busy: false, phase: undefined, revising: undefined, waiting: undefined,
  // A plan being rewritten when the app closed is a plan waiting again: its comment goes on revising it, not as a new request.
  ...(a.revising && !a.pending ? { pending: { toolCallId: null, kind: 'plan' as const, feedItemId: a.revising } } : {}),
});

/**
 * A saved session loads with its threads: one saved with the single `agent` (and maybe `agentLane`/`agents`, or the older
 * `agentLanes`) gives each agent its thread; the one on screen was `agent`. Idempotent.
 */
export function migrateAgents(s: Session): Session {
  const raw = s as Session & { agent?: AgentState; agentLanes?: Record<string, AgentState> };
  const { agent, agentLanes, ...rest } = raw;
  const agents: Record<string, AgentState> = { ...agentLanes, ...raw.agents };
  // The single `agent` was the one on screen: the lane it names, else the agent of the last row, else the first agent of the graph.
  const lastOwner = [...s.feed].reverse().map((f) => (f as { meta?: { agentNodeId?: string } }).meta?.agentNodeId).find((id) => id && s.graph.nodes.some((n) => n.id === id));
  if (agent) agents[raw.agentLane ?? lastOwner ?? firstAgentId(s.graph)] = agent;
  if (!Object.keys(agents).length) agents[MAIN_THREAD] = freshAgent();
  return { ...rest, agents: Object.fromEntries(Object.entries(agents).map(([k, a]) => [k, interrupted(a)])) } as Session;
}

type Meta = { meta?: { agentNodeId?: string; chatNodeId?: string } };

/** Who owns a row: the agent or chat it names, else (a row from before ids) the fallback, the first one. The one rule every reader of the feed shares. */
export const feedOwner = (row: object, kind: 'agent' | 'chat', fallback: string | undefined): string | undefined => {
  const m = (row as Meta).meta;
  return (kind === 'agent' ? m?.agentNodeId : m?.chatNodeId) ?? fallback;
};
const isRef = (type: string) => (n: Session['graph']['nodes'][number]) => n.data.kind === 'ref' && n.data.type === type;

/** The feed one agent owns: what carries its id, plus what predates agent ids (the first agent's). Pure: read it from any session value. */
export function feedOfAgentIn(s: Pick<Session, 'feed' | 'graph'> | undefined, owner: string): Session['feed'] {
  const first = firstAgentId(s?.graph);
  return (s?.feed ?? []).filter((f) => feedOwner(f, 'agent', first) === owner);
}

/** The feed a chat node owns: what carries its id, plus what predates chat ids (the first chat's). */
export function feedOfChatIn(s: Pick<Session, 'feed' | 'graph'> | undefined, chatNodeId: string): Session['feed'] {
  const first = s?.graph.nodes.find(isRef('chat'))?.id;
  return (s?.feed ?? []).filter((f) => feedOwner(f, 'chat', first) === chatNodeId);
}
