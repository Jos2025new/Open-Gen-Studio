import { uid } from '../../lib/id';
import { patchSession, useStore } from '../../store/store';
import type { AgentRequestMetrics, Workspace } from '../types';

/*
 * Per-request counters of what the agent already does (R0 of PLAN_AGENT_ROUTE.md): model calls, tokens, the
 * agent's own time until its first output and until the plan card, questions, revisions, models and cost.
 * Nothing here reaches the model; it only records. The user's reading and answering time is not counted.
 */

/** Requests kept per session; older ones are dropped. */
export const MAX_METRICS = 50;

function patchOpen(sessionId: string, fn: (m: AgentRequestMetrics) => Partial<AgentRequestMetrics>): void {
  patchSession(sessionId, (s) => {
    const list = s.agentMetrics ?? [];
    const last = list[list.length - 1];
    if (!last || last.outcome) return s;
    return { ...s, agentMetrics: [...list.slice(0, -1), { ...last, ...fn(last) }] };
  });
}

/** A new request: the one still open (if any) is closed as superseded. */
export function startRequest(sessionId: string, info: { request: string; workspace: Workspace; engine: string; attachments: number }): void {
  const { composer } = useStore.getState();
  patchOpen(sessionId, () => ({ outcome: 'superseded' }));
  const m: AgentRequestMetrics = {
    id: uid('am'),
    startedAt: Date.now(),
    request: info.request.slice(0, 120),
    workspace: info.workspace,
    engine: info.engine,
    style: composer.agentStyle,
    skillId: composer.skillId ?? undefined,
    workflowId: composer.workflowId ?? undefined,
    attachments: info.attachments,
    llmCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    llmUsd: 0,
    agentMs: 0,
    questionRounds: 0,
    revisions: 0,
    plans: 0,
    rejectedPlans: 0,
    findModels: 0,
    models: [],
  };
  patchSession(sessionId, (s) => ({ ...s, agentMetrics: [...(s.agentMetrics ?? []), m].slice(-MAX_METRICS) }));
}

/** Clock for one agent turn; `elapsed()` is the request's agent time so far (earlier turns included). */
export function turnClock(sessionId: string) {
  const t0 = Date.now();
  const open = openMetrics(sessionId);
  const base = open?.agentMs ?? 0;
  return {
    elapsed: () => base + Date.now() - t0,
    /** Close the turn: add its time to its request, even if an auto-approval already closed it. */
    end: () =>
      open &&
      patchSession(sessionId, (s) => ({
        ...s,
        agentMetrics: (s.agentMetrics ?? []).map((m) => (m.id === open.id ? { ...m, agentMs: m.agentMs + Date.now() - t0 } : m)),
      })),
  };
}

export function openMetrics(sessionId: string): AgentRequestMetrics | undefined {
  const list = useStore.getState().sessions[sessionId]?.agentMetrics ?? [];
  const last = list[list.length - 1];
  return last && !last.outcome ? last : undefined;
}

type Event =
  | { type: 'output'; ms: number }
  | { type: 'call'; inputTokens: number; outputTokens: number; usd: number }
  | { type: 'questions' }
  | { type: 'findModels' }
  | { type: 'rejected' }
  | { type: 'plan'; ms: number; revision: boolean; models: string[]; usd: number | null };

export function recordMetric(sessionId: string, e: Event): void {
  patchOpen(sessionId, (m) => {
    switch (e.type) {
      case 'output':
        return m.msToFirstOutput == null ? { msToFirstOutput: e.ms } : {};
      case 'call':
        return { llmCalls: m.llmCalls + 1, inputTokens: m.inputTokens + e.inputTokens, outputTokens: m.outputTokens + e.outputTokens, llmUsd: m.llmUsd + e.usd };
      case 'questions':
        return { questionRounds: m.questionRounds + 1 };
      case 'findModels':
        return { findModels: m.findModels + 1 };
      case 'rejected':
        return { rejectedPlans: m.rejectedPlans + 1 };
      case 'plan':
        return {
          plans: m.plans + 1,
          revisions: m.revisions + (e.revision ? 1 : 0),
          msToPlan: m.msToPlan ?? e.ms,
          models: e.models,
          estimatedUsd: m.estimatedUsd ?? e.usd ?? undefined,
          lastEstimatedUsd: e.usd ?? undefined,
        };
    }
  });
}

/** The request ends when its plan is approved or canceled. */
export function closeRequest(sessionId: string, outcome: 'approved' | 'canceled', approvedUsd?: number | null): void {
  patchOpen(sessionId, () => ({ outcome, approvedUsd: approvedUsd ?? undefined }));
}
