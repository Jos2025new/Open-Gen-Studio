import { runCanvasCall } from './canvasCalls';
import { cardDraft, draftGate } from './draftActions';
import { mayStartWork } from '../../lib/writerLock';
import { planRequiresSettings, roundsFor } from '../procedure';
import { isAbort, isTransient } from '../../lib/http';
import { logEvent } from '../../lib/log';
import { journeyIdFor, recordJourneyEvent } from '../../lib/journeyTrace';
import { parseToolMarkup, toolMarkupAt } from './toolMarkup';
import { isCreditError, onAgentCredit } from '../credit';
import { chat, LLM_LABELS, type ChatResult } from '../providers/llm';
import { composerChosen, loadLlmCatalog, modelSummary } from '../catalog';
import type { AgentStyle, FeedItem, LlmMessage, SettingsFeedItem, Workspace } from '../types';
import { addSpend, appendFeed, patchSession, removeFeedItem, updateFeedItem } from '../../store/store';
import { SYSTEM_PROMPT } from './context';
import { startTurnLog, type TurnOutcome, type TurnRoute } from './turnLog';
import { recordMetric, turnClock } from './metrics';
import { drainAgentNotes } from './priceNotes';
import { keepConfirmed, switchSection } from './switchModel';
import { durationOwed } from './modelLimits';
import { autoAnswer, imagesFirst, sectionsOfParts, settingsForPlan, modelsNeedSettings } from './settingsParts';
import { rejectionOf, stoppedText } from './stopNotice';
import { OPS } from '../ops';
import { checkingPlan, untilStopped } from './turnStop';
import { activityLog } from './activityLog';
import { waitHooks } from './schemaWait';
import { inferChoices } from './userChoice';
import { TOOLS, CAPABILITIES, MUST, askQuestionsSchema, confirmSettingsSchema, formatZodError, parseToolArgs, proposePlanSchema, toRawPlan } from './tools';
import { agentEngine, controllers, ending, engineLabel, feedBase, get, keepCommentedPlan, llmCallUsd, notice, patchAgent, presentPlan, rowCanvas, session, setThreadOpen, showQuestions } from './runtimeShared';
import { CONVERTED_CALL, flushToolResults, pushHistory, repairHistory } from './conversation';

/** A turn that says nothing for a minute says so (a long reasoning is legitimate); one that reaches five minutes is cut. */
/** Direct mode asks nothing and shows no settings card, so those two tools are not offered to the model. */
const DIRECT_HIDDEN_TOOLS = new Set(['ask_questions', 'confirm_settings']);
function toolsFor(style: AgentStyle) {
  return style === 'direct' ? TOOLS.filter((t) => !DIRECT_HIDDEN_TOOLS.has(t.function.name)) : TOOLS;
}

const SILENCE_MS = 60_000;
const TURN_CAP_MS = 5 * 60_000;
const AGENT_SYSTEM = `${MUST}\n\n${CAPABILITIES}\n\n${SYSTEM_PROMPT}\n\n${MUST}`;
/** Past this, append one warning for this turn (a running stream cannot be interrupted). */
const HURRY_MS = 50_000;
const HURRY_NOTE =
  '<system_warning>For this agent turn only, until the next user request: the user has been waiting over 50 seconds. Be brief. If you have the answer, give it now; if you need a tool, call it now; if you cannot do it, say so in one sentence. Do not deliberate further.</system_warning>';

export async function llmTurn(sessionId: string, startWorkspace: Workspace, opts: { route: TurnRoute; textOnly?: boolean; creditRetried?: boolean }): Promise<void> {
  // The canvas can change inside the turn (open_board, continue_in_*): every gate below reads the current one.
  let workspace = startWorkspace;
  const engine = agentEngine();
  if (engine.kind !== 'llm' || !mayStartWork()) return;
  void loadLlmCatalog(engine.provider);
  const endLog = startTurnLog(sessionId, 'llm', opts.route);
  let outcome: TurnOutcome = 'text';
  patchAgent(sessionId, { busy: true, phase: 'working' });
  const log = activityLog(sessionId, rowCanvas(workspace));
  const showThinking = get().settings.agent.showThinking !== false;
  const controller = new AbortController();
  controllers.set(sessionId, controller);
  const signal = controller.signal;
  const until = <T,>(work: Promise<T>) => untilStopped(work, signal);
  const clock = turnClock(sessionId);
  const turnStart = Date.now();
  const firstOutput = () => recordMetric(sessionId, { type: 'output', ms: clock.elapsed() });
  let planFailures = 0;
  let lastBlock: string | undefined;
  // Auto confirming the settings itself is the app's step, not the agent's: once per turn it gives the round back.
  let settled = false;
  let hurryNoted = false;
  // If nothing comes out for a minute the activity block says so (Stop is in the composer); output re-arms it.
  // The five-minute cap is the only thing that ends a turn by force (T3).
  let silenceTimer: ReturnType<typeof setTimeout> | undefined;
  let armedAt = 0;
  let cutTurn = false;
  let done = false;
  const armSilence = () => {
    const now = Date.now();
    if (done) return;
    if (now - armedAt < 5_000) return; // a stream of deltas must not churn timers
    armedAt = now;
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => log.action({ icon: 'fix', label: `Still working — no answer for ${SILENCE_MS / 1000} s` }), SILENCE_MS);
  };
  const limitNote = () => notice(sessionId, workspace, `The agent reached the ${TURN_CAP_MS / 60_000} min limit for one turn and was stopped. Retry to continue.`, 'error', {});
  // The end of the turn, once: Stop and the cap call it; the turn's own exit finds it done and leaves a newer turn alone.
  const finish = (say?: () => void) => {
    if (done) return;
    done = true;
    say?.();
    clearTimeout(silenceTimer);
    clearTimeout(capTimer);
    keepCommentedPlan(sessionId);
    endLog(outcome);
    log.end();
    clock.end();
    patchAgent(sessionId, { busy: false, phase: undefined, waiting: undefined });
    if (controllers.get(sessionId) === controller) controllers.delete(sessionId);
  };
  const cut = () => {
    cutTurn = true;
    outcome = 'cut';
    logEvent('agent', { session: sessionId, event: 'turn-cut', limit: 'turn', ms: TURN_CAP_MS });
    controller.abort();
    finish(limitNote);
  };
  const capTimer = setTimeout(cut, TURN_CAP_MS);
  ending.set(controller, () => { outcome = 'canceled'; finish(() => notice(sessionId, workspace, 'Stopped.', 'info')); });
  armSilence();
  try {
    for (let iteration = 0; iteration < 5; iteration++) {
          if (cutTurn || Date.now() - turnStart > TURN_CAP_MS) {
        if (!cutTurn) logEvent('agent', { session: sessionId, event: 'turn-cut', limit: 'turn', ms: Date.now() - turnStart });
        outcome = 'cut';
        limitNote();
        return;
      }
      let textItemId: string | null = null;
      let result: ChatResult;
      try {
        if (session(sessionId).agent.phase !== 'working') patchAgent(sessionId, { phase: 'working' });
        drainAgentNotes(sessionId);
        if (!hurryNoted && Date.now() - turnStart > HURRY_MS) {
          pushHistory(sessionId, { role: 'user', content: HURRY_NOTE });
          hurryNoted = true;
        }
        result = await until(chat({
          provider: engine.provider,
          apiKey: engine.key,
          model: engine.model,
          system: AGENT_SYSTEM,
          messages: repairHistory(session(sessionId).agent.history),
          tools: toolsFor(get().composer.agentStyle),
          effort: get().settings.agent.effort,
          showReasoning: showThinking,
          onNotice: (text) => !done && notice(sessionId, workspace, text, 'info'),
          onReasoning: showThinking ? (_d, full) => !done && (armSilence(), log.thinking(full)) : undefined,
          signal,
          onToolCall: () => {
            if (done) return;
            firstOutput();
            armSilence();
            patchAgent(sessionId, { phase: 'drafting' });
          },
          onText: (_delta, full) => {
            if (done) return;
            armSilence();
            if (!textItemId) {
              firstOutput();
              const item: FeedItem = { ...feedBase(workspace), type: 'assistant', text: full, streaming: true, engine: engineLabel() };
              textItemId = item.id;
              appendFeed(sessionId, item);
            } else {
              updateFeedItem(sessionId, textItemId, { text: full });
            }
          },
        }));
      } catch (err) {
        if (textItemId) updateFeedItem(sessionId, textItemId, { streaming: false });
        if (isAbort(err)) {
          // Stop and the cap already said so and ended the turn; this is an abort from elsewhere.
          outcome = cutTurn ? 'cut' : 'canceled';
          if (!done) (cutTurn ? limitNote : () => notice(sessionId, workspace, 'Stopped.', 'info'))();
          return;
        }
        // No credit for the agent's model: the same model elsewhere (same price or less) takes over and the call runs
        // again once; otherwise the choices are shown above the prompt box and the notice keeps Retry.
        if (isCreditError(err) && !opts.creditRetried) {
          if (textItemId) removeFeedItem(sessionId, textItemId);
          if (await until(onAgentCredit())) { outcome = 'error'; return llmTurn(sessionId, workspace, { ...opts, creditRetried: true }); }
        }
        // History only grows with completed calls, so a retry repeats just the call that failed.
        const retry = isTransient(err) || isCreditError(err) ? { ...(textItemId ? { partialItemId: textItemId } : {}) } : undefined;
        // The call happened and cost time: it is a call in the metrics even though it produced nothing (T2).
        recordMetric(sessionId, { type: 'failedCall', error: (err as Error).message, ms: clock.elapsed() });
        outcome = 'error';
        notice(sessionId, workspace, `${LLM_LABELS[engine.provider]}: ${(err as Error).message}`, 'error', retry);
        return;
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
          toolCalls: converted.map((c, i) => ({ ...c, id: `${CONVERTED_CALL}${Date.now().toString(36)}_${i}` })),
        };
        if (textItemId) {
          if (result.text) updateFeedItem(sessionId, textItemId, { streaming: false, text: result.text });
          else removeFeedItem(sessionId, textItemId);
        }
      } else if (garbled >= 0) {
        const shown = result.text.slice(0, garbled).trim();
        if (textItemId) updateFeedItem(sessionId, textItemId, { streaming: false, text: shown || '…' });
        appendFeed(sessionId, {
          ...feedBase(workspace),
          type: 'notice',
          level: 'error',
          text: 'The model wrote its action as text the app cannot read, so nothing ran.',
          retry: textItemId ? { partialItemId: textItemId } : {},
          ...(textItemId ? { garbledItemId: textItemId } : {}),
        });
        outcome = 'error';
        return;
      }
      if (textItemId) updateFeedItem(sessionId, textItemId, { streaming: false, text: result.text.trim() });
      // Every tier counts: the provider's reported cost, else tokens × the catalog price (marked estimated). Never blocks.
      const llmUsd = llmCallUsd(engine.provider, engine.model, result.usage);
      recordMetric(sessionId, {
        type: 'call',
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
        usd: llmUsd,
        timing: { ...result.timing, reasoningTokens: result.usage?.reasoningTokens, cachedTokens: result.usage?.cachedTokens },
      });
      addSpend(llmUsd, { category: 'agent', provider: engine.provider, model: engine.model, sessionId, estimated: result.usage?.costUsd == null });
      if (result.usage) {
        const u = result.usage;
        patchSession(sessionId, (s) => ({
          ...s,
          usage: { inputTokens: s.usage.inputTokens + u.inputTokens, outputTokens: s.usage.outputTokens + u.outputTokens, llmUsd: s.usage.llmUsd + llmUsd },
        }));
      }
      // An empty answer stays out of the history: a Retry would otherwise end the request with an empty assistant message.
      if (result.text || result.toolCalls.length) pushHistory(sessionId, {
        role: 'assistant',
        content: result.text || null,
        tool_calls: result.toolCalls.length ? result.toolCalls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.arguments } })) : undefined,
        ...(result.reasoningDetails ? { reasoning_details: result.reasoningDetails } : {}),
      });
      if (!result.toolCalls.length) {
        // Nothing to show and nothing to run (T2): say what actually happened, and leave the turn retryable.
        if (!result.text.trim()) {
          outcome = 'empty';
          const cut = result.finishReason === 'length';
          notice(sessionId, workspace, cut ? 'The model spent its whole output budget thinking and answered nothing. Lower the reasoning in Settings or pick another model, then try again.' : 'The model returned an empty answer.', 'error', {});
        }
        return;
      }
      // The wrap-up after a plan (S4) is text only: a tool call there is answered as ignored and nothing runs.
      if (opts.textOnly) {
        flushToolResults(sessionId, result.toolCalls.map((c) => ({ role: 'tool' as const, tool_call_id: c.id, content: 'Ignored: this reply is text only.' })));
        return;
      }

      const toolResults: LlmMessage[] = [];
      const afterTools: LlmMessage[] = [];
      // One action (questions or plan) per turn; later calls in the same message are answered as ignored.
      const ignoreRest = (fromIndex: number) => {
        for (const c of result.toolCalls.slice(fromIndex + 1)) {
          toolResults.push({ role: 'tool', tool_call_id: c.id, content: 'Ignored: only one action per turn is processed.' });
        }
      };
      for (const [index, call] of result.toolCalls.entries()) {
        const respond = (content: string) => { toolResults.push({ role: 'tool', tool_call_id: call.id, content }); lastBlock = rejectionOf(content) ?? lastBlock; };
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
          const ag = () => session(sessionId).agent;
          const v = confirmSettingsSchema.safeParse(parsed.value);
          if (!v.success) { respond(`Invalid confirm_settings input: ${formatZodError(v.error)}`); continue; }
          inferChoices(sessionId, 'confirm_settings', v.data.parts);
          if (workspace === 'node') { respond('The node canvas has its own settings on each node: call propose_plan directly.'); continue; }
          const parts = imagesFirst(v.data.parts);
          const { sections, failed } = await sectionsOfParts(sessionId, parts, until, log);
          if (failed || !sections.length) { respond(failed || 'confirm_settings needs at least one part.'); continue; }
          if (get().composer.agentStyle === 'auto') { respond(await autoAnswer(sessionId, rowCanvas(workspace), call.id, v.data.summary, sections, parts, log)); continue; }
          log.action({ icon: 'questions', label: 'Asked to confirm the settings', detail: sections.map((x) => modelSummary(x.recommended.modelRef)?.name).join(' · ') });
          ignoreRest(index);
          flushToolResults(sessionId, toolResults);
          const sw = await switchSection(sections, ag().settings, ag().settingsParts, parts[0]?.user_requested === true, parts[0]?.model, undefined, parts[0]);
          const kept = sw ? undefined : await keepConfirmed(sections, ag().settings, parts, (k) => (composerChosen(k) ? get().composer[k].modelRef : undefined));
          const item: SettingsFeedItem = { ...feedBase(workspace), type: 'settings', summary: v.data.summary, status: 'pending', toolCallId: call.id, ...cardDraft(sessionId, sw ? [sw.section] : kept!.sections), ...(sw ? { switchFrom: sw.from, followUp: sw.followUp } : { keptAsked: kept!.asked }) };
          appendFeed(sessionId, item);
          recordJourneyEvent({ journeyId: journeyIdFor(sessionId) ?? sessionId, journey: 'settings-response', event: 'settings.presented', reason: 'agent requested settings confirmation', sessionId, approvalId: item.id, after: { choices: sections.map((x) => ({ kind: x.kind, modelRef: x.recommended.modelRef, count: x.count, duration: x.recommended.duration, needsImage: x.recommended.needsImage })) } });
          patchAgent(sessionId, { pending: { toolCallId: call.id, kind: 'settings', feedItemId: item.id } });
          if (get().ui.workspace !== 'chat') setThreadOpen(true);
          outcome = 'settings';
          return;
        }
        if (call.name === 'ask_questions') {
          const style = get().composer.agentStyle;
          const s = session(sessionId);
          // Auto allows one card for what changes the result or cost (F1); guided, the rounds set in Settings.
          if (s.agent.questionRound >= roundsFor(style, get().settings.guidedRounds) && !durationOwed(s.agent.history)) {
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
          flushToolResults(sessionId, toolResults);
          recordMetric(sessionId, { type: 'questions' });
          showQuestions(
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
          );
          outcome = 'questions';
          return;
        }
        const canvas = await runCanvasCall({ sessionId, workspace, call, parsed, index, log, until, respond, ignoreRest, toolResults, afterTools });
        workspace = canvas.workspace;
        if (canvas.stop) return;
        if (canvas.handled) continue;
        if (call.name === 'propose_plan') {
          const v = proposePlanSchema.safeParse(parsed.value);
          if (!v.success) {
            respond(`Invalid propose_plan input: ${formatZodError(v.error)}`);
            recordMetric(sessionId, { type: 'rejected' });
            logEvent('harness', { session: sessionId, where: 'propose_plan', problems: formatZodError(v.error) });
            planFailures++;
            continue;
          }
          inferChoices(sessionId, 'propose_plan', v.data.steps);
          if (!v.data.revision && (session(sessionId).agent.settingsParts?.length ?? 0) > 1) {
            const feed = session(sessionId).feed;
            const userAt = feed.findLastIndex((f) => f.type === 'user');
            if (!feed.slice(userAt + 1).some((f) => f.type === 'settings' && f.status === 'confirmed')) patchAgent(sessionId, { settingsParts: undefined });
          }
          // Guided confirms settings per request; the session model still persists.
          if (workspace !== 'node' && get().composer.agentStyle === 'guided' && session(sessionId).agent.questionRound === 0) {
            respond('Guided mode: ask your questions first (ask_questions, one card), then propose the plan.');
            continue;
          }
          const kinds = v.data.steps.map((st) => (st.kind === 'op' && (OPS as Record<string, { engine: string }>)[st.op ?? '']?.engine === 'edit' ? 'image' : st.kind));
          const gate = workspace !== 'node' && get().composer.agentStyle !== 'direct' ? planRequiresSettings(workspace, kinds, (get().composer.agentStyle === 'guided' ? Object.fromEntries((session(sessionId).agent.settingsParts ?? []).map((p) => [p.kind, p])) : session(sessionId).agent.settings)) : null;
          const draft = workspace === 'node' ? null : draftGate(v.data.steps, session(sessionId).feed, get().composer.agentStyle, v.data.revision === true);
          if (gate || draft || (get().composer.agentStyle === 'auto' && await modelsNeedSettings(sessionId, v.data.steps))) {
            // Auto: the app runs the confirm path itself and answers with the effective settings; the plan is not shown, so the prompts are written for them (a flow step, not a rejection).
            const told = get().composer.agentStyle === 'auto' ? await settingsForPlan(sessionId, rowCanvas(workspace), call.id, v.data.steps, until, log) : (gate ?? draft)!;
            if (told !== null) {
              if (get().composer.agentStyle !== 'auto') recordMetric(sessionId, { type: 'rejected' });
              else if (!settled) { settled = true; iteration--; }
              respond(told);
              continue;
            }
          }
          patchAgent(sessionId, { phase: 'checking' });
          const waits = waitHooks({ patch: (fn) => patchAgent(sessionId, fn), action: (entry) => log.action(entry) });
          const presented = await checkingPlan(sessionId, signal, () => presentPlan(sessionId, workspace, toRawPlan(v.data), call.id, v.data.revision === true, clock.elapsed(), signal), waits);
          if (presented.settingsNeeded) {
            // Same as a blocked plan: what the agent wrote before it is dropped; the user sees no card.
            if (textItemId) removeFeedItem(sessionId, textItemId);
            recordMetric(sessionId, { type: 'rejected' });
            respond(presented.settingsNeeded);
            continue;
          }
          if (presented.errors.length) {
            // What the agent wrote before a rejected plan promised it; the feed drops it (the history keeps it).
            if (textItemId) removeFeedItem(sessionId, textItemId);
            recordMetric(sessionId, { type: 'rejected' });
            log.action({ icon: 'fix', label: `Checked the plan: ${presented.errors.length} problem${presented.errors.length === 1 ? '' : 's'} to fix`, detail: presented.errors[0] });
            planFailures++;
            logEvent('harness', { session: sessionId, where: 'plan', problems: presented.errors });
            respond(`Plan rejected by the validator. Fix these problems and call propose_plan again:\n- ${presented.errors.join('\n- ')}`);
            continue;
          }
          log.action({ icon: 'plan', label: v.data.revision ? 'Revised the plan' : 'Drafted the plan', detail: v.data.title });
          // This call's result is sent when the user approves or cancels.
          ignoreRest(index);
          flushToolResults(sessionId, toolResults);
          outcome = 'plan';
          return;
        }
        respond(`Unknown tool "${call.name}".`);
      }
      flushToolResults(sessionId, toolResults);
      for (const m of afterTools) pushHistory(sessionId, m);
      if (planFailures >= 3) {
        outcome = 'error';
        notice(sessionId, workspace, 'The agent could not produce a valid plan. Try rephrasing or pick another model.');
        return;
      }
    }
    outcome = 'error';
    notice(sessionId, workspace, stoppedText(lastBlock));
  } catch (err) {
    if (!isAbort(err)) throw err; // Stop during a tool: finish() already ended the turn
  } finally {
    // No revision came (text, questions, an error, a stop): the commented plan waits as it was (see finish).
    finish();
  }
}

/** Cost of one model call: what the provider reported, else tokens at the catalog's per-million prices. */
