import { uid } from '../../lib/id';
import { resolveOwner } from './lanes';
import { updateFeedItem } from '../../store/store';
import type { PlanFeedItem } from '../types';
import { prepareNodeRun, previewRun } from '../flow/actions';
import { runApproved } from '../nodecore/action';
import { pushHistory } from './conversation';
import { agentOf, patchAgent } from './runtimeShared';
import { overLimit, overLimitText, rerunNote } from '../budget';
import { closeRequest } from './metrics';
import { wrapUpPlan } from './planRun';

/** One approval in flight per card. */
const nodeApprovals = new Map<string, Promise<void>>();
export function approveNodeRun(sessionId: string, item: PlanFeedItem): Promise<void> {
  const key = `${sessionId}:${item.id}`;
  const open = nodeApprovals.get(key);
  if (open) return Promise.resolve();
  // The card says so at once, so no second click finds it waiting; a refusal below puts it back.
  updateFeedItem<PlanFeedItem>(sessionId, item.id, { status: 'running' });
  const promise = approveNodeRunNow(sessionId, item).finally(() => nodeApprovals.delete(key));
  nodeApprovals.set(key, promise);
  return promise;
}

async function approveNodeRunNow(sessionId: string, item: PlanFeedItem): Promise<void> {
  const owner = resolveOwner(sessionId, item.meta?.agentNodeId);
  const request = item.nodeRun!;
  const preview = await prepareNodeRun(sessionId, request.targets, request.force);
  if (preview.signature !== request.signature || preview.errors.length) {
    updateFeedItem<PlanFeedItem>(sessionId, item.id, {
      status: 'awaiting', nodeRun: { ...request, signature: preview.signature }, plan: { ...item.plan, steps: preview.steps }, estimate: preview.estimate,
      error: preview.errors.join(' ') || 'The execution changed. Review this version and approve again.',
    });
    return;
  }
  if (overLimit(preview.estimate, sessionId)) { updateFeedItem(sessionId, item.id, { status: 'awaiting', estimate: preview.estimate, error: overLimitText(preview.estimate) }); return; }
  updateFeedItem<PlanFeedItem>(sessionId, item.id, { status: 'running', error: undefined, stepStates: {} });
  const running = runApproved(sessionId, request.targets, request.force, preview, uid('run'), (id, state, info) => {
    updateFeedItem<PlanFeedItem>(sessionId, item.id, it => ({ ...it, stepStates: { ...it.stepStates, [id]: state }, stepGenerations: info?.generationId ? { ...it.stepGenerations, [id]: info.generationId } : it.stepGenerations }));
  });
  const record = await running;
  const result = record.result;
  if (!result) {
    const next = previewRun(sessionId, request.targets, request.force);
    updateFeedItem<PlanFeedItem>(sessionId, item.id, { status: 'awaiting', nodeRun: { ...request, signature: next.signature }, plan: { ...item.plan, steps: next.steps }, estimate: next.estimate, error: next.errors.join(' ') || rerunNote(next.estimate, sessionId) });
    return;
  }
  const status = result.failed.length || result.skipped.length ? result.outputs.size ? 'partial' : 'error' : 'done';
  updateFeedItem<PlanFeedItem>(sessionId, item.id, { status, error: result.failed.map(f => `${f.stepId}: ${f.error}`).join(' · ') || undefined });
  const pending = agentOf(sessionId, owner).pending;
  const closesRequest = pending?.feedItemId === item.id;
  if (closesRequest) {
    if (pending.toolCallId) pushHistory(sessionId, { role: 'tool', tool_call_id: pending.toolCallId, content: `User approved existing node execution. ${status}: ${[...result.outputs].map(([id, out]) => `${id}: ${out.assetIds.join(',')}`).join('; ')}` }, owner);
    patchAgent(sessionId, { pending: undefined, questionRound: 0, draft: undefined }, owner);
  }
  await wrapUpPlan(sessionId, item.id, item.plan.title, status, `${status}: ${preview.runIds.join(', ')}`);
  if (closesRequest) closeRequest(sessionId, 'approved', preview.estimate.usd);
}

