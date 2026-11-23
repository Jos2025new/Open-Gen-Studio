import type { ChatMessageMeta } from '../feedMeta';
import { uid } from '../../lib/id';
import { appendFeed, removeTicket, saveNow, updateFeedItem, useStore } from '../../store/store';
import { beginOncePass, budgetProblem, dontAskAgain, dontAskUntilNextSession, type BudgetPass } from '../budget';
import { allCommands, command, findCommands, getApprover, run, type ApprovalRequest, type Approver } from '../commands';
import { COMMAND_REVIEW_CHANGED } from '../commands/types';
import type { FrozenCommandStep } from '../commands/run';
import { activeDoc, getDoc } from '../design/actions';
import { markAgentEdit } from '../design/agentGlow';
import { storeTickets } from '../money/storeBridge';
import {
  createTicket,
  FREE_PRICE,
  isFreePrice,
  isSendOut,
  markSendFailed,
  markSendInFlight,
  markSendUncertain,
  prepareSend,
  priceFromEstimate,
  settleSend,
  rollbackSendToPending,
  type ApprovalTicket,
} from '../money/ticket';
import { FREE, sumEstimates } from '../pricing';
import type { CommandApprovalFeedItem, Estimate } from '../types';
import { findCommandsSchema, runCommandsSchema } from './commandTools';

/* Runs find_commands and run_commands. The text is the tool result the agent reads. */

type ToolAnswer = { text: string; done: boolean };
const problems = (error: { issues: { path: PropertyKey[]; message: string }[] }) => error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ');
const RESULT_MAX = 4000;
/** Commands the agent never sees and never runs (id -> why). Whoever types the id gets the reason and nothing runs. */
export const AGENT_HIDDEN: Record<string, string> = {
  'models.composer.pick': 'the model is the user\'s choice',
  'models.composer.reset': 'the model is the user\'s choice',
  'models.agent.pick': 'the model is the user\'s choice',
  'models.agent.reset': 'the model is the user\'s choice',
  'skills.skill.select': 'the skill is the user\'s choice',
  'skills.workflow.select': 'the workflow is the user\'s choice',
  'sessions.select': 'it would move the user to another session in the middle of the agent\'s turn',
  'sessions.new': 'it would move the user to another session in the middle of the agent\'s turn',
  'sessions.archive': 'it hides sessions from the user\'s list',
};

/** What each area is for: the index `find_commands` answers when it gets neither `area` nor `text`. */
const AREAS: Record<string, string> = {
  designer: 'documents, layers, text, shapes, filters and effects of the Designer',
  nodes: 'the node graph: nodes, connections, layout and runs',
  studio: 'assets and generations: attach, estimate, regenerate, delete, start a generation',
  library: 'saved subjects, styles and voices',
  skills: 'read skills, workflows and guides',
  models: 'the model catalog (read only)',
  sessions: 'list, rename, pin and title sessions',
};
const NEEDS_APPROVAL = 'needs the user\'s approval';
const DOC_CREATORS = new Set(['designer.doc.new', 'designer.doc.ensure', 'designer.doc.from_asset']);
const ON_DOC_HINT = ' (target a new doc from an earlier step with "on": "$1.doc", or pass an id from designer.doc.list)';
const visible = <T extends { id: string }>(items: T[]) => items.filter((item) => !AGENT_HIDDEN[item.id]);
const areaOf = (id: string) => id.slice(0, id.indexOf('.'));
const formatLine = (f: { id: string; signature?: string; description?: string; title: string; effect: string; available?: unknown }) =>
  `${f.id} ${f.signature} — ${f.description ?? f.title}${f.effect === 'spend' || f.effect === 'delete' ? ` [${NEEDS_APPROVAL}]` : ''}${typeof f.available === 'string' ? ` [not now: ${f.available}]` : ''}`;

let catalogCache: { size: number; text: string } | undefined;
/** Static one-line reference of every command the agent may call, for the cached system prompt. Byte-identical across calls. */
export function commandCatalog(): string {
  const entries = visible(findCommands({ signatures: true }));
  if (catalogCache?.size === entries.length) return catalogCache.text;
  const text = [
    'COMMANDS FOR run_commands (all command ids and arguments; call run_commands directly without calling find_commands first):',
    ...entries.map(formatLine),
  ].join('\n');
  catalogCache = { size: entries.length, text };
  return text;
}

export type CommandApprovalDecision = 'approve' | 'once' | 'session' | 'until-next-session' | 'cancel';

interface PendingCommandApproval {
  sessionId: string;
  itemId: string;
  request: ApprovalRequest;
  resolve: (outcome: boolean | { approved: boolean; budgetPass?: BudgetPass; approvalTicketId?: string }) => void;
  setReleasePass: (fn: () => void) => void;
}

const pending = new Map<string, PendingCommandApproval>();
const replaying = new Set<string>();

const commandTicketId = (itemId: string) => `cmd:${itemId}`;
const stepSendId = (itemId: string, step: number) => `${itemId}:s${step}`;

function cloneSafe(val: unknown): unknown {
  if (val === undefined) return null;
  try { return JSON.parse(JSON.stringify(val)); } catch { return null; }
}

function frozenStepsOf(ticket: ApprovalTicket | undefined): FrozenCommandStep[] {
  return Array.isArray(ticket?.scope.steps) ? (ticket.scope.steps as FrozenCommandStep[]) : [];
}

function extractNodeIds(sequence: readonly FrozenCommandStep[] | undefined): string[] {
  const ids = new Set<string>();
  for (const s of sequence ?? []) {
    const a = s.args as { targets?: unknown; node?: unknown } | undefined;
    if (Array.isArray(a?.targets)) for (const t of a.targets) if (typeof t === 'string') ids.add(t);
    if (typeof a?.node === 'string') ids.add(a.node);
  }
  return [...ids];
}

function createCommandTicket(sessionId: string, itemId: string, request: ApprovalRequest): void {
  if (isFreePrice(priceFromEstimate(request.estimate)) && !request.steps.some((step) => step.effect === 'delete')) return;
  const sequence = (request.sequence ?? []).map((s) => ({
    ...s,
    ...(s.preRan ? { preResult: cloneSafe(s.preResult) } : {}),
  }));
  let ticket = createTicket({
    id: commandTicketId(itemId),
    sessionId,
    kind: 'commands',
    scope: { steps: sequence, nodeIds: extractNodeIds(sequence) },
    price: priceFromEstimate(request.estimate),
  });
  for (const s of sequence) {
    if (s.preRan) continue;
    // Orchestration slots track completed commands and references, without reserving money.
    ticket = prepareSend(ticket, {
      id: stepSendId(itemId, s.step),
      slotKey: `step:${s.step}`,
      index: s.step - 1,
      price: FREE_PRICE,
    });
  }
  storeTickets.put(ticket);
}

function markCommandStepStart(itemId: string, step: number): void {
  const ticket = storeTickets.get(commandTicketId(itemId));
  if (!ticket) return;
  const sid = stepSendId(itemId, step);
  const slot = ticket.sends.find((s) => s.id === sid);
  if (!slot || slot.status !== 'pending') return;
  storeTickets.put(markSendInFlight(ticket, sid));
}

function markCommandStepEnd(itemId: string, step: number, ok: boolean, val?: unknown, error?: string): void {
  const ticket = storeTickets.get(commandTicketId(itemId));
  if (!ticket) return;
  const sid = stepSendId(itemId, step);
  const slot = ticket.sends.find((s) => s.id === sid);
  let next = ticket;
  if (error === COMMAND_REVIEW_CHANGED) {
    if (slot?.status === 'in_flight') storeTickets.put(rollbackSendToPending(ticket, sid));
    return;
  }
  if (slot && (slot.status === 'in_flight' || slot.status === 'pending')) {
    const base = slot.status === 'pending' ? markSendInFlight(next, sid) : next;
    next = ok ? settleSend(base, sid, { costUsd: 0 }).ticket : markSendFailed(base, sid, error);
  }
  if (ok) {
    const steps = frozenStepsOf(next).map((s) => (s.step === step ? { ...s, preRan: true, preResult: cloneSafe(val) } : s));
    next = { ...next, scope: { ...next.scope, steps } };
  }
  storeTickets.put(next);
}

/**
 * After a reload, command cards left `running` transition any `in_flight` step slots to `uncertain`
 * (never auto-sending anything). If pending steps remain, the card returns to `awaiting` for one-click resume.
 */
export function settleInterruptedCommandCards(): void {
  for (const s of Object.values(useStore.getState().sessions)) {
    for (const f of s.feed) {
      if (f.type !== 'commands' || f.status !== 'running') continue;
      if (pending.has(f.id) || replaying.has(f.id)) continue;
      const ticket = storeTickets.get(commandTicketId(f.id));
      if (!ticket) {
        updateFeedItem<CommandApprovalFeedItem>(s.id, f.id, { status: 'error', error: 'Interrupted by a page reload.' });
        continue;
      }
      let next = ticket;
      for (const send of ticket.sends) {
        if (send.status === 'in_flight') next = markSendUncertain(next, send.id, 'Interrupted by reload');
      }
      if (next !== ticket) storeTickets.put(next);
      const hasPending = frozenStepsOf(next).some((step) => {
        if (step.preRan) return false;
        const slot = next.sends.find((x) => x.id === stepSendId(f.id, step.step));
        return !slot || slot.status === 'pending';
      });
      if (hasPending) {
        updateFeedItem<CommandApprovalFeedItem>(s.id, f.id, { status: 'awaiting' });
      } else {
        const hadProblem = next.sends.some((x) => x.status === 'uncertain' || x.status === 'failed');
        updateFeedItem<CommandApprovalFeedItem>(s.id, f.id, {
          status: hadProblem ? 'error' : 'done',
          ...(hadProblem ? { error: 'Interrupted by a page reload; already-sent steps were not re-submitted.' } : {}),
        });
      }
    }
  }
}

function refreshCommandReview(sessionId: string, itemId: string, stepNumber: number | undefined): boolean {
  const ticket = storeTickets.get(commandTicketId(itemId));
  const steps = frozenStepsOf(ticket);
  const stale = steps.find((step) => step.step === stepNumber);
  const spec = stale && command(stale.cmd);
  if (!ticket || !stale?.ready || !stale.onReady || !spec?.review) return false;
  try {
    const ctx = { on: stale.on, caller: 'agent' as const };
    const review = spec.review(ctx, stale.args);
    const estimate = spec.estimate?.(ctx, stale.args) ?? stale.estimate ?? FREE;
    const revised = steps.map((step) => step === stale ? { ...step, review, estimate } : step);
    const remaining = revised.filter((step) => !step.preRan && step.estimate && !ticket.sends.some(
      (send) => send.id === stepSendId(itemId, step.step) && isSendOut(send.status),
    ));
    storeTickets.put({ ...ticket, scope: { ...ticket.scope, steps: revised } });
    updateFeedItem<CommandApprovalFeedItem>(sessionId, itemId, {
      status: 'awaiting', error: COMMAND_REVIEW_CHANGED, estimate: sumEstimates(remaining.map((step) => step.estimate!)),
      steps: remaining.map((step) => ({
        step: step.step, cmd: step.cmd, title: step.title, effect: step.effect,
        args: step.args, estimate: step.estimate!, details: step.review?.details,
      })),
    });
    return true;
  } catch {
    return false;
  }
}

function replayCommandTicket(sessionId: string, itemId: string, ticket: ApprovalTicket, budgetPass?: BudgetPass, releasePass?: () => void): void {
  const steps = frozenStepsOf(ticket);
  const skipSteps = new Set<number>();
  const priorResults: Record<number, unknown> = {};
  const reviewedSpends: Record<number, Estimate> = {};
  const reviews = Object.fromEntries(steps.flatMap((step) => step.review ? [[step.step, step.review]] : []));
  for (const s of steps) {
    const slot = ticket.sends.find((x) => x.id === stepSendId(itemId, s.step));
    if (s.preRan || (slot && isSendOut(slot.status))) {
      skipSteps.add(s.step);
      if (s.preResult !== undefined) priorResults[s.step] = s.preResult;
    }
    if (s.effect === 'spend' && s.estimate) reviewedSpends[s.step] = s.estimate;
  }
  const seq = steps.map((s) => ({
    cmd: s.cmd,
    ...(s.rawArgs !== undefined ? { args: s.rawArgs } : {}),
    ...(s.rawOn && Object.keys(s.rawOn).length ? { on: s.rawOn } : {}),
  }));
  void (async () => {
    try {
      const result = await run(
        { seq, on: { session: sessionId } },
        {
          caller: 'agent',
          onStepStart: (step) => markCommandStepStart(itemId, step),
          onStepEnd: (step, ok, val, err) => markCommandStepEnd(itemId, step, ok, val, err),
          resume: { skipSteps, priorResults, reviewedSpends, reviews, budgetPass, approvalTicketId: ticket.id, skipApproval: true },
        },
      );
      if (!result.ok && result.error.message === COMMAND_REVIEW_CHANGED && refreshCommandReview(sessionId, itemId, result.error.step)) return;
      updateFeedItem<CommandApprovalFeedItem>(sessionId, itemId, (it) =>
        result.ok
          ? { ...it, status: 'done', error: undefined }
          : result.error.code === 'denied'
            ? { ...it, status: 'canceled' }
            : { ...it, status: 'error', error: result.error.message },
      );
    } catch (err) {
      updateFeedItem<CommandApprovalFeedItem>(sessionId, itemId, (it) => ({
        ...it,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      releasePass?.();
      replaying.delete(itemId);
      void saveNow().catch(() => undefined);
    }
  })();
}

/**
 * Resolves an awaiting command sequence approval card (both live in-memory and reloaded durable tickets).
 * Under the spending limit, `'approve'` runs the sequence.
 * At/over the spending limit, requests are held unless the user picks `'once'` ("Allow this time"),
 * `'session'` ("Allow for the whole session"), `'until-next-session'` ("Don't ask again until next session"), or `'cancel'`.
 */
export function decideCommandApproval(sessionId: string, itemId: string, decision: CommandApprovalDecision): boolean {
  const entry = pending.get(itemId);
  if (!entry || entry.sessionId !== sessionId) {
    const item = useStore.getState().sessions[sessionId]?.feed.find((f): f is CommandApprovalFeedItem => f.id === itemId && f.type === 'commands');
    if (decision === 'cancel') {
      if (item?.status === 'awaiting') {
        updateFeedItem<CommandApprovalFeedItem>(sessionId, itemId, (it) => (it.status === 'awaiting' ? { ...it, status: 'canceled' } : it));
        removeTicket(commandTicketId(itemId));
      }
      return false;
    }
    if (!item || item.status !== 'awaiting' || replaying.has(itemId)) return false;
    const ticket = storeTickets.get(commandTicketId(itemId));
    const steps = frozenStepsOf(ticket);
    if (!ticket || ticket.sessionId !== sessionId || !steps.length) return false;
    const remainingSpends = steps.filter((s) => {
      if (s.effect !== 'spend' || s.preRan) return false;
      const slot = ticket.sends.find((x) => x.id === stepSendId(itemId, s.step));
      return !slot || !isSendOut(slot.status);
    });
    const remainingEstimate = remainingSpends.length ? sumEstimates(remainingSpends.map((s) => s.estimate ?? FREE)) : FREE;
    const heldAtLimit = remainingSpends.length > 0 && budgetProblem(remainingEstimate, sessionId) !== null;
    if (heldAtLimit && decision === 'approve') return false;
    let budgetPass: BudgetPass | undefined;
    let releasePass: (() => void) | undefined;
    if (decision === 'session') dontAskAgain(sessionId);
    else if (decision === 'until-next-session') dontAskUntilNextSession();
    else if (decision === 'once') {
      const unknownSteps = remainingSpends.filter((s) => !s.estimate || s.estimate.usd == null || s.estimate.lowerBound).length;
      const grant = beginOncePass(sessionId, remainingEstimate.usd, unknownSteps);
      budgetPass = grant.pass;
      releasePass = grant.end;
    }
    replaying.add(itemId);
    updateFeedItem<CommandApprovalFeedItem>(sessionId, itemId, (it) => ({ ...it, status: 'running' }));
    replayCommandTicket(sessionId, itemId, ticket, budgetPass, releasePass);
    return true;
  }
  if (decision === 'cancel') {
    pending.delete(itemId);
    removeTicket(commandTicketId(itemId));
    updateFeedItem<CommandApprovalFeedItem>(sessionId, itemId, (it) => ({ ...it, status: 'canceled' }));
    entry.resolve(false);
    return true;
  }
  const hasSpend = entry.request.steps.some((s) => s.effect === 'spend');
  const heldAtLimit = hasSpend && budgetProblem(entry.request.estimate, sessionId) !== null;
  if (heldAtLimit && decision === 'approve') return false;
  let budgetPass: BudgetPass | undefined;
  if (decision === 'session') dontAskAgain(sessionId);
  else if (decision === 'until-next-session') dontAskUntilNextSession();
  else if (decision === 'once') {
    const unknownSteps = entry.request.steps.filter(s => s.effect === 'spend' && (s.estimate.usd == null || s.estimate.lowerBound)).length;
    const grant = beginOncePass(sessionId, entry.request.estimate.usd, unknownSteps);
    entry.setReleasePass(grant.end);
    budgetPass = grant.pass;
  }
  pending.delete(itemId);
  updateFeedItem<CommandApprovalFeedItem>(sessionId, itemId, (it) => ({ ...it, status: 'running' }));
  const approvalTicketId = commandTicketId(itemId);
  entry.resolve({ approved: true, budgetPass, approvalTicketId: storeTickets.get(approvalTicketId) ? approvalTicketId : undefined });
  return true;
}

/** The commands of an area, one line each, with whether each can run now; with neither area nor text, an index of the areas. */
export function findCommandsTool(sessionId: string, input: unknown): ToolAnswer {
  const v = findCommandsSchema.safeParse(input ?? {});
  if (!v.success) return { text: `Invalid find_commands input: ${problems(v.error)}`, done: false };
  const doc = activeDoc(sessionId);
  const where = doc ? ` Document on screen: ${doc.id} "${doc.name}", ${doc.width}x${doc.height}.` : '';
  const context = `Commands run as the user's own actions in this session.${where}`;
  const everything = visible(allCommands());
  const index = (): string => {
    const names = Object.keys(AREAS);
    const known = [...names, ...new Set(everything.map((c) => areaOf(c.id)).filter((a) => !names.includes(a)))];
    return [context, 'Areas (call find_commands with area, or with text):', ...known.map((a) => `${a} (${everything.filter((c) => areaOf(c.id) === a).length}) — ${AREAS[a] ?? 'other commands'}`)].join('\n');
  };
  const { area, text } = v.data;
  if ((!area && !text) || (area && !everything.some((c) => areaOf(c.id) === area))) return { text: index(), done: true };
  const found = visible(findCommands({ area, text, signatures: true, caller: 'agent', ...(doc ? { on: { session: sessionId, doc: doc.id } } : { on: { session: sessionId } }) }));
  if (!found.length) return { text: `No command matches. Areas: ${Object.keys(AREAS).join(', ')}.`, done: false };
  const lines = found.map(formatLine);
  return { text: [context, ...lines].join('\n'), done: true };
}

/** Runs the sequence on this session; steps act on the document on screen unless they name another. */
export async function runCommandsTool(sessionId: string, input: unknown, signal?: AbortSignal, meta?: ChatMessageMeta): Promise<ToolAnswer> {
  const v = runCommandsSchema.safeParse(input);
  if (!v.success) return { text: `Invalid run_commands input: ${problems(v.error)}`, done: false };
  let docRef: string | undefined;
  const seq = v.data.seq.map((step, i) => {
    const spec = command(step.cmd);
    const next = !step.on?.doc && docRef && spec?.needs?.includes('doc') ? { ...step, on: { doc: docRef } } : step;
    if (spec && DOC_CREATORS.has(spec.id)) docRef = `$${i + 1}.doc`;
    return next;
  });
  for (const [i, step] of seq.entries()) {
    const reason = AGENT_HIDDEN[command(step.cmd)?.id ?? step.cmd];
    if (reason) return { text: `Step ${i + 1}: "${step.cmd}" is not available to the agent: ${reason}. Nothing ran.`, done: false };
  }
  const doc = activeDoc(sessionId);
  let approvalItemId: string | null = null;
  const passes: (() => void)[] = [];
  const sessionApprover: Approver | undefined =
    !getApprover() && useStore.getState().sessions[sessionId]
      ? (request) =>
          new Promise<Awaited<ReturnType<Approver>>>((resolve) => {
            if (signal?.aborted) {
              resolve(false);
              return;
            }
            const itemId = uid('fd');
            approvalItemId = itemId;
            const item: CommandApprovalFeedItem = {
              id: itemId,
              createdAt: Date.now(),
              workspace: useStore.getState().ui.workspace,
              type: 'commands',
              status: 'awaiting',
              steps: request.steps.map((s) => ({ step: s.step, cmd: s.cmd, title: s.title, effect: s.effect, args: s.args, estimate: s.estimate, details: s.review?.details })),
              totalSteps: v.data.seq.length,
              estimate: request.estimate,
              ...(meta ? { meta } : {}),
            };
            appendFeed(sessionId, item);
            createCommandTicket(sessionId, itemId, request);
            const onAbort = () => decideCommandApproval(sessionId, itemId, 'cancel');
            signal?.addEventListener('abort', onAbort, { once: true });
            pending.set(itemId, {
              sessionId,
              itemId,
              request,
              resolve: (ok) => {
                signal?.removeEventListener('abort', onAbort);
                resolve(ok);
              },
              setReleasePass: (fn) => {
                passes.push(fn);
              },
            });
          })
      : undefined;

  let result;
  try {
    result = await run(
      { seq, on: { session: sessionId, ...(doc ? { doc: doc.id } : {}) } },
      {
        caller: 'agent',
        signal,
        approver: sessionApprover,
        onStepStart: (step) => { if (approvalItemId) markCommandStepStart(approvalItemId, step); },
        onStepEnd: (step, ok, val, err) => { if (approvalItemId) markCommandStepEnd(approvalItemId, step, ok, val, err); },
      },
    );
  } finally {
    for (const release of passes) release();
  }
  const reoffered = approvalItemId && !result.ok && result.error.message === COMMAND_REVIEW_CHANGED
    && refreshCommandReview(sessionId, approvalItemId, result.error.step);
  if (approvalItemId && !reoffered) {
    updateFeedItem<CommandApprovalFeedItem>(sessionId, approvalItemId, (it) =>
      result.ok
        ? { ...it, status: 'done' }
        : result.error.code === 'denied'
          ? { ...it, status: 'canceled' }
          : { ...it, status: 'error', error: result.error.message },
    );
  }
  const ran = result.results.length;
  if (!result.ok) {
    const kept = ran === 0 ? 'Nothing ran.'
      : result.kept ? `Steps 1 to ${ran} ran and stay, as one undo step: the sequence waited on a step and the user may have edited meanwhile, so nothing was taken back. Read the document before going on.`
      : result.rolledBack ? `Steps 1 to ${ran} ran and were taken back: the documents are as before.` : `Steps 1 to ${ran} ran and stay.`;
    if (result.error.code === 'denied') return { text: `Step ${result.error.step ?? 1} ${NEEDS_APPROVAL} (it spends or deletes). Nothing ran.`, done: false };
    const msg = result.error.code === 'target' && result.error.message.includes('on.doc') ? `${result.error.message.replace(/\.$/, '')}${ON_DOC_HINT}.` : result.error.message;
    return { text: `Step ${result.error.step ?? 1} failed (${result.error.code}): ${msg} ${kept}`, done: false };
  }
  // The agent's edit glows on the canvas for a moment (in memory only: never saved, undone or exported).
  const after = doc ? getDoc(sessionId, doc.id) : undefined;
  if (doc && after) markAgentEdit(doc.id, doc, after);
  const results = JSON.stringify(result.results);
  return { text: `Done, ${ran} step${ran === 1 ? '' : 's'}. Results: ${results.length > RESULT_MAX ? `${results.slice(0, RESULT_MAX)}… (cut)` : results}. One Ctrl+Z per document undoes it all.`, done: true };
}
