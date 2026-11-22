import { logEvent } from '../../lib/log';
import type { ChatMessageMeta } from '../feedMeta';
import { OPS } from '../ops';
import type { RawPlan } from '../plan';
import { planRequiresSettings } from '../procedure';
import type { AgentState, FeedItem, LlmMessage, NoticeFeedItem, Workspace } from '../types';
import { removeFeedItem, type useStore } from '../../store/store';
import type { partsOfSteps } from './settingsParts';
import type { activityLog } from './activityLog';
import { canonicalJson } from './canonicalJson';
import { draftGate } from './draftActions';
import { recordMetric } from './metrics';
import { waitHooks } from './schemaWait';
import { formatZodError, proposePlanSchema, toRawPlan } from './tools';
import type { TurnGuard } from './turnGuard';
import { checkingPlan } from './turnStop';
import type { TurnUsageTracker } from './turnUsage';

export interface ProposePlanState {
  planFailures: number;
  /** Arguments of the last plan the validator refused. The same payload a second time ends the turn. */
  brokenPlan: string | undefined;
  // Auto confirming the settings itself is the app's step, not the agent's: once per turn it gives the round back.
  settled: boolean;
}

export interface ProposePlanDeps {
  mine: () => AgentState;
  get: () => ReturnType<typeof useStore.getState>;
  feedOfAgent: (sessionId: string, owner: string) => FeedItem[];
  patchAgent: (sessionId: string, patch: Partial<AgentState> | ((a: AgentState) => Partial<AgentState>), owner: string) => void;
  notice: (sessionId: string, workspace: Workspace, text: string, level: 'info' | 'error', retry?: NoticeFeedItem['retry'], meta?: Partial<ChatMessageMeta>) => void;
  rowCanvas: (workspace: Workspace) => Workspace;
  flushToolResults: (sessionId: string, results: LlmMessage[], owner: string) => void;
  inferChoices: (sessionId: string, owner: string, where: string, items: Array<{ kind?: string; model?: string; user_requested?: boolean }>) => void;
  modelsNeedSettings: (sessionId: string, owner: string, steps: Parameters<typeof partsOfSteps>[0]) => Promise<boolean>;
  settingsForPlan: (sessionId: string, owner: string, workspace: Workspace, toolCallId: string, steps: Parameters<typeof partsOfSteps>[0], until: <T>(work: Promise<T>) => Promise<T>, log: ReturnType<typeof activityLog>, meta?: ChatMessageMeta) => Promise<string | null>;
  presentPlan: (sessionId: string, workspace: Workspace, raw: RawPlan, toolCallId: string | null, owner: string, revision: boolean, agentMs: number, signal: AbortSignal, meta?: ChatMessageMeta) => Promise<{ errors: string[]; itemId?: string; settingsNeeded?: string }>;
}

/** Validates, checks settings gates, and presents a propose_plan tool call. */
export async function handleProposePlanCall(opts: {
  sessionId: string;
  owner: string;
  workspace: Workspace;
  callId: string;
  parsedValue: unknown;
  index: number;
  textItemId: string | null;
  hasTextBubble: () => boolean;
  toolResults: LlmMessage[];
  respond: (content: string) => void;
  ignoreRest: (fromIndex: number) => void;
  until: <T>(work: Promise<T>) => Promise<T>;
  signal: AbortSignal;
  log: ReturnType<typeof activityLog>;
  clockElapsed: () => number;
  turnMeta: () => ChatMessageMeta;
  guard: TurnGuard;
  usage: TurnUsageTracker;
  state: ProposePlanState;
  deps: ProposePlanDeps;
}): Promise<{ status: 'continue' | 'stop'; roundBack?: boolean }> {
  const { sessionId, owner, workspace, callId, parsedValue, index, textItemId, hasTextBubble, toolResults, respond, ignoreRest, until, signal, log, clockElapsed, turnMeta, guard, usage, state, deps } = opts;

  const v = proposePlanSchema.safeParse(parsedValue);
  // The same broken plan twice (DeepSeek repeating a plan with no prompt): stop and say so. The model stays.
  const planKey = canonicalJson(parsedValue);
  const repeated = planKey === state.brokenPlan;
  // Answer the call (and the ones after it) so no tool_call is left open, drop the promise text, and end the turn.
  const stopRepeated = (why: string) => {
    if (textItemId) removeFeedItem(sessionId, textItemId);
    respond(`Stopped: the same invalid propose_plan twice (${why}).`);
    ignoreRest(index);
    deps.flushToolResults(sessionId, toolResults, owner);
    recordMetric(sessionId, { type: 'rejected' });
    logEvent('harness', { session: sessionId, where: 'propose_plan', problems: why, repeated: true });
    guard.setOutcome('error');
    deps.notice(sessionId, workspace, `The model sent the same invalid plan twice (${why}). This turn stopped. The model was not changed. Rephrase the request.`, 'error', undefined, usage.takePendingMeta(turnMeta(), false));
  };

  if (!v.success) {
    const why = formatZodError(v.error);
    if (repeated) { stopRepeated(why); return { status: 'stop' }; }
    state.brokenPlan = planKey;
    respond(`Invalid propose_plan input: ${why}`);
    recordMetric(sessionId, { type: 'rejected' });
    logEvent('harness', { session: sessionId, where: 'propose_plan', problems: why });
    state.planFailures++;
    return { status: 'continue' };
  }

  deps.inferChoices(sessionId, owner, 'propose_plan', v.data.steps);
  if (!v.data.revision && (deps.mine().settingsParts?.length ?? 0) > 1) {
    const feed = deps.feedOfAgent(sessionId, owner);
    const userAt = feed.findLastIndex((f) => f.type === 'user');
    if (!feed.slice(userAt + 1).some((f) => f.type === 'settings' && f.status === 'confirmed')) deps.patchAgent(sessionId, { settingsParts: undefined }, owner);
  }
  // Guided confirms settings per request; the session model still persists.
  if (workspace !== 'node' && deps.get().composer.agentStyle === 'guided' && deps.mine().questionRound === 0) {
    respond('Guided mode: ask your questions first (ask_questions, one card), then propose the plan.');
    return { status: 'continue' };
  }

  const kinds = v.data.steps.map((st) => (st.kind === 'op' && (OPS as Record<string, { engine: string }>)[st.op ?? '']?.engine === 'edit' ? 'image' : st.kind));
  const gate = workspace !== 'node' && deps.get().composer.agentStyle !== 'direct' ? planRequiresSettings(workspace, kinds, (deps.get().composer.agentStyle === 'guided' ? Object.fromEntries((deps.mine().settingsParts ?? []).map((p) => [p.kind, p])) : deps.mine().settings)) : null;
  const draft = workspace === 'node' ? null : draftGate(v.data.steps, deps.feedOfAgent(sessionId, owner), deps.get().composer.agentStyle, v.data.revision === true);
  if (gate || draft || (deps.get().composer.agentStyle === 'auto' && await deps.modelsNeedSettings(sessionId, owner, v.data.steps))) {
    // Auto: the app confirms itself and answers with the effective settings; the plan is not shown (a flow step, not a rejection).
    const told = deps.get().composer.agentStyle === 'auto' ? await deps.settingsForPlan(sessionId, owner, deps.rowCanvas(workspace), callId, v.data.steps, until, log, turnMeta()) : (gate ?? draft)!;
    if (told !== null) {
      let roundBack = false;
      if (deps.get().composer.agentStyle !== 'auto') recordMetric(sessionId, { type: 'rejected' });
      else if (!state.settled) { state.settled = true; roundBack = true; }
      respond(told);
      return { status: 'continue', roundBack };
    }
  }

  deps.patchAgent(sessionId, { phase: 'checking' }, owner);
  const waits = waitHooks({ patch: (fn) => deps.patchAgent(sessionId, fn, owner), action: (entry) => log.action(entry) });
  const presented = await checkingPlan(sessionId, owner, signal, () => deps.presentPlan(sessionId, workspace, toRawPlan(v.data), callId, owner, v.data.revision === true, clockElapsed(), signal, usage.pendingMeta(turnMeta(), hasTextBubble())), waits);
  if (presented.settingsNeeded) {
    // Same as a blocked plan: what the agent wrote before it is dropped; the user sees no card.
    if (textItemId) removeFeedItem(sessionId, textItemId);
    recordMetric(sessionId, { type: 'rejected' });
    respond(presented.settingsNeeded);
    return { status: 'continue' };
  }
  if (presented.errors.length) {
    // What the agent wrote before a rejected plan promised it; the feed drops it (the history keeps it).
    if (textItemId) removeFeedItem(sessionId, textItemId);
    if (repeated) { stopRepeated(presented.errors[0]); return { status: 'stop' }; }
    state.brokenPlan = planKey;
    recordMetric(sessionId, { type: 'rejected' });
    log.action({ icon: 'fix', label: `Checked the plan: ${presented.errors.length} problem${presented.errors.length === 1 ? '' : 's'} to fix`, detail: presented.errors[0] });
    state.planFailures++;
    logEvent('harness', { session: sessionId, where: 'plan', problems: presented.errors });
    respond(`Plan rejected by the validator. Fix these problems and call propose_plan again:\n- ${presented.errors.join('\n- ')}`);
    return { status: 'continue' };
  }

  log.action({ icon: 'plan', label: v.data.revision ? 'Revised the plan' : 'Drafted the plan', detail: v.data.title });
  if (!hasTextBubble()) usage.clearPending();
  // This call's result is sent when the user approves or cancels.
  ignoreRest(index);
  deps.flushToolResults(sessionId, toolResults, owner);
  guard.setOutcome('plan');
  return { status: 'stop' };
}
