import { patchSession, useStore } from '../../store/store';
import type { StepAuthorization, StepCostReview } from '../types';

export interface StepPriceDecision {
  decision: 'continue' | 'cancel';
  decidedAt: number;
  generationId: string;
  before: StepAuthorization;
  after: StepAuthorization;
  reason: string;
  result?: { status: 'done' | 'error' | 'canceled'; reportedAt: number; providerReportedUsd?: number };
}

const usd = (value: number | null | undefined) => value == null ? 'desconocido' : `$${value.toFixed(2)}`;
const short = (value: string) => value.replace(/[\r\n]+/g, ' ').slice(0, 80);

export function priceDecision(review: StepCostReview, generationId: string, decision: StepPriceDecision['decision']): StepPriceDecision {
  return { decision, decidedAt: Date.now(), generationId, before: structuredClone(review.approved),
    after: structuredClone(review.proposed), reason: review.reason ?? review.message };
}

export function priceDecisionNote(planId: string, stepId: string, record: StepPriceDecision): string {
  return `[app] Plan ${short(planId)}, paso ${short(stepId)}: antes ${usd(record.before.estimate.usd)} → ahora ${usd(record.after.estimate.usd)} (motivo: ${short(record.reason)}).\n` +
    (record.decision === 'continue' ? `Decisión: Continuar. Autorizado: ${usd(record.after.estimate.usd)} estimados. Estado: pendiente.`
      : 'Decisión: Cancelar. No enviado. No reintentar.');
}

/** Drain in one persisted update; notices are independent immutable tail messages. */
export function drainAgentNotes(sessionId: string): void {
  patchSession(sessionId, (s) => {
    if (!s.agent.notes.length) return s;
    return { ...s, agent: { ...s.agent, notes: [], history: [...s.agent.history,
      ...s.agent.notes.map((note) => ({ role: 'user' as const, content: note.startsWith('[app]') ? note : `[app] ${note}` }))] } };
  });
}

/** Reconcile terminal generations without any provider/LLM call, including after reload. */
export function recordPriceResults(sessionId: string, itemId: string): void {
  const generations = useStore.getState().generations;
  patchSession(sessionId, (s) => {
    const item = s.feed.find((f) => f.id === itemId);
    if (item?.type !== 'plan') return s;
    const notes: string[] = [];
    const reviews = Object.fromEntries(Object.entries(item.stepCostReviews ?? {}).map(([stepId, review]) => {
      const decisions = review.decisions?.map((record) => {
        const g = generations[record.generationId];
        if (record.decision !== 'continue' || record.result || !g || !['done', 'error', 'canceled'].includes(g.status)) return record;
        const status = g.status as 'done' | 'error' | 'canceled';
        const cost = g.providerReportedUsd != null && Number.isFinite(g.providerReportedUsd) && g.providerReportedUsd >= 0 ? g.providerReportedUsd : undefined;
        notes.push(`[app] Plan ${short(item.plan.id)}, paso ${short(stepId)}. Estado: ${status === 'done' ? 'terminado' : 'fallido'}. ${cost == null ? 'coste real desconocido' : `coste informado por el proveedor: $${cost}`}.`);
        return { ...record, result: { status, reportedAt: Date.now(), providerReportedUsd: cost } };
      });
      return [stepId, decisions ? { ...review, decisions } : review];
    }));
    if (!notes.length) return s;
    return { ...s, feed: s.feed.map((f) => f.id === itemId ? { ...item, stepCostReviews: reviews } : f),
      agent: { ...s.agent, notes: [...s.agent.notes, ...notes] } };
  });
}
