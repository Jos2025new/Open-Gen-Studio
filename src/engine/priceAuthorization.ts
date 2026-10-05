import { updateFeedItem, patchGeneration, useStore } from '../store/store';
import { logEvent } from '../lib/log';
import { journeyActive, journeyIdFor, recordJourneyEvent } from '../lib/journeyTrace';
import type { Estimate, GenSettings, StepAuthorization, Generation, PlanFeedItem } from './types';

export function costAuthorization(modelRef: string, settings: GenSettings, estimate: Estimate, operationFactor?: number): StepAuthorization {
  return {
    modelRef,
    parameters: {
      ...(operationFactor != null ? { operationFactor } : {}),
      count: settings.count, aspect: settings.aspect, resolution: settings.resolution,
      duration: settings.duration, audio: settings.audio,
      advanced: { ...settings.advanced },
      ...(settings.shots?.length ? { shotDurations: settings.shots.map(s => s.duration) } : {}),
    },
    estimate: { ...estimate },
  };
}

export class PriceReviewRequired extends Error {}

function parameterKey(a: StepAuthorization): string {
  const p = a.parameters;
  return JSON.stringify({ ...p, advanced: Object.fromEntries(Object.entries(p.advanced).sort(([a], [b]) => a.localeCompare(b))) });
}

/** Only plan generations with a persisted approval are guarded; direct and existing-node runs keep their contract. */
export function checkStepAuthorization(g: Generation, proposed: StepAuthorization): void {
  if (!g.planId || !g.stepId) return;
  const item = useStore.getState().sessions[g.sessionId]?.feed.find((f): f is PlanFeedItem => f.type === 'plan' && f.plan.id === g.planId);
  const stepId = item?.plan.workspace === 'node' ? g.stepId.replace(`${g.planId}_`, '') : g.stepId;
  const approved = item?.stepAuthorizations?.[stepId];
  if (!item || !approved) return;
  const variantChanged = approved.modelRef !== proposed.modelRef;
  const changed = variantChanged || parameterKey(approved) !== parameterKey(proposed);
  const before = approved.estimate.usd;
  const after = proposed.estimate.usd;
  const measurable = before != null && after != null;
  const increased = measurable && after - before > Math.max(0.01, before * 0.05) + 1e-9;
  const name = useStore.getState().catalog.models[proposed.modelRef]?.name ?? proposed.modelRef;
  const reason = variantChanged
    ? `cambió a ${name}${g.inputs.refs.length || g.inputs.firstFrame ? ' porque lleva una imagen' : ''}`
    : 'cambiaron los parámetros de coste';
  const data = { event: 'plan-step-cost-stopped', planId: g.planId, stepId, generationId: g.id, approvedModel: approved.modelRef, newModel: proposed.modelRef, approvedEstimate: approved.estimate, newEstimate: proposed.estimate };
  if (changed && increased) {
    const message = `Este paso costaría $${after.toFixed(2)} en vez de $${before.toFixed(2)} aprobados: ${reason}.`;
    updateFeedItem<PlanFeedItem>(g.sessionId, item.id, it => ({ ...it, stepCostReviews: { ...it.stepCostReviews, [stepId]: { approved, proposed, message, reason, decisions: it.stepCostReviews?.[stepId]?.decisions } }, stepStates: { ...it.stepStates, [stepId]: 'review' } }));
    patchGeneration(g.id, { status: 'review', statusText: 'Necesita revisión', error: undefined });
    logEvent('app', data);
    if (journeyActive()) recordJourneyEvent({ journeyId: journeyIdFor(g.sessionId) ?? g.sessionId, journey: 'price-approval-execution', event: 'plan.step_cost_stopped', reason, sessionId: g.sessionId, planId: g.planId, stepId, generationId: g.id, prices: { acceptedEstimateUsd: before, currentEstimateUsd: after } });
    throw new PriceReviewRequired(message);
  }
  if (variantChanged && !measurable) {
    const message = `Se usó ${name}${g.inputs.refs.length || g.inputs.firstFrame ? ', la variante de edición porque lleva una imagen' : ', una variante distinta'}. Precio desconocido.`;
    if (item.stepVariantNotes?.[stepId] !== message) {
      updateFeedItem<PlanFeedItem>(g.sessionId, item.id, it => ({ ...it, stepVariantNotes: { ...it.stepVariantNotes, [stepId]: message } }));
      logEvent('app', { ...data, event: 'plan-step-variant-used' });
    }
  }
}
