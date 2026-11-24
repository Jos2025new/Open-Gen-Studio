import { commandReview, previewEstimate, type RunOptions } from '../commands/run';
import type { ChatMessageMeta } from '../feedMeta';
import { uid } from '../../lib/id';
import { appendFeed, removeTicket, saveNow, updateFeedItem, useStore } from '../../store/store';
import { budgetProblem, dontAskAgain, dontAskUntilNextSession } from '../budget';
import { allCommands, command, findCommands, getApprover, run, type ApprovalRequest, type Approver } from '../commands';
import { COMMAND_REVIEW_CHANGED, type RunResult } from '../commands/types';
import type { FrozenCommandStep } from '../commands/run';
import { activeDoc, getDoc } from '../design/actions';
import { markAgentEdit } from '../design/agentGlow';
import { canRedo, undoHead } from '../design/history';
import { closeTicket, grantTicketPass, stepCapFromEstimate, storeTickets } from '../money/storeBridge';
import { createTicket, isHeldStatus, priceFromEstimate, type ApprovalTicket } from '../money/ticket';
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
  library: 'saved subjects, styles, voices and kits',
  skills: 'read skills, workflows and guides',
  models: 'the model catalog (read only)',
  sessions: 'list, rename, pin and title sessions',
};
const NEEDS_APPROVAL = 'needs the user\'s approval';
const DOC_CREATORS = new Set(['designer.doc.new', 'designer.doc.ensure', 'designer.doc.from_asset']);
const LIBRARY_WRITERS = new Set([
  'library.item.create', 'library.item.save', 'library.item.restore',
  'library.subject.save', 'library.subject.from_asset', 'library.subject.from_sheet', 'library.subject.from_attachments', 'library.voice.create',
]);
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
  resolve: (outcome: boolean | { approved: boolean; approvalTicketId?: string }) => void;
}

const pending = new Map<string, PendingCommandApproval>();
const replaying = new Set<string>();
const commandTicketId = (itemId: string) => `cmd:${itemId}`;
const cloneSafe = (val: unknown): unknown => { if (val === undefined) return null; try { return JSON.parse(JSON.stringify(val)); } catch { return null; } };
const frozenStepsOf = (ticket: ApprovalTicket | undefined): FrozenCommandStep[] =>
  Array.isArray(ticket?.scope.steps) ? ticket.scope.steps as FrozenCommandStep[] : [];
const putSteps = (ticket: ApprovalTicket, steps: FrozenCommandStep[]) => storeTickets.put({ ...ticket, scope: { ...ticket.scope, steps } });

function trackCommand(itemId: string | null, step: number, state?: FrozenCommandStep['state'], result?: unknown): void {
  const ticket = itemId && storeTickets.get(commandTicketId(itemId));
  if (ticket) putSteps(ticket, frozenStepsOf(ticket).map((s) => (s.step === step ? { ...s, state, ...(state === 'done' ? { result: cloneSafe(result) } : {}) } : s)));
}

function createCommandTicket(sessionId: string, itemId: string, request: ApprovalRequest): void {
  const steps = request.sequence?.map((s) => (s.state === 'done' ? { ...s, result: cloneSafe(s.result) } : s));
  storeTickets.put(createTicket({ id: commandTicketId(itemId), sessionId, kind: 'commands', scope: { steps }, price: priceFromEstimate(request.estimate) }));
}

export function settleInterruptedCommandCards(): void {
  for (const session of Object.values(useStore.getState().sessions)) {
    for (const item of session.feed) {
      if (item.type !== 'commands' || item.status !== 'running' || pending.has(item.id) || replaying.has(item.id)) continue;
      const ticket = storeTickets.get(commandTicketId(item.id));
      const steps = frozenStepsOf(ticket);
      if (ticket && steps.some((s) => s.state === 'running')) putSteps(ticket, steps.map((s) => (s.state === 'running' ? { ...s, state: 'failed' } : s)));
      const status = steps.some((s) => !s.state) ? 'awaiting' : ticket && steps.every((s) => s.state === 'done') ? 'done' : 'error';
      updateFeedItem<CommandApprovalFeedItem>(session.id, item.id, { status, ...(status === 'error' ? { error: 'Interrupted by a page reload; already-sent steps were not re-submitted.' } : {}) });
      if (status !== 'awaiting') closeTicket(commandTicketId(item.id));
    }
  }
}

type ChangedReview = Parameters<NonNullable<RunOptions['onReviewChanged']>>[0];

function refreshCommandReview(sessionId: string, itemId: string, stepNumber: number | undefined, resolved?: ChangedReview): Estimate | undefined {
  const ticket = storeTickets.get(commandTicketId(itemId));
  const steps = frozenStepsOf(ticket);
  const stale = steps.find((step) => step.step === stepNumber);
  const spec = stale && command(stale.cmd);
  if (!ticket || !stale || spec?.effect !== 'spend' || (!resolved && (!stale.ready || !stale.onReady))) return;
  try {
    const ctx = { on: stale.on, caller: 'agent' as const };
    const current = resolved ?? { review: commandReview(spec, ctx, stale.args), estimate: previewEstimate(spec, ctx, stale.args) };
    const revised = steps.map((step) => (step === stale ? { ...step, ...current, ready: true, onReady: true } : step));
    const remaining = revised.filter((step) => !step.state && step.estimate);
    const estimateTotal = sumEstimates(remaining.map((step) => step.estimate!));
    storeTickets.put({ ...ticket, pass: undefined, price: priceFromEstimate(estimateTotal), scope: { ...ticket.scope, steps: revised } });
    updateFeedItem<CommandApprovalFeedItem>(sessionId, itemId, {
      status: 'awaiting', error: COMMAND_REVIEW_CHANGED, estimate: estimateTotal,
      steps: remaining.map((s) => ({ step: s.step, cmd: s.cmd, title: s.title, effect: s.effect, args: s.args, estimate: s.estimate!, details: s.review?.details })),
    });
    return estimateTotal;
  } catch {
    return undefined;
  }
}

function finishCommandCard(sessionId: string, itemId: string, result: RunResult, changed?: ChangedReview): Estimate | undefined {
  if (!result.ok && result.error.message === COMMAND_REVIEW_CHANGED) {
    const estimate = refreshCommandReview(sessionId, itemId, result.error.step, changed);
    if (estimate) return estimate;
  }
  updateFeedItem<CommandApprovalFeedItem>(sessionId, itemId, result.ok
    ? { status: 'done', error: undefined }
    : result.error.code === 'denied' ? { status: 'canceled' } : { status: 'error', error: result.error.message });
  closeTicket(commandTicketId(itemId));
}

async function runTrackedSequence(
  input: unknown,
  itemIdOf: () => string | null,
  extra: Pick<RunOptions, 'signal' | 'approver' | 'resume'>,
): Promise<{ result: RunResult; changed?: ChangedReview }> {
  let changed: ChangedReview | undefined;
  const result = await run(input, {
    caller: 'agent',
    ...extra,
    onReviewChanged: (current) => { changed = current; },
    onStepStart: (step) => trackCommand(itemIdOf(), step, 'running'),
    onStepEnd: (step, ok, val, err) => trackCommand(itemIdOf(), step, ok ? 'done' : err === COMMAND_REVIEW_CHANGED ? undefined : 'failed', val),
  });
  return { result, changed };
}

function replayCommandTicket(sessionId: string, itemId: string, ticket: ApprovalTicket): void {
  const steps = frozenStepsOf(ticket);
  const seq = steps.map((s) => ({ cmd: s.cmd, ...(s.rawArgs !== undefined ? { args: s.rawArgs } : {}), ...(s.rawOn && Object.keys(s.rawOn).length ? { on: s.rawOn } : {}) }));
  void (async () => {
    try {
      const { result, changed } = await runTrackedSequence({ seq, on: { session: sessionId } }, () => itemId, { resume: { steps, approvalTicketId: ticket.id } });
      finishCommandCard(sessionId, itemId, result, changed);
    } catch (err) {
      updateFeedItem<CommandApprovalFeedItem>(sessionId, itemId, (it) => ({ ...it, status: 'error', error: err instanceof Error ? err.message : String(err) }));
      closeTicket(ticket.id);
    } finally {
      replaying.delete(itemId);
      void saveNow().catch(() => undefined);
    }
  })();
}

/** Build per-step ceilings for every remaining paid command/node in the approved sequence. */
function commandStepCaps(spends: readonly FrozenCommandStep[]): Record<string, number | null> {
  const caps: Record<string, number | null> = {};
  for (const step of spends) {
    if (step.review?.stepCaps && Object.keys(step.review.stepCaps).length) {
      for (const [k, v] of Object.entries(step.review.stepCaps)) caps[`cmd:${step.step}:${k}`] = v;
    } else {
      const cap = stepCapFromEstimate(step.estimate ?? FREE);
      if (cap !== undefined) caps[`cmd:${step.step}`] = cap;
    }
  }
  return caps;
}

/**
 * Resolves an awaiting command sequence approval card (both live in-memory and reloaded durable tickets).
 * Under the spending limit, `'approve'` runs the sequence.
 * At/over the spending limit, requests are held unless the user picks `'once'` ("Allow this time"),
 * `'session'` ("Allow for the whole session"), `'until-next-session'` ("Don't ask again until next session"), or `'cancel'`.
 */
export function decideCommandApproval(sessionId: string, itemId: string, decision: CommandApprovalDecision): boolean {
  const entry = pending.get(itemId);
  const item = useStore.getState().sessions[sessionId]?.feed.find((f): f is CommandApprovalFeedItem => f.id === itemId && f.type === 'commands');
  if (item?.status !== 'awaiting' || replaying.has(itemId) || (entry && entry.sessionId !== sessionId)) return false;
  const ticket = storeTickets.get(commandTicketId(itemId));
  if (decision === 'cancel') {
    pending.delete(itemId);
    if (ticket?.sends.some(send => send.generationId && isHeldStatus(send.status))) {
      storeTickets.put({ ...ticket, closed: true, pass: undefined });
    } else removeTicket(commandTicketId(itemId));
    updateFeedItem<CommandApprovalFeedItem>(sessionId, itemId, { status: 'canceled' });
    entry?.resolve(false);
    return Boolean(entry);
  }
  if (!ticket || ticket.sessionId !== sessionId) return false;
  const spends = frozenStepsOf(ticket).filter(step => !step.state && step.effect === 'spend');
  const estimate = sumEstimates(spends.map(step => step.estimate ?? FREE));
  if (decision === 'approve' && spends.length && budgetProblem(estimate, sessionId)) return false;

  let approvedTicket = ticket;
  if (decision === 'session') dontAskAgain(sessionId);
  else if (decision === 'until-next-session') dontAskUntilNextSession();
  else if (decision === 'once') approvedTicket = grantTicketPass(ticket, estimate, commandStepCaps(spends));
  updateFeedItem<CommandApprovalFeedItem>(sessionId, itemId, { status: 'running' });
  if (entry) {
    pending.delete(itemId);
    entry.resolve({ approved: true, approvalTicketId: ticket.id });
  } else {
    replaying.add(itemId);
    replayCommandTicket(sessionId, itemId, approvedTicket);
  }
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
    const space = step.args?.space, docSpace = space === 'studio' || space === 'designer';
    if (spec && (DOC_CREATORS.has(spec.id) || (spec.id === 'library.item.create' && (space === undefined || docSpace)) || (spec.id === 'library.item.open' && docSpace))) docRef = `$${i + 1}.doc`;
    return next;
  });
  for (const [i, step] of seq.entries()) {
    const reason = AGENT_HIDDEN[command(step.cmd)?.id ?? step.cmd];
    if (reason) return { text: `Step ${i + 1}: "${step.cmd}" is not available to the agent: ${reason}. Nothing ran.`, done: false };
  }
  const doc = activeDoc(sessionId);
  let approvalItemId: string | null = null;
  const sessionApprover: Approver | undefined = !getApprover() && useStore.getState().sessions[sessionId]
    ? (request) => new Promise<Awaited<ReturnType<Approver>>>((resolve) => {
      if (signal?.aborted) return resolve(false);
      const itemId = uid('fd');
      approvalItemId = itemId;
      appendFeed(sessionId, {
        id: itemId, createdAt: Date.now(), workspace: useStore.getState().ui.workspace, type: 'commands', status: 'awaiting',
        steps: request.steps.map((s) => ({ step: s.step, cmd: s.cmd, title: s.title, effect: s.effect, args: s.args, estimate: s.estimate, details: s.review?.details })),
        totalSteps: v.data.seq.length, estimate: request.estimate, ...(meta ? { meta } : {}),
      });
      createCommandTicket(sessionId, itemId, request);
      const onAbort = () => decideCommandApproval(sessionId, itemId, 'cancel');
      signal?.addEventListener('abort', onAbort, { once: true });
      pending.set(itemId, {
        sessionId,
        resolve: (ok) => { signal?.removeEventListener('abort', onAbort); resolve(ok); },
      });
    })
    : undefined;

  const beforeState = useStore.getState();
  const beforeDocs = new Map(beforeState.sessions[sessionId]?.docs.map((d) => [d.id, { doc: d, undo: undoHead(d.id) }]));
  const { result, changed } = await runTrackedSequence(
    { seq, on: { session: sessionId, ...(doc ? { doc: doc.id } : {}) } },
    () => approvalItemId,
    { signal, approver: sessionApprover },
  );
  const reoffered = approvalItemId ? finishCommandCard(sessionId, approvalItemId, result, changed) : undefined;
  const ran = result.results.length, afterState = useStore.getState();
  const saved = afterState.library !== beforeState.library && result.results.some((_, i) => LIBRARY_WRITERS.has(command(seq[i].cmd)?.id ?? ''));
  const libraryNote = saved ? ' Saved in Library (restore a version or delete the entry to undo).' : '';
  if (!result.ok) {
    const kept = ran === 0 ? 'Nothing ran.'
      : result.kept ? `Steps 1 to ${ran} ran and stay, as one undo step: the sequence waited on a step and the user may have edited meanwhile, so nothing was taken back. Read the document before going on.`
      : result.rolledBack ? `Steps 1 to ${ran} ran and were taken back: the documents are as before.` : `Steps 1 to ${ran} ran and stay.`;
    if (result.error.code === 'denied') return { text: `Step ${result.error.step ?? 1} ${NEEDS_APPROVAL} (it spends or deletes). Nothing ran.`, done: false };
    const msg = result.error.code === 'target' && result.error.message.includes('on.doc') ? `${result.error.message.replace(/\.$/, '')}${ON_DOC_HINT}.` : result.error.message;
    const over = reoffered ? budgetProblem(reoffered, sessionId) : null;
    return { text: `Step ${result.error.step ?? 1} failed (${result.error.code}): ${msg}${over ? ' ' + over : ''} ${kept}${libraryNote}`, done: false };
  }
  // The agent's edit glows on the canvas for a moment (in memory only: never saved, undone or exported).
  const after = doc ? getDoc(sessionId, doc.id) : undefined;
  if (doc && after) markAgentEdit(doc.id, doc, after);
  const docEdited = afterState.sessions[sessionId]?.docs.some((d) => {
    const before = beforeDocs.get(d.id), undo = undoHead(d.id);
    return d !== before?.doc && undo && undo !== before?.undo && !canRedo(d.id);
  });
  const undoNote = docEdited ? ' One Ctrl+Z per document undoes it all.' : '';
  const results = JSON.stringify(result.results);
  return { text: `Done, ${ran} step${ran === 1 ? '' : 's'}. Results: ${results.length > RESULT_MAX ? `${results.slice(0, RESULT_MAX)}… (cut)` : results}.${undoNote}${libraryNote}`, done: true };
}
