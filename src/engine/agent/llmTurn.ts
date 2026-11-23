import { runCanvasCall } from './canvasCalls';
import { commandCatalog } from './commandCalls';
import { mayStartWork } from '../../lib/writerLock';
import { isAbort } from '../../lib/http';
import { llmCallEstimate, overLimitAccepted } from '../budget';
import { guardLlmBudget, onAgentCredit } from '../credit';
import { loadLlmCatalog } from '../catalog';
import { uid } from '../../lib/id';
import type { ChatMessageMeta } from '../feedMeta';
import type { AgentState, AgentStyle, Workspace } from '../types';
import { SYSTEM_PROMPT } from './context';
import { startTurnLog, type TurnRoute } from './turnLog';
import { recordMetric, turnClock } from './metrics';
import { autoAnswer, imagesFirst, modelsNeedSettings, sectionsOfParts, settingsForPlan } from './settingsParts';
import { stoppedText } from './stopNotice';
import { untilStopped } from './turnStop';
import { activityLog } from './activityLog';
import { inferChoices } from './userChoice';
import { TOOLS, CAPABILITIES, MUST } from './tools';
import { agentEngine, feedOfAgent, controllers, turnKey, ending, engineLabel, feedBase, get, keepCommentedPlan, llmCallUsd, messageMeta, notice, patchAgent, presentPlan, rowCanvas, session, setThreadOpen, showQuestions } from './runtimeShared';
import { agentOf } from './lanes';
import { CONVERTED_CALL, flushToolResults, pushHistory, repairHistory } from './conversation';
import { createTurnGuard, SILENCE_MS, TURN_CAP_MS } from './turnGuard';
import { createTurnUsageTracker } from './turnUsage';
import { runTurnModelCall } from './turnModelCall';
import type { ProposePlanState } from './proposePlanCall';
import { runTurnToolLoop } from './turnToolLoop';

/** Direct mode asks nothing and shows no settings card, so those two tools are not offered to the model. */
const DIRECT_HIDDEN_TOOLS = new Set(['ask_questions', 'confirm_settings']);
const PRICE_CATALOG_WAIT_MS = 3000;
function toolsFor(style: AgentStyle) {
  return style === 'direct' ? TOOLS.filter((t) => !DIRECT_HIDDEN_TOOLS.has(t.function.name)) : TOOLS;
}

let systemCache: string | undefined;
export const agentSystem = () => (systemCache ??= `${MUST}\n\n${CAPABILITIES}\n\n${commandCatalog()}\n\n${SYSTEM_PROMPT}\n\n${MUST}`);

export async function llmTurn(sessionId: string, startWorkspace: Workspace, opts: { route: TurnRoute; textOnly?: boolean; creditRetried?: boolean; budgetPass?: boolean; runId?: string; agentNodeId: string }): Promise<void> {
  // Canvas can change mid-turn (open_board, continue_in_*).
  let workspace = startWorkspace;
  // Turn stays bound to one agent regardless of what is on screen later.
  const owner = opts.agentNodeId;
  const mine = (): AgentState => agentOf(sessionId, owner);
  const engine = agentEngine(sessionId, owner);
  if (engine.kind !== 'llm' || !mayStartWork()) return;
  const runId = opts.runId ?? uid('turn');
  const title = engineLabel(sessionId, owner);
  const guardBudget = () => guardLlmBudget(sessionId, engine.provider, engine.model, title, () => { if (!session(sessionId)) return; if (mine().busy) { notice(sessionId, workspace, 'The agent is busy. Send again when it finishes.', 'info'); return; } void llmTurn(sessionId, workspace, { ...opts, runId, budgetPass: true }); }, opts.budgetPass);
  const waitForPrice = !opts.budgetPass && !overLimitAccepted(sessionId)
    && get().catalog.llmStatus[engine.provider] !== 'ready' && llmCallEstimate(engine.provider, engine.model).usd == null;
  if (!waitForPrice && !guardBudget()) return;
  const endLog = startTurnLog(sessionId, 'llm', opts.route, runId);
  patchAgent(sessionId, { busy: true, phase: 'working' }, owner);
  const log = activityLog(sessionId, rowCanvas(workspace), messageMeta(workspace, {}, sessionId, owner));
  const showThinking = get().settings.agent.showThinking !== false;
  const controller = new AbortController();
  controllers.set(turnKey(sessionId, owner), controller);
  const signal = controller.signal;
  const until = <T,>(work: Promise<T>) => untilStopped(work, signal);
  const clock = turnClock(sessionId);
  const firstOutput = () => recordMetric(sessionId, { type: 'output', ms: clock.elapsed() });
  const planState: ProposePlanState = { planFailures: 0, brokenPlan: undefined, settled: false };
  let lastBlock: string | undefined;
  const turnMeta = (): ChatMessageMeta => messageMeta(workspace, { agent: 'Director', provider: engine.provider, model: engine.model, runId }, sessionId, owner);
  const limitNote = () => notice(sessionId, workspace, `The agent reached the ${TURN_CAP_MS / 60_000} min limit for one turn and was stopped. Retry to continue.`, 'error', {}, turnMeta());
  const usage = createTurnUsageTracker();
  const guard = createTurnGuard({
    sessionId,
    controller,
    onSilence: () => log.action({ icon: 'fix', label: `Still working — no answer for ${SILENCE_MS / 1000} s` }),
    onLimitNote: limitNote,
    onFinish: (outcome) => {
      keepCommentedPlan(sessionId, owner);
      endLog(outcome);
      log.end();
      clock.end();
      patchAgent(sessionId, { busy: false, phase: undefined, waiting: undefined }, owner);
      if (controllers.get(turnKey(sessionId, owner)) === controller) controllers.delete(turnKey(sessionId, owner));
    },
  });
  ending.set(controller, () => guard.cancel(() => notice(sessionId, workspace, 'Stopped.', 'info', undefined, turnMeta())));
  guard.armSilence();
  try {
    const catalog = loadLlmCatalog(engine.provider);
    if (waitForPrice) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const deadline = new Promise<void>(resolve => { timeout = setTimeout(resolve, PRICE_CATALOG_WAIT_MS); });
        await until(Promise.race([catalog, deadline]));
      } finally {
        clearTimeout(timeout);
      }
      if (!session(sessionId) || !mayStartWork() || !guardBudget()) { guard.setOutcome('canceled'); return; }
    }
    for (let iteration = 0; iteration < 5; iteration++) {
      if (guard.checkOverCap()) return;
      if (iteration > 0 && !guardBudget()) { guard.setOutcome('canceled'); return; }
      const callOutcome = await runTurnModelCall({
        sessionId,
        owner,
        workspace,
        runId,
        wrapUp: opts.route === 'wrap-up',
        creditRetried: opts.creditRetried,
        budgetPass: opts.budgetPass,
        engine,
        system: agentSystem(),
        tools: toolsFor(get().composer.agentStyle),
        showThinking,
        signal,
        until,
        log,
        clockElapsed: () => clock.elapsed(),
        firstOutput,
        turnMeta,
        guard,
        usage,
        deps: {
          mine,
          get,
          session,
          patchAgent,
          pushHistory,
          repairHistory,
          convertedCallPrefix: CONVERTED_CALL,
          notice,
          messageMeta,
          feedBase,
          engineLabel,
          llmCallUsd,
          onAgentCredit,
          retryWithCredit: () => llmTurn(sessionId, workspace, { ...opts, runId, budgetPass: false, creditRetried: true }),
          onBudgetBlocked: () => { guardBudget(); },
        },
      });
      if (callOutcome.stop) {
        if (callOutcome.retryTurn) return callOutcome.retryTurn;
        return;
      }

      const loopOutcome = await runTurnToolLoop({
        sessionId,
        owner,
        workspace,
        onWorkspace: (next) => { workspace = next; },
        textOnly: opts.textOnly,
        result: callOutcome.result,
        textItemId: callOutcome.textItemId,
        hasTextBubble: callOutcome.hasTextBubble,
        until,
        signal,
        log,
        clockElapsed: () => clock.elapsed(),
        turnMeta,
        guard,
        usage,
        planState,
        deps: {
          mine,
          get,
          feedOfAgent,
          patchAgent,
          pushHistory,
          notice,
          rowCanvas,
          feedBase,
          setThreadOpen,
          showQuestions,
          flushToolResults,
          inferChoices,
          imagesFirst,
          sectionsOfParts,
          autoAnswer,
          modelsNeedSettings,
          settingsForPlan,
          presentPlan,
          runCanvasCall,
          getLastBlock: () => lastBlock,
          setLastBlock: (next) => { lastBlock = next; },
        },
      });
      workspace = loopOutcome.workspace;
      if (loopOutcome.roundBack) iteration--;
      if (loopOutcome.stop) return;
    }
    guard.setOutcome('error');
    notice(sessionId, workspace, stoppedText(lastBlock), 'error', undefined, usage.takePendingMeta(turnMeta(), false));
  } catch (err) {
    if (!isAbort(err)) throw err; // Stop during a tool: finish() already ended the turn
  } finally {
    // No revision came (text, questions, an error, a stop): the commented plan waits as it was (see finish).
    guard.finish();
  }
}
