import { uid } from '../../lib/id';
import { patchSession, useStore } from '../../store/store';
import type { AgentMetricsAggregate, AgentRequestMetrics, Session, Workspace } from '../types';

/*
 * Per-request counters of what the agent already does (R0 of PLAN_AGENT_ROUTE.md): model calls, tokens, the
 * agent's own time until its first output and until the plan card, questions, revisions, models and cost.
 * Nothing here reaches the model; it only records. The user's reading and answering time is not counted.
 */

/** Requests kept per session; older ones are folded into `agentMetricsAggregate`. */
export const MAX_METRICS = 50;

const ZERO_AGGREGATE: AgentMetricsAggregate = {
  requests: 0,
  llmCalls: 0,
  wrapUpCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  llmUsd: 0,
  agentMs: 0,
  questionRounds: 0,
  plans: 0,
  revisions: 0,
  rejectedPlans: 0,
  findModels: 0,
};

/** Folds request entries onto an optional aggregate base (missing fields default to zero for older saved data). */
export function sumAgentMetrics(
  list: readonly AgentRequestMetrics[] = [],
  base?: Partial<AgentMetricsAggregate>,
): AgentMetricsAggregate {
  const start: AgentMetricsAggregate = {
    requests: base?.requests ?? 0,
    llmCalls: base?.llmCalls ?? 0,
    wrapUpCalls: base?.wrapUpCalls ?? 0,
    inputTokens: base?.inputTokens ?? 0,
    outputTokens: base?.outputTokens ?? 0,
    llmUsd: base?.llmUsd ?? 0,
    agentMs: base?.agentMs ?? 0,
    questionRounds: base?.questionRounds ?? 0,
    plans: base?.plans ?? 0,
    revisions: base?.revisions ?? 0,
    rejectedPlans: base?.rejectedPlans ?? 0,
    findModels: base?.findModels ?? 0,
  };
  return list.reduce<AgentMetricsAggregate>(
    (acc, m) => ({
      requests: acc.requests + 1,
      llmCalls: acc.llmCalls + m.llmCalls,
      wrapUpCalls: acc.wrapUpCalls + (m.wrapUpCalls ?? 0),
      inputTokens: acc.inputTokens + m.inputTokens,
      outputTokens: acc.outputTokens + m.outputTokens,
      llmUsd: acc.llmUsd + m.llmUsd,
      agentMs: acc.agentMs + m.agentMs,
      questionRounds: acc.questionRounds + m.questionRounds,
      plans: acc.plans + m.plans,
      revisions: acc.revisions + m.revisions,
      rejectedPlans: acc.rejectedPlans + m.rejectedPlans,
      findModels: acc.findModels + m.findModels,
    }),
    start,
  );
}

/** Combined cumulative totals across `agentMetricsAggregate` and currently kept `agentMetrics`. */
export function sessionMetricsTotals(
  session: Pick<Session, 'agentMetrics' | 'agentMetricsAggregate'> | undefined,
): AgentMetricsAggregate {
  return sumAgentMetrics(session?.agentMetrics ?? [], session?.agentMetricsAggregate ?? ZERO_AGGREGATE);
}

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
  patchSession(sessionId, (s) => {
    const combined = [...(s.agentMetrics ?? []), m];
    if (combined.length <= MAX_METRICS) return { ...s, agentMetrics: combined };
    const cut = combined.length - MAX_METRICS;
    return {
      ...s,
      agentMetrics: combined.slice(cut),
      agentMetricsAggregate: sumAgentMetrics(combined.slice(0, cut), s.agentMetricsAggregate),
    };
  });
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
  | { type: 'call'; inputTokens: number; outputTokens: number; usd: number; wrapUp?: boolean; timing?: NonNullable<AgentRequestMetrics['callTimings']>[number] }
  /** A call that ended in an error: it counts as a call and keeps its seconds and message, but adds no timing sample. */
  | { type: 'failedCall'; error: string; ms: number }
  | { type: 'questions' }
  | { type: 'findModels' }
  | { type: 'guide'; id: string }
  | { type: 'rejected' }
  | { type: 'plan'; ms: number; revision: boolean; models: string[]; usd: number | null; checkMs?: number };

export function recordMetric(sessionId: string, e: Event): void {
  patchOpen(sessionId, (m) => {
    switch (e.type) {
      case 'output':
        return m.msToFirstOutput == null ? { msToFirstOutput: e.ms } : {};
      case 'call':
        return {
          ...(e.wrapUp ? { wrapUpCalls: (m.wrapUpCalls ?? 0) + 1 } : { llmCalls: m.llmCalls + 1 }),
          inputTokens: m.inputTokens + e.inputTokens,
          outputTokens: m.outputTokens + e.outputTokens,
          llmUsd: m.llmUsd + e.usd,
          ...(e.timing ? { callTimings: [...(m.callTimings ?? []), e.timing].slice(-12) } : {}),
        };
      case 'failedCall':
        return {
          llmCalls: m.llmCalls + 1,
          failedCalls: [...(m.failedCalls ?? []), { error: e.error.slice(0, 200), seconds: Math.round(e.ms / 100) / 10 }].slice(-12),
        };
      case 'questions':
        return { questionRounds: m.questionRounds + 1 };
      case 'findModels':
        return { findModels: m.findModels + 1 };
      case 'guide':
        return { guides: [...(m.guides ?? []), e.id] };
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
          ...(e.checkMs != null ? { planCheckMs: [...(m.planCheckMs ?? []), e.checkMs].slice(-12) } : {}),
        };
    }
  });
}

/** The request ends when its plan is approved or canceled. */
export function closeRequest(sessionId: string, outcome: 'approved' | 'canceled', approvedUsd?: number | null): void {
  patchOpen(sessionId, () => ({ outcome, approvedUsd: approvedUsd ?? undefined }));
}
