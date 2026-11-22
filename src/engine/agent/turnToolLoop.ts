import { journeyIdFor, recordJourneyEvent } from '../../lib/journeyTrace';
import { composerChosen, modelSummary } from '../catalog';
import type { ChatMessageMeta } from '../feedMeta';
import { roundsFor } from '../procedure';
import type { ChatResult } from '../providers/llm';
import type { AgentQuestion, LlmMessage, MediaKind, SettingsFeedItem, SettingsSection, Workspace } from '../types';
import { appendFeed } from '../../store/store';
import type { activityLog } from './activityLog';
import { cardDraft } from './draftActions';
import { recordMetric } from './metrics';
import { durationOwed } from './modelLimits';
import { handleProposePlanCall, type ProposePlanDeps, type ProposePlanState } from './proposePlanCall';
import type { SettingsPart } from './settingsParts';
import { rejectionOf } from './stopNotice';
import { keepConfirmed, switchSection } from './switchModel';
import { askQuestionsSchema, confirmSettingsSchema, formatZodError, parseToolArgs } from './tools';
import type { TurnGuard } from './turnGuard';
import type { TurnUsageTracker } from './turnUsage';

export interface TurnToolLoopDeps extends ProposePlanDeps {
  pushHistory: (sessionId: string, msg: LlmMessage, owner: string) => void;
  feedBase: (workspace: Workspace) => { id: string; createdAt: number; workspace: Workspace };
  setThreadOpen: (open: boolean) => void;
  showQuestions: (sessionId: string, workspace: Workspace, intro: string | undefined, questions: AgentQuestion[], toolCallId: string | null, owner: string, meta?: ChatMessageMeta) => void;
  imagesFirst: <P extends { kind: string }>(parts: P[]) => P[];
  sectionsOfParts: (sessionId: string, owner: string, parts: SettingsPart[], until: <T>(work: Promise<T>) => Promise<T>, log: ReturnType<typeof activityLog>) => Promise<{ sections: SettingsSection[]; failed: string }>;
  autoAnswer: (sessionId: string, owner: string, workspace: Workspace, toolCallId: string, summary: string | undefined, sections: SettingsSection[], parts: SettingsPart[], log?: ReturnType<typeof activityLog>, meta?: ChatMessageMeta) => Promise<string>;
  runCanvasCall: (c: {
    sessionId: string;
    owner: string;
    workspace: Workspace;
    call: ChatResult['toolCalls'][number];
    parsed: { value: unknown };
    index: number;
    log: ReturnType<typeof activityLog>;
    until: <T>(work: Promise<T>) => Promise<T>;
    signal: AbortSignal;
    respond: (content: string) => void;
    ignoreRest: (fromIndex: number) => void;
    toolResults: LlmMessage[];
    afterTools: LlmMessage[];
    cardMeta?: () => ChatMessageMeta;
    onCardCommitted?: () => void;
  }) => Promise<{ handled: boolean; stop?: boolean; workspace: Workspace }>;
  getLastBlock: () => string | undefined;
  setLastBlock: (next: string | undefined) => void;
}

/** Dispatches tool calls returned by one LLM call (settings, questions, canvas tools, propose_plan). */
export async function runTurnToolLoop(opts: {
  sessionId: string;
  owner: string;
  workspace: Workspace;
  /** Called the moment a tool changes canvas, so the turn's closures (meta, Stop, limit note) never see a stale one. */
  onWorkspace: (workspace: Workspace) => void;
  textOnly?: boolean;
  result: ChatResult;
  textItemId: string | null;
  hasTextBubble: () => boolean;
  until: <T>(work: Promise<T>) => Promise<T>;
  signal: AbortSignal;
  log: ReturnType<typeof activityLog>;
  clockElapsed: () => number;
  turnMeta: () => ChatMessageMeta;
  guard: TurnGuard;
  usage: TurnUsageTracker;
  planState: ProposePlanState;
  deps: TurnToolLoopDeps;
}): Promise<{ stop: boolean; workspace: Workspace; roundBack?: boolean }> {
  const { sessionId, owner, onWorkspace, textOnly, result, textItemId, hasTextBubble, until, signal, log, clockElapsed, turnMeta, guard, usage, planState, deps } = opts;
  let workspace = opts.workspace;

  // The wrap-up after a plan (S4) is text only: a tool call there is answered as ignored and nothing runs.
  if (textOnly) {
    deps.flushToolResults(sessionId, result.toolCalls.map((c) => ({ role: 'tool' as const, tool_call_id: c.id, content: 'Ignored: this reply is text only.' })), owner);
    return { stop: true, workspace };
  }

  const toolResults: LlmMessage[] = [];
  const afterTools: LlmMessage[] = [];
  let roundBack = false;
  // One action (questions or plan) per turn; later calls in the same message are answered as ignored.
  const ignoreRest = (fromIndex: number) => {
    for (const c of result.toolCalls.slice(fromIndex + 1)) {
      toolResults.push({ role: 'tool', tool_call_id: c.id, content: 'Ignored: only one action per turn is processed.' });
    }
  };

  for (const [index, call] of result.toolCalls.entries()) {
    const respond = (content: string) => {
      toolResults.push({ role: 'tool', tool_call_id: call.id, content });
      deps.setLastBlock(rejectionOf(content) ?? deps.getLastBlock());
    };
    if (result.finishReason === 'length') {
      respond('Your output was cut off (length limit). Send a shorter tool call.');
      continue;
    }
    const parsed = parseToolArgs(call.arguments);
    if (!parsed.ok) {
      respond(parsed.error);
      continue;
    }

    if (call.name === 'confirm_settings') {
      const ag = deps.mine;
      const v = confirmSettingsSchema.safeParse(parsed.value);
      if (!v.success) { respond(`Invalid confirm_settings input: ${formatZodError(v.error)}`); continue; }
      deps.inferChoices(sessionId, owner, 'confirm_settings', v.data.parts);
      if (workspace === 'node') { respond('The node canvas has its own settings on each node: call propose_plan directly.'); continue; }
      const parts = deps.imagesFirst(v.data.parts);
      const { sections, failed } = await deps.sectionsOfParts(sessionId, owner, parts, until, log);
      if (failed || !sections.length) { respond(failed || 'confirm_settings needs at least one part.'); continue; }
      if (deps.get().composer.agentStyle === 'auto') { respond(await deps.autoAnswer(sessionId, owner, deps.rowCanvas(workspace), call.id, v.data.summary, sections, parts, log, turnMeta())); continue; }
      log.action({ icon: 'questions', label: 'Asked to confirm the settings', detail: sections.map((x) => modelSummary(x.recommended.modelRef)?.name).join(' · ') });
      ignoreRest(index);
      deps.flushToolResults(sessionId, toolResults, owner);
      const sw = await until(switchSection(sections, ag().settings, ag().settingsParts, parts[0]?.user_requested === true, parts[0]?.model, undefined, parts[0]));
      const kept = sw ? undefined : await until(keepConfirmed(sections, ag().settings, parts, (k: MediaKind) => (composerChosen(k) ? deps.get().composer[k].modelRef : undefined)));
      const item: SettingsFeedItem = { ...deps.feedBase(workspace), type: 'settings', summary: v.data.summary, status: 'pending', toolCallId: call.id, ...cardDraft(sessionId, owner, sw ? [sw.section] : kept!.sections), ...(sw ? { switchFrom: sw.from, followUp: sw.followUp } : { keptAsked: kept!.asked }), meta: usage.takePendingMeta(turnMeta(), hasTextBubble()) };
      appendFeed(sessionId, item);
      recordJourneyEvent({ journeyId: journeyIdFor(sessionId) ?? sessionId, journey: 'settings-response', event: 'settings.presented', reason: 'agent requested settings confirmation', sessionId, approvalId: item.id, after: { choices: sections.map((x) => ({ kind: x.kind, modelRef: x.recommended.modelRef, count: x.count, duration: x.recommended.duration, needsImage: x.recommended.needsImage })) } });
      deps.patchAgent(sessionId, { pending: { toolCallId: call.id, kind: 'settings', feedItemId: item.id } }, owner);
      if (deps.get().ui.workspace !== 'chat') deps.setThreadOpen(true);
      guard.setOutcome('settings');
      return { stop: true, workspace };
    }

    if (call.name === 'ask_questions') {
      const style = deps.get().composer.agentStyle;
      // Auto allows one card for what changes the result or cost (F1); guided, the rounds set in Settings.
      if (deps.mine().questionRound >= roundsFor(style, deps.get().settings.guidedRounds) && !durationOwed(deps.mine().history)) {
        respond('Question rounds are used up. Use sensible defaults for anything still open and call propose_plan now.');
        continue;
      }
      const v = askQuestionsSchema.safeParse(parsed.value);
      if (!v.success) {
        respond(`Invalid ask_questions input: ${formatZodError(v.error)}`);
        continue;
      }
      log.action({ icon: 'questions', label: `Asked ${v.data.questions.length} question${v.data.questions.length === 1 ? '' : 's'}` });
      // This call's result is sent later, with the user's answers.
      ignoreRest(index);
      deps.flushToolResults(sessionId, toolResults, owner);
      recordMetric(sessionId, { type: 'questions' });
      deps.showQuestions(
        sessionId,
        workspace,
        v.data.intro,
        v.data.questions.map((q) => ({
          id: q.id,
          question: q.question,
          options: q.options,
          allowCustom: q.allow_custom ?? true,
          multi: q.multi ?? false,
          default: q.default && q.options.includes(q.default) ? q.default : undefined,
        })),
        call.id,
        owner,
        usage.takePendingMeta(turnMeta(), hasTextBubble()),
      );
      guard.setOutcome('questions');
      return { stop: true, workspace };
    }

    const canvas = await deps.runCanvasCall({
      sessionId,
      owner,
      workspace,
      call,
      parsed,
      index,
      log,
      until,
      signal,
      respond,
      ignoreRest,
      toolResults,
      afterTools,
      cardMeta: () => usage.pendingMeta(turnMeta(), hasTextBubble()),
      onCardCommitted: () => { if (!hasTextBubble()) usage.clearPending(); },
    });
    workspace = canvas.workspace;
    onWorkspace(workspace);
    if (canvas.stop) return { stop: true, workspace };
    if (canvas.handled) continue;

    if (call.name === 'propose_plan') {
      const planRes = await handleProposePlanCall({
        sessionId,
        owner,
        workspace,
        callId: call.id,
        parsedValue: parsed.value,
        index,
        textItemId,
        hasTextBubble,
        toolResults,
        respond,
        ignoreRest,
        until,
        signal,
        log,
        clockElapsed,
        turnMeta,
        guard,
        usage,
        state: planState,
        deps,
      });
      if (planRes.roundBack) roundBack = true;
      if (planRes.status === 'stop') return { stop: true, workspace, roundBack };
      continue;
    }

    respond(`Unknown tool "${call.name}".`);
  }

  deps.flushToolResults(sessionId, toolResults, owner);
  for (const m of afterTools) deps.pushHistory(sessionId, m, owner);
  if (planState.planFailures >= 3) {
    guard.setOutcome('error');
    deps.notice(sessionId, workspace, 'The agent could not produce a valid plan. Try rephrasing or pick another model.', 'error', undefined, usage.takePendingMeta(turnMeta(), hasTextBubble()));
    return { stop: true, workspace, roundBack };
  }
  if (hasTextBubble()) usage.clearPending();
  return { stop: false, workspace, roundBack };
}
