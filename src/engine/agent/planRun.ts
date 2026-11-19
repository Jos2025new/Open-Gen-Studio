import { claimLaneOfItem, laneOfItem, laneState, patchLane, resolveOwner, viewedLane } from './lanes';
import { shapeLabel } from '../delivery';
import { restoreNodeDeletion } from '../flow/actions';
import { prepareNodeRun } from '../flow/actions';
import { uid } from '../../lib/id';
import { logEvent } from '../../lib/log';
import { journeyIdFor, recordJourneyEvent } from '../../lib/journeyTrace';
import { parseRef, pruneJoins, stepDeps, stepOutputKind } from '../plan';
import { adjustedNote } from '../planRevision';
import { continuityErrors } from '../continuity';
import { executeSteps, estimateSteps, type StepOutput } from '../executor';
import { finalPlanStatus, reviewOpen } from '../planStop';
import { patchGeneration } from '../../store/store';
import { generationInFlight, canRecheck, recheckGeneration, retryGeneration } from '../jobs';
import { graphToSteps, runsGeneration } from '../flow/graph';
import { ensureDoc, getDoc, placeAsset } from '../design/actions';
import { modelSummary } from '../catalog';
import type { ChatMessageMeta } from '../feedMeta';
import type { GraphNodeData, PlanFeedItem, PlanStep, StepState } from '../types';
import { appendFeed, toast, updateFeedItem } from '../../store/store';
import { applyEdit } from '../nodecore/edit';
import { WRAPUP_RULE } from './context';
import { editPairParts, WRAPUP_COMPARE_RULE } from './wrapUpPairs';
import { agentSeesImages, userMessage } from './attachments';
import { closeRequest } from './metrics';
import { drainAgentNotes, priceDecision, priceDecisionNote, recordPriceResults } from './priceNotes';
import { overLimit, overLimitText } from '../budget';
import { confirmApproved, inheritApproved } from './inherit';
import { lineKey, variantRoute } from '../variants';
import { failedStepSummary } from './failureContext';
import { agentEngine, agentOf, closeRevisedPlan, feedOfAgent, designerDims, feedBase, get, messageMeta, patchAgent, session, setThreadOpen, toCanvasOfItem, turnCanvas } from './runtimeShared';
import { pushHistory } from './conversation';
import { approveNodeRun } from './planNodeRun';
import { llmTurn } from './llmTurn';

export function removeDraftNodes(sessionId: string, planId: string): void {
  const g = session(sessionId)?.graph;
  const drop = g?.nodes.filter((n) => n.planId === planId && !(runsGeneration(n.data) && n.data.generationId)).map((n) => n.id) ?? [];
  // Through the layer: a cable some other node had from a draft stays as an invalid cable, like any deletion.
  if (drop.length) applyEdit({ session: sessionId, op: { op: 'delete', nodes: drop } });
}

// ---------------------------------------------------------------------------
// Plan approval & execution


export async function approvePlan(sessionId: string, itemId: string): Promise<void> {
  claimLaneOfItem(sessionId, itemId);
  const owner = laneOfItem(sessionId, itemId);
  toCanvasOfItem(sessionId, itemId);
  const s = session(sessionId);
  const item = s.feed.find((f) => f.id === itemId);
  if (!item || item.type !== 'plan' || item.status !== 'awaiting') return;
  if (agentOf(sessionId, owner).revising === itemId) return; // its agent is rewriting it: the old plan must not run
  if (item.nodeRun) { await approveNodeRun(sessionId, item); return; }
  const { plan } = item;
  const off = new Set(item.skipped ?? []);
  // A join over clips the user unchecked joins only the clips that run (or is dropped when fewer than two remain).
  const pruned = pruneJoins(plan.steps.filter((st) => !off.has(st.id)), off);
  for (const id of pruned.dropped) off.add(id);
  const chosen = pruned.steps;
  if (!chosen.length) return;
  // Re-estimate: models or prices may have loaded since the plan was shown.
  const { total, authorizations } = estimateSteps(chosen);
  recordJourneyEvent({ journeyId: journeyIdFor(sessionId) ?? sessionId, journey: 'price-approval-execution', event: 'plan.approval_attempted', reason: 'approval requested; budget check pending', sessionId, planId: plan.id, approvalId: item.id, before: { status: item.status, skipped: [...off] }, after: { status: item.status, stepIds: chosen.map((step) => step.id) }, prices: { storedEstimateUsd: item.estimate.usd, liveEstimateUsd: total.usd } });
  // Over an active limit, the card asks first ("Continue once"); approving without that stops here.
  if (overLimit(total, sessionId)) {
    toast(overLimitText(total), 'error');
    return;
  }
  recordJourneyEvent({ journeyId: journeyIdFor(sessionId) ?? sessionId, journey: 'price-approval-execution', event: 'plan.approved', reason: 'per-step authorization accepted for current plan estimate', sessionId, planId: plan.id, approvalId: item.id, before: { status: item.status, skipped: [...off] }, after: { status: 'running', stepIds: chosen.map((step) => step.id) }, prices: { storedEstimateUsd: item.estimate.usd, liveEstimateUsd: total.usd, acceptedEstimateUsd: total.usd } });
  const pending = agentOf(sessionId, owner).pending;
  const closesRequest = pending?.feedItemId === itemId;
  if (closesRequest) {
    const note = off.size ? ` The user unchecked ${[...off].join(', ')}: they will not run. Running ${chosen.map((st) => st.id).join(', ')}.` : '';
    if (pending.toolCallId) pushHistory(sessionId, { role: 'tool', tool_call_id: pending.toolCallId, content: `Approved by the user.${note}${adjustedNote(plan)} The app is executing the plan now.` }, owner);
    if (item.style === 'direct') inheritApproved(sessionId, owner, chosen, item.comparisonKinds);
    else if (item.style === 'auto') confirmApproved(sessionId, owner, chosen, item.comparisonKinds);
    patchAgent(sessionId, { pending: undefined, questionRound: 0, draft: undefined }, owner);
  }
  updateFeedItem<PlanFeedItem>(sessionId, itemId, (it) => ({
    ...it,
    status: 'running',
    estimate: total,
    stepAuthorizations: authorizations,
    stepStates: { ...it.stepStates, ...Object.fromEntries([...off].map((sid) => [sid, 'skipped' as StepState])) },
  }));

  await runPlanItem(sessionId, itemId, chosen, off);
  if (closesRequest) closeRequest(sessionId, 'approved', total.usd);
}

export async function presentNodeRun(sessionId: string, targets: string[], toolCallId: string | null = null, meta?: ChatMessageMeta, owner: string = resolveOwner(sessionId)): Promise<{ errors: string[]; itemId?: string }> {
  if (!targets.length) return { errors: ['Select at least one existing node.'] };
  const graph = session(sessionId).graph;
  const missing = targets.find(id => !graph.nodes.some(n => n.id === id && runsGeneration(n.data)));
  if (missing) return { errors: [`No runnable node: ${missing}.`] };
  const preview = await prepareNodeRun(sessionId, targets);
  if (preview.errors.length) return { errors: preview.errors };
  const item: PlanFeedItem = {
    ...feedBase('node'), type: 'plan', style: get().composer.agentStyle, status: 'awaiting',
    nodeRun: { targets, force: true, signature: preview.signature },
    plan: { id: uid('pln'), title: 'Run existing nodes', summary: 'Existing node IDs and required upstream updates. No new flow is created.', workspace: 'node', steps: preview.steps, adjustments: [] },
    estimate: preview.estimate, stepStates: {}, stepGenerations: {},
    meta: meta ?? messageMeta('node', {}, sessionId, owner),
  };
  closeRevisedPlan(sessionId, false, owner);
  appendFeed(sessionId, item);
  patchAgent(sessionId, { pending: { toolCallId, kind: 'plan', feedItemId: item.id } }, owner);
  setThreadOpen(true);
  return { errors: [], itemId: item.id };
}

export function undoNodeDeletion(sessionId: string, itemId: string): string | null {
  const error = restoreNodeDeletion(sessionId, itemId);
  if (error) toast(error, 'error');
  return error;
}

/**
 * Execute a plan card's steps and report back to the card and the agent. Resuming (Check status / Retry failed):
 * `resume.prior` holds the steps already done, `resume.blocked` the ones that failed again.
 */
const planRuns = new Map<string, Promise<void>>();

type PlanResume = { prior: Map<string, StepOutput>; blocked: Map<string, string>; waiting?: Set<string>; reuseGenerations?: Record<string, string> };

function runPlanItem(sessionId: string, itemId: string, chosen: PlanStep[], off: Set<string>, resume?: PlanResume): Promise<void> {
  const key = `${sessionId}:${itemId}`;
  const existing = planRuns.get(key);
  if (existing) return existing;
  const promise: Promise<void> = executePlanItem(sessionId, itemId, chosen, off, resume).finally(() => { if (planRuns.get(key) === promise) planRuns.delete(key); });
  planRuns.set(key, promise);
  return promise;
}

async function executePlanItem(
  sessionId: string,
  itemId: string,
  chosen: PlanStep[],
  off: Set<string>,
  resume?: PlanResume,
): Promise<void> {
  const item = session(sessionId).feed.find((f) => f.id === itemId);
  if (!item || item.type !== 'plan') return;
  const { plan } = item;
  const workspace = plan.workspace;
  let steps = chosen;
  const nodeOf = (stepId: string) => `${plan.id}_${stepId}`;
  if (workspace === 'node') {
    // Run what is on the canvas now (the user may have edited the drafted nodes).
    const graph = session(sessionId).graph;
    const ids = graph.nodes.filter((n) => n.planId === plan.id && !off.has(n.id.replace(`${plan.id}_`, ''))).map((n) => n.id);
    const run = graphToSteps(graph, ids, get().generations, { assets: get().assets });
    if (run.errors.length) {
      updateFeedItem<PlanFeedItem>(sessionId, itemId, { status: 'error', error: run.errors.join(' ') });
      return;
    }
    steps = run.steps;
  }
  let docId: string | undefined;
  if (workspace === 'designer') docId = ensureDoc(sessionId, designerDims()).id;

  if (plan.continuity?.length) {
    const ids = new Set(steps.map(s => s.id));
    const mapSource = (ref: string) => workspace === 'node' && parseRef(ref)?.type === 'step' ? nodeOf(ref) : ref;
    const groups = plan.continuity.map(g => ({ ...g, source: mapSource(g.source), steps: g.steps.map(id => workspace === 'node' ? nodeOf(id) : id).filter(id => ids.has(id)) }));
    const subjects = plan.subjects?.map(s => ({ ...s, from: mapSource(s.from) }));
    const errors = continuityErrors(groups, steps, subjects, get().library, get().catalog.schemas);
    // What each step keeps from which source is for debugging, not for the card: the reference use is checked, fidelity is not.
    logEvent('agent', { event: 'plan.continuity', sessionId, planId: plan.id, groups: groups.map((g) => ({ keep: g.preserve, from: g.source, steps: g.steps })), check: errors.length ? errors : 'references used' });
    if (errors.length) {
      updateFeedItem<PlanFeedItem>(sessionId, itemId, { status: 'error', error: errors.join(' ') });
      return;
    }
  }
  const result = await executeSteps(steps, {
    ...(resume ? { prior: resume.prior, blocked: resume.blocked, waiting: resume.waiting, reuseGenerations: resume.reuseGenerations } : {}),
    canceled: new Set(item.canceledSteps ?? []),
    sessionId,
    planId: plan.id,
    workspace,
    origin: 'agent',
    docId,
    // Node runs use node ids as step ids.
    subjects: workspace === 'node' ? plan.subjects?.map((x) => (parseRef(x.from)?.type === 'step' ? { ...x, from: nodeOf(x.from) } : x)) : plan.subjects,
    onState: (stepId, state, info) => {
      // Node runs use node ids as step ids; map back to plan step ids for the card.
      const planStepId = workspace === 'node' ? stepId.replace(`${plan.id}_`, '') : stepId;
      updateFeedItem<PlanFeedItem>(sessionId, itemId, (it) => ({
        ...it,
        stepStates: { ...it.stepStates, [planStepId]: state },
        stepGenerations: info?.generationId ? { ...it.stepGenerations, [planStepId]: info.generationId } : it.stepGenerations,
      }));
      if (state === 'done' || state === 'error') recordPriceResults(sessionId, itemId);
      if (info?.generationId) {
        // The Designer shows each generation's card in its conversation too (it also lands on the page).
        if (workspace === 'chat' || workspace === 'designer') {
          appendFeed(sessionId, { ...feedBase(workspace), type: 'generation', generationId: info.generationId });
        } else if (workspace === 'node') {
          const nodeId = stepId.startsWith(`${plan.id}_`) ? stepId : nodeOf(stepId);
          const bound = session(sessionId).graph.nodes.find((n) => n.id === nodeId);
          if (bound && runsGeneration(bound.data)) applyEdit({ session: sessionId, op: { op: 'set', node: nodeId, patch: { generationId: info.generationId } as Partial<GraphNodeData> } });
        }
      }
    },
  });

  // Designer: a final image the plan did not put on a layer goes on the page as a new layer (kept in Generations too).
  if (workspace === 'designer' && docId) {
    const used = new Set(steps.flatMap((st) => stepDeps(st)).map((r) => parseRef(r)).flatMap((p) => (p?.type === 'step' ? [p.id] : [])));
    for (const st of steps) {
      if (stepOutputKind(st) !== 'image' || used.has(st.id)) continue;
      for (const a of result.outputs.get(st.id)?.assetIds ?? []) {
        const doc = getDoc(sessionId, docId);
        if (!doc || doc.layers.some((l) => 'sourceAssetId' in l && l.sourceAssetId === a)) continue;
        // A result that never lands on the canvas is otherwise invisible (T5).
        await placeAsset(sessionId, docId, a, doc.layers.length ? 'new' : 'base', 'title' in st && st.title ? st.title : 'Image').catch((e: Error) => {
          logEvent('app', { session: sessionId, event: 'designer-place-failed', doc: docId, asset: a, message: e.message });
          return null;
        });
      }
    }
  }

  const failed = result.failed.length;
  const status = finalPlanStatus(result);
  updateFeedItem<PlanFeedItem>(sessionId, itemId, { status, stepOutputs: Object.fromEntries(result.outputs), error: failed ? result.failed.map((f) => `${f.stepId}: ${f.error}`).join(' · ') : undefined });
  const summary = plan.steps
    .map((st) => {
      const key = workspace === 'node' ? nodeOf(st.id) : st.id;
      const out = result.outputs.get(key);
      const fail = result.failed.find((f) => f.stepId === key);
      if (fail) return failedStepSummary(sessionId, itemId, st.id, fail.error);
      if (off.has(st.id)) return `${st.id} not run (unchecked by the user)`;
      if (result.waiting.includes(key)) {
        const current = session(sessionId).feed.find((f): f is PlanFeedItem => f.type === 'plan' && f.id === itemId);
        return current?.stepCostReviews?.[st.id] ? `${st.id} needs cost review: ${current.stepCostReviews[st.id].message} Not sent.` : `${st.id} waiting for a reviewed step`;
      }
      if (!out) return `${st.id} skipped`;
      // O3: what came back different from what was asked, for the closing message.
      const genId = session(sessionId).feed.find((f): f is PlanFeedItem => f.id === itemId && f.type === 'plan')?.stepGenerations?.[st.id];
      const delivery = genId ? get().generations[genId]?.delivery : undefined;
      // The model that really ran, not one only asked for.
      const ran = genId ? get().generations[genId]?.modelRef : undefined;
      // …and what came out (size, length).
      const first = out.assetIds[0] ? get().assets[out.assetIds[0]] : undefined;
      // The confirmed model's own variant for these inputs is the same choice.
      const conf = Object.values(agentOf(sessionId, laneOfItem(sessionId, itemId)).settings ?? {}).find((c) => c && c.modelRef !== ran && modelSummary(c.modelRef) && modelSummary(ran ?? '') && lineKey(modelSummary(c.modelRef)!) === lineKey(modelSummary(ran!)!));
      const facts = [ran ? `made with ${modelSummary(ran)?.name ?? ran}${conf ? ` (the ${variantRoute(modelSummary(ran!)!)} variant of the confirmed ${modelSummary(conf.modelRef)!.name}: the same model, not a change)` : ''}` : '', first?.width && first.height ? `${shapeLabel(first.width, first.height)}, ${first.width}×${first.height}` : '', first?.duration ? `${Math.round(first.duration)}s` : ''].filter(Boolean);
      const by = facts.length ? ` (${facts.join(', ')})` : '';
      if (out.assetIds.length) return `${st.id}${by} → ${out.assetIds.length > 1 ? out.assetIds.map((a, i) => `#${i + 1} asset:${a}`).join(', ') : `asset:${out.assetIds[0]}`}${delivery?.length ? ` (delivered differs: ${delivery.join('; ')})` : ''}`;
      if (out.layerId) return `${st.id} → layer ${out.layerId}`;
      return `${st.id} done`;
    })
    .join('; ');
  recordPriceResults(sessionId, itemId);
  // The end of a plan is told to the agent that raised it, whoever is on screen now.
  patchLane(sessionId, laneOfItem(sessionId, itemId), (a) => ({ notes: [...a.notes, `Plan "${plan.title}" (${plan.workspace} canvas) ${status}: ${summary}`] }));
  if (status === 'done') toast(`${plan.title} · done`, 'success');
  else if (status === 'partial') toast(`${plan.title} finished with ${failed} failed step${failed === 1 ? '' : 's'}`, 'error');
  else if (status === 'error') toast(`${plan.title} failed`, 'error');
  // The steps are over: a Retry clicked while the closing message is written starts its own run instead of being handed this one.
  planRuns.delete(`${sessionId}:${itemId}`);
  if (status !== 'review') await wrapUpPlan(sessionId, itemId, plan.title, status, summary);
}

/** Claim the waiting step synchronously; another click cannot authorize or send it again. */
export async function resolveStepCostReview(sessionId: string, itemId: string, stepId: string, decision: 'continue' | 'cancel'): Promise<void> {
  claimLaneOfItem(sessionId, itemId);
  const owner = laneOfItem(sessionId, itemId);
  const item = session(sessionId)?.feed.find((f): f is PlanFeedItem => f.id === itemId && f.type === 'plan');
  const review = item?.stepCostReviews?.[stepId];
  const generationId = item?.stepGenerations[stepId];
  if (!item || !review || !generationId || !reviewOpen(item, stepId)) return;
  const record = priceDecision(review, generationId, decision);
  updateFeedItem<PlanFeedItem>(sessionId, itemId, it => ({
    ...it,
    stepCostReviews: { ...it.stepCostReviews, [stepId]: { ...review, decisions: [...(review.decisions ?? []), record] } },
    stepStates: { ...it.stepStates, [stepId]: decision === 'continue' ? 'running' : 'skipped' },
    stepAuthorizations: decision === 'continue' ? { ...it.stepAuthorizations, [stepId]: review.proposed } : it.stepAuthorizations,
    canceledSteps: decision === 'cancel' ? [...(it.canceledSteps ?? []), stepId] : it.canceledSteps,
  }));
  patchAgent(sessionId, (a) => ({ notes: [...a.notes, priceDecisionNote(item.plan.id, stepId, record)] }), owner);
  patchGeneration(generationId, { status: decision === 'continue' ? 'queued' : 'canceled', statusText: undefined });
  // Independent steps already in flight finish first; their results are then reused, including after reload.
  await planRuns.get(`${sessionId}:${itemId}`);
  const latest = session(sessionId)?.feed.find((f): f is PlanFeedItem => f.id === itemId && f.type === 'plan');
  if (!latest) return;
  const { chosen, off } = approvedSteps(latest);
  const prior = new Map(Object.entries(latest.stepOutputs ?? {}));
  const blocked = new Map<string, string>();
  const waiting = new Set<string>();
  const reuseGenerations: Record<string, string> = {};
  for (const st of chosen) {
    const gid = latest.stepGenerations[st.id];
    const gen = gid ? get().generations[gid] : undefined;
    if (gen?.status === 'done') prior.set(st.id, { assetIds: gen.assetIds, text: gen.text });
    else if (gen?.status === 'review') waiting.add(st.id);
    else if (gen?.status === 'queued' || (gen?.status === 'running' && generationInFlight(gen.id))) reuseGenerations[st.id] = gen.id;
    else if (gen?.status === 'running') blocked.set(st.id, 'Interrupted by reload; check the existing generation before retrying.');
    else if (latest.stepStates[st.id] === 'error') blocked.set(st.id, gen?.error ?? 'Failed');
  }
  updateFeedItem<PlanFeedItem>(sessionId, itemId, it => ({ ...it, status: 'running', stepStates: { ...it.stepStates, ...Object.fromEntries([...blocked.keys()].map(id => [id, 'error' as StepState])) } }));
  await runPlanItem(sessionId, itemId, chosen, off, { prior, blocked, waiting, reuseGenerations });
}

/**
 * S4: brief closure after a plan. Skip without an LLM, while busy/pending, or after a new user message.
 */
export async function wrapUpPlan(sessionId: string, itemId: string, title: string, status: PlanFeedItem['status'], summary: string): Promise<void> {
  // The closing message is written by the agent that owns the plan, from its own state, whichever agent is on screen.
  const owner = laneOfItem(sessionId, itemId);
  if (!owner || viewedLane(session(sessionId)) === owner) toCanvasOfItem(sessionId, itemId);
  const s = session(sessionId);
  const own = laneState(sessionId, owner);
  if (!s || !own || agentEngine(sessionId, owner).kind !== 'llm' || own.busy || own.pending) return;
  const mine = feedOfAgent(sessionId, owner);
  const at = mine.findIndex((f) => f.id === itemId);
  if (at < 0 || mine.slice(at + 1).some((f) => f.type === 'user')) return;
  const item = mine[at];
  drainAgentNotes(sessionId, owner);
  // After an edit the agent gets the original and the result to compare; otherwise it has not seen the result.
  const pairs = item.type === 'plan' && agentSeesImages(sessionId, owner) ? await editPairParts(item) : [];
  pushHistory(sessionId, userMessage(`[app] Plan "${title}" finished (${status}): ${summary}
${pairs.length ? WRAPUP_COMPARE_RULE : WRAPUP_RULE}`, pairs), owner);
  await llmTurn(sessionId, turnCanvas(item.workspace), { textOnly: true, route: 'wrap-up', agentNodeId: owner });
}

// ---------------------------------------------------------------------------
// Recovering a plan with failed steps (Check status / Retry failed)

import { approvedSteps, planRecovery, planRecoveryProblem, type PlanRecoveryMode } from './planRecovery';
export { planRecovery, planRecoveryProblem, type PlanRecoveryMode };

/**
 * Resume a plan with failed steps, in the same card. "check" asks the providers again about the jobs they received
 * (no new charge for those); "retry" runs the failed steps again (charged again). Failed generations run again in
 * their own chat cards; steps done before are reused; the steps that waited for the failed ones run afterwards.
 * Returns a short summary for the agent.
 */
export async function resumePlan(sessionId: string, itemId: string, mode: PlanRecoveryMode): Promise<string> {
  claimLaneOfItem(sessionId, itemId);
  toCanvasOfItem(sessionId, itemId);
  const item = session(sessionId)?.feed.find((f) => f.id === itemId);
  if (!item || item.type !== 'plan') return 'No such plan.';
  const problem = planRecoveryProblem(item, mode, sessionId);
  if (problem) return problem;
  const { chosen, off } = approvedSteps(item);
  const failedIds = chosen.filter((st) => item.stepStates[st.id] === 'error').map((st) => st.id);
  const genOf = (id: string) => get().generations[item.stepGenerations[id] ?? ''];
  updateFeedItem<PlanFeedItem>(sessionId, itemId, (it) => ({
    ...it,
    status: 'running',
    error: undefined,
    stepStates: { ...it.stepStates, ...Object.fromEntries(failedIds.filter((id) => mode === 'retry' || (genOf(id) && canRecheck(genOf(id)))).map((id) => [id, 'running' as StepState])) },
  }));
  // The failed generations first, in their own cards: fetched again (check) or run again (retry).
  const blocked = new Map<string, string>();
  const recovered = new Set<string>();
  const waiting = new Set<string>();
  await Promise.all(
    failedIds.map(async (id) => {
      const g = genOf(id);
      if (!g) {
        // Failed before it could start a generation: a retry runs the step again; a check has nothing to ask.
        if (mode === 'check') blocked.set(id, item.error?.split(' · ').find((e) => e.startsWith(`${id}:`))?.slice(id.length + 2) ?? 'Failed');
        return;
      }
      if (mode === 'check' && !canRecheck(g)) {
        blocked.set(id, g.error ?? 'Failed');
        return;
      }
      // A step that fails again rejects here; its card shows the error, the plan must still settle.
      await (mode === 'check' ? recheckGeneration(g.id) : retryGeneration(g.id)).catch(() => undefined);
      // A retry creates a new attempt and relinks the plan's step → generation mapping itself (jobs.ts relinkAttempt).
      // The latest attempt of the same operation is the one whose status counts.
      const opId = g.operationId ?? g.id;
      const latestAttempt = Object.values(get().generations)
        .filter(x => (x.operationId ?? x.id) === opId)
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      const after = latestAttempt ?? get().generations[g.id];
      if (after?.status === 'done') recovered.add(id);
      else if (after?.status === 'review') waiting.add(id);
      else blocked.set(id, after?.error ?? 'Failed');
    }),
  );
  const prior = new Map<string, StepOutput>();
  for (const st of chosen) {
    if (item.stepStates[st.id] !== 'done' && !recovered.has(st.id)) continue;
    const g = genOf(st.id);
    prior.set(st.id, g ? { assetIds: g.assetIds, text: g.text } : st.kind === 'text' ? { assetIds: [], text: st.text } : { assetIds: [], layerId: null });
  }
  updateFeedItem<PlanFeedItem>(sessionId, itemId, (it) => ({
    ...it,
    stepStates: { ...it.stepStates, ...Object.fromEntries([...recovered].map((id) => [id, 'done' as StepState])), ...Object.fromEntries([...blocked.keys()].map((id) => [id, 'error' as StepState])) },
  }));
  await runPlanItem(sessionId, itemId, chosen, off, { prior, blocked, waiting });
  const done = session(sessionId).feed.find((f) => f.id === itemId);
  const status = done?.type === 'plan' ? done.status : 'error';
  return `${mode === 'check' ? 'Checked' : 'Retried'} "${item.plan.title}": ${status === 'done' ? 'all steps done' : status === 'partial' ? `finished with errors (${done?.type === 'plan' ? done.error : ''})` : `still failing (${done?.type === 'plan' ? done.error : ''})`}.`;
}

export function cancelPlan(sessionId: string, itemId: string): void {
  claimLaneOfItem(sessionId, itemId);
  const owner = laneOfItem(sessionId, itemId);
  toCanvasOfItem(sessionId, itemId);
  const s = session(sessionId);
  const item = s.feed.find((f) => f.id === itemId);
  if (!item || item.type !== 'plan' || item.status !== 'awaiting') return;
  updateFeedItem<PlanFeedItem>(sessionId, itemId, { status: 'canceled' });
  removeDraftNodes(sessionId, item.plan.id);
  const pending = agentOf(sessionId, owner).pending;
  if (pending?.feedItemId === itemId) {
    if (pending.toolCallId) pushHistory(sessionId, { role: 'tool', tool_call_id: pending.toolCallId, content: 'The user canceled this plan.' }, owner);
    closeRequest(sessionId, 'canceled');
    patchAgent(sessionId, { pending: undefined, questionRound: 0 }, owner);
  }
}

// ---------------------------------------------------------------------------
// LLM loop

/** Plain name of a guide for the activity block ("Seedance prompting guide", "Story / series workflow"). */
