import { isAbort, isTransient } from '../../lib/http';
import { OverLimitError } from '../budget';
import { isCreditError } from '../credit';
import { storeTickets } from '../money/storeBridge';
import { hasLlmPossibleCharge, sendLlmViaPaidGate } from '../money/llmSend';
import { LLM_LABELS, type ChatResult, type ToolSpec } from '../providers/llm';
import type { ChatMessageMeta } from '../feedMeta';
import type { AgentState, FeedItem, LlmMessage, LlmProviderId, NoticeFeedItem, Session, Workspace } from '../types';
import { appendFeed, removeFeedItem, updateFeedItem, type useStore } from '../../store/store';
import { recordMetric } from './metrics';
import { drainAgentNotes } from './priceNotes';
import { parseToolMarkup, toolMarkupAt } from './toolMarkup';
import type { activityLog } from './activityLog';
import type { TurnGuard } from './turnGuard';
import type { TurnUsageTracker } from './turnUsage';

export interface TurnModelCallDeps {
  mine: () => AgentState;
  get: () => ReturnType<typeof useStore.getState>;
  session: (id: string) => Session;
  patchAgent: (sessionId: string, patch: Partial<AgentState> | ((a: AgentState) => Partial<AgentState>), owner: string) => void;
  pushHistory: (sessionId: string, msg: LlmMessage, owner: string) => void;
  repairHistory: (history: LlmMessage[]) => LlmMessage[];
  convertedCallPrefix: string;
  notice: (sessionId: string, workspace: Workspace, text: string, level: 'info' | 'error', retry?: NoticeFeedItem['retry'], meta?: Partial<ChatMessageMeta>) => void;
  messageMeta: (workspace: Workspace, extra: Partial<ChatMessageMeta>, sessionId: string, owner: string) => ChatMessageMeta;
  feedBase: (workspace: Workspace) => { id: string; createdAt: number; workspace: Workspace };
  engineLabel: (sessionId: string, owner: string) => string;
  llmCallUsd: (provider: LlmProviderId, model: string, usage: ChatResult['usage']) => number;
  onAgentCredit: (sessionId: string) => Promise<boolean>;
  retryWithCredit: () => Promise<void>;
  onBudgetBlocked?: () => void;
}

export type TurnModelCallResult =
  | { stop: true; retryTurn?: Promise<void> }
  | { stop: false; result: ChatResult; textItemId: string | null; hasTextBubble: () => boolean };

/** Executes one LLM chat call, handles streaming, credit/transient errors, garbled tool markup, usage and history. */
export async function runTurnModelCall(opts: {
  sessionId: string;
  owner: string;
  workspace: Workspace;
  runId: string;
  wrapUp: boolean;
  creditRetried?: boolean;
  budgetPass?: boolean;
  engine: { provider: LlmProviderId; model: string; key: string };
  system: string;
  tools: ToolSpec[];
  showThinking: boolean;
  signal: AbortSignal;
  until: <T>(work: Promise<T>) => Promise<T>;
  log: ReturnType<typeof activityLog>;
  clockElapsed: () => number;
  firstOutput: () => void;
  turnMeta: () => ChatMessageMeta;
  guard: TurnGuard;
  usage: TurnUsageTracker;
  deps: TurnModelCallDeps;
}): Promise<TurnModelCallResult> {
  const { sessionId, owner, workspace, runId, wrapUp, creditRetried, budgetPass, engine, system, tools, showThinking, signal, until, log, clockElapsed, firstOutput, turnMeta, guard, usage, deps } = opts;

  let textItemId: string | null = null;
  let textItemMeta: ChatMessageMeta | undefined;
  const hasTextBubble = () => Boolean(textItemId && deps.session(sessionId).feed.some((f) => f.id === textItemId));

  const outcomeWasPaid = () => Boolean(storeTickets.get(`llm:${runId}`)?.sends.at(-1)?.status === 'done');
  let result: ChatResult;
  let llmUsd: number | null;
  try {
    if (deps.mine().phase !== 'working') deps.patchAgent(sessionId, { phase: 'working' }, owner);
    drainAgentNotes(sessionId, owner);
    const hurry = guard.takeHurryNote();
    if (hurry) deps.pushHistory(sessionId, { role: 'user', content: hurry }, owner);

    const outcome = await until(sendLlmViaPaidGate({
      ticketId: `llm:${runId}`,
      sessionId,
      provider: engine.provider,
      apiKey: engine.key,
      model: engine.model,
      system,
      messages: deps.repairHistory(deps.mine().history),
      tools,
      effort: deps.get().settings.agent.effort,
      showReasoning: showThinking,
      budgetPass,
      computeUsd: (u) => deps.llmCallUsd(engine.provider, engine.model, u),
      onNotice: (text) => !guard.isDone() && deps.notice(sessionId, workspace, text, 'info', undefined, turnMeta()),
      onReasoning: showThinking ? (_d, full) => !guard.isDone() && (guard.armSilence(), log.thinking(full)) : undefined,
      signal,
      onToolCall: () => {
        if (guard.isDone()) return;
        firstOutput();
        guard.armSilence();
        deps.patchAgent(sessionId, { phase: 'drafting' }, owner);
      },
      onText: (_delta, full) => {
        if (guard.isDone()) return;
        guard.armSilence();
        if (!textItemId) {
          firstOutput();
          textItemMeta = deps.messageMeta(workspace, { agent: 'Director', provider: engine.provider, model: engine.model, runId }, sessionId, owner);
          const item: FeedItem = { ...deps.feedBase(workspace), type: 'assistant', text: full, streaming: true, engine: deps.engineLabel(sessionId, owner), meta: textItemMeta };
          textItemId = item.id;
          appendFeed(sessionId, item);
        } else {
          updateFeedItem(sessionId, textItemId, { text: full });
        }
      },
    }));
    result = outcome.value;
    llmUsd = outcome.costUsd;
  } catch (err) {
    if (textItemId) updateFeedItem(sessionId, textItemId, { streaming: false });
    if (err instanceof OverLimitError) {
      guard.setOutcome('canceled');
      deps.onBudgetBlocked?.();
      return { stop: true };
    }
    if (isAbort(err)) {
      guard.handleAbort(() => deps.notice(sessionId, workspace, 'Stopped.', 'info', undefined, turnMeta()));
      return { stop: true };
    }
    const possibleCharge = hasLlmPossibleCharge(runId);
    // No credit for the agent's model: the same model elsewhere (same price or less) takes over and the call runs
    // again once; otherwise the choices are shown above the prompt box and the notice keeps Retry.
    if (!possibleCharge && isCreditError(err) && !creditRetried) {
      if (textItemId) removeFeedItem(sessionId, textItemId);
      if (await until(deps.onAgentCredit(sessionId))) {
        guard.setOutcome('error');
        return { stop: true, retryTurn: deps.retryWithCredit() };
      }
    }
    // History only grows with completed calls, so a retry repeats just the call that failed.
    const retry = possibleCharge || isTransient(err) || isCreditError(err)
      ? { ...(textItemId ? { partialItemId: textItemId } : {}), ...(possibleCharge ? { possibleCharge: true } : {}) }
      : undefined;
    // The call happened and cost time: it is a call in the metrics even though it produced nothing (T2).
    recordMetric(sessionId, { type: 'failedCall', error: (err as Error).message, ms: clockElapsed() });
    guard.setOutcome('error');
    deps.notice(sessionId, workspace, `${LLM_LABELS[engine.provider]}: ${(err as Error).message}`, 'error', retry, usage.takePendingMeta(turnMeta(), hasTextBubble()));
    return { stop: true };
  }

  log.callEnded(result.timing.reasoningMs, result.timing.outputMs ?? result.timing.totalMs);
  // A tool call written as text (the provider did not convert the model's native format): not kept in the
  // history, its markup hidden, and a warning with Retry (the same call again) and Delete.
  const garbled = !result.toolCalls.length ? toolMarkupAt(result.text) : -1;
  // Readable markup becomes the real calls; the reply keeps only the text before it.
  const converted = garbled >= 0 ? parseToolMarkup(result.text.slice(garbled)) : null;
  if (converted) {
    result = {
      ...result,
      text: result.text.slice(0, garbled).trim(),
      toolCalls: converted.map((c, i) => ({ ...c, id: `${deps.convertedCallPrefix}${Date.now().toString(36)}_${i}` })),
    };
    if (textItemId) {
      if (result.text) updateFeedItem(sessionId, textItemId, { streaming: false, text: result.text });
      else removeFeedItem(sessionId, textItemId);
    }
  } else if (garbled >= 0) {
    const shown = result.text.slice(0, garbled).trim();
    if (textItemId) updateFeedItem(sessionId, textItemId, { streaming: false, text: shown || '…' });
    appendFeed(sessionId, {
      ...deps.feedBase(workspace),
      type: 'notice',
      level: 'error',
      text: 'The model wrote its action as text the app cannot read, so nothing ran.',
      retry: { ...(textItemId ? { partialItemId: textItemId } : {}), possibleCharge: outcomeWasPaid() },
      ...(textItemId ? { garbledItemId: textItemId } : {}),
      meta: usage.takePendingMeta(turnMeta(), hasTextBubble()),
    });
    guard.setOutcome('error');
    return { stop: true };
  }

  if (textItemId) updateFeedItem(sessionId, textItemId, { streaming: false, text: result.text.trim() });

  usage.recordCallUsage({
    sessionId,
    provider: engine.provider,
    model: engine.model,
    result,
    llmUsd,
    wrapUp,
    textItemId,
    hasBubble: hasTextBubble(),
    bubbleMeta: textItemMeta ?? turnMeta(),
    bookedByGate: true,
  });

  // An empty answer stays out of the history: a Retry would otherwise end the request with an empty assistant message.
  if (result.text || result.toolCalls.length) {
    deps.pushHistory(sessionId, {
      role: 'assistant',
      content: result.text || null,
      tool_calls: result.toolCalls.length ? result.toolCalls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.arguments } })) : undefined,
      ...(result.reasoningDetails ? { reasoning_details: result.reasoningDetails } : {}),
    }, owner);
  }

  if (!result.toolCalls.length) {
    // Nothing to show and nothing to run (T2): say what actually happened, and leave the turn retryable.
    if (!result.text.trim()) {
      guard.setOutcome('empty');
      const cut = result.finishReason === 'length';
      const possibleCharge = outcomeWasPaid();
      const reason = cut ? 'The model spent its whole output budget thinking and answered nothing. Lower the reasoning in Settings or pick another model, then try again.' : 'The model returned an empty answer.';
      deps.notice(
        sessionId,
        workspace,
        possibleCharge ? reason + ' This request may have been charged. Retrying may charge you again.' : reason,
        'error',
        { possibleCharge },
        usage.takePendingMeta(turnMeta(), hasTextBubble()),
      );
    }
    return { stop: true };
  }

  return { stop: false, result, textItemId, hasTextBubble };
}
