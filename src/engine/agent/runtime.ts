import { uid } from '../../lib/id';
import { formatUsd } from '../../lib/format';
import { isAbort } from '../../lib/http';
import { ratioOf } from '../params';
import { needsSpendCheck } from '../pricing';
import { normalizePlan, type RawPlan } from '../plan';
import { executeSteps, estimateSteps } from '../executor';
import { autoLayout, graphBounds, graphToSteps, planToGraph, runsGeneration } from '../flow/graph';
import { activeDoc, ensureDoc } from '../design/actions';
import { skillById, workflowById } from '../skills';
import { chat, LLM_LABELS, type ChatResult } from '../providers/llm';
import { defaultModelFor, loadLlmCatalog, resolveModel } from '../catalog';
import type {
  AgentQuestion,
  AgentState,
  FeedItem,
  LlmMessage,
  MediaKind,
  Plan,
  PlanFeedItem,
  QuestionsFeedItem,
  Session,
  StepState,
  Workspace,
} from '../types';
import {
  appendFeed,
  autoTitleSession,
  patchSession,
  setComposer,
  setGraph,
  toast,
  updateFeedItem,
  useStore,
} from '../../store/store';
import { SYSTEM_PROMPT, buildContext } from './context';
import { offlinePlan } from './offline';
import { findModelsResult, suggestModel } from './modelIndex';
import { TOOLS, findModelsSchema, askQuestionsSchema, formatZodError, parseToolArgs, proposePlanSchema, toRawPlan } from './tools';

const get = useStore.getState;
let controller: AbortController | null = null;

// ---------------------------------------------------------------------------
// Helpers

function session(id: string): Session {
  return get().sessions[id];
}

function patchAgent(sessionId: string, patch: Partial<AgentState> | ((a: AgentState) => Partial<AgentState>)): void {
  patchSession(sessionId, (s) => ({ ...s, agent: { ...s.agent, ...(typeof patch === 'function' ? patch(s.agent) : patch) } }));
}

function feedBase(workspace: Workspace) {
  return { id: uid('fd'), createdAt: Date.now(), workspace };
}

function notice(sessionId: string, workspace: Workspace, text: string, level: 'info' | 'error' = 'error'): void {
  appendFeed(sessionId, { ...feedBase(workspace), type: 'notice', level, text });
  if (level === 'error' && get().ui.workspace !== 'chat') setThreadOpen(true);
}

function setThreadOpen(open: boolean): void {
  useStore.setState((st) => ({ ui: { ...st.ui, threadOpen: open } }));
}

export function agentEngine(): { kind: 'llm'; provider: 'openrouter' | 'nanogpt' | 'atlas'; model: string; key: string } | { kind: 'offline' } {
  const { agent, keys } = get().settings;
  if (agent.provider === 'offline') return { kind: 'offline' };
  const key = keys[agent.provider]?.trim();
  if (!key || !agent.model) return { kind: 'offline' };
  return { kind: 'llm', provider: agent.provider, model: agent.model, key };
}

export function engineLabel(): string {
  const e = agentEngine();
  return e.kind === 'offline' ? 'Local planner' : `${e.model.replace(/^[^/]+\//, '')} · ${LLM_LABELS[e.provider]}`;
}

/** Document size for a new design, from the composer's image aspect. */
export function designerDims(): { width: number; height: number } {
  const r = ratioOf(get().composer.image.settings.aspect) ?? 1;
  return r >= 1 ? { width: Math.round(1080 * r), height: 1080 } : { width: 1080, height: Math.round(1080 / r) };
}

function planContext(sessionId: string, workspace: Workspace) {
  const doc = workspace === 'designer' ? activeDoc(sessionId) : null;
  return {
    workspace,
    getModel: resolveModel,
    defaultModel: (kind: MediaKind, needsImage: boolean) => defaultModelFor(kind, needsImage),
    defaultSettings: (kind: MediaKind) => get().composer[kind].settings,
    asset: (id: string) => get().assets[id],
    layer: (id: string) => doc?.layers.find((l) => l.id === id),
    suggestModel,
  };
}

// ---------------------------------------------------------------------------
// Entry points

/** Send a message from the composer in agent mode. */
export async function sendAgentMessage(text: string): Promise<void> {
  const st = get();
  const sessionId = st.activeSessionId;
  const s = session(sessionId);
  if (!s || s.agent.busy) return;
  const workspace = st.ui.workspace;
  const attachments = [...st.composer.attachments];
  const clean = text.trim();
  if (!clean && !attachments.length) return;

  autoTitleSession(sessionId, clean || 'Edit');
  appendFeed(sessionId, { ...feedBase(workspace), type: 'user', text: clean, mode: 'agent', attachments });
  setComposer({ text: '', attachments: [] });

  const pending = s.agent.pending;
  const pendingItem = pending ? s.feed.find((f) => f.id === pending.feedItemId) : undefined;

  // Typing while questions are open answers them.
  if (pending?.kind === 'questions' && pendingItem?.type === 'questions' && pendingItem.status === 'pending') {
    await submitAnswers(sessionId, pendingItem.id, { note: clean }, 'typed');
    return;
  }
  // Typing while a plan waits for approval asks for changes.
  if (pending?.kind === 'plan' && pendingItem?.type === 'plan' && pendingItem.status === 'awaiting') {
    updateFeedItem<PlanFeedItem>(sessionId, pendingItem.id, { status: 'canceled' });
    removeDraftNodes(sessionId, pendingItem.plan.id);
    const engine = agentEngine();
    if (engine.kind === 'llm' && pending.toolCallId) {
      const ctx = buildContext(session(sessionId), contextOpts(sessionId, workspace, attachments));
      pushHistory(sessionId, { role: 'tool', tool_call_id: pending.toolCallId, content: `The user did not approve this plan and asked for changes: ${clean}\n\n${ctx}` });
      patchAgent(sessionId, { pending: undefined, notes: [] });
      await llmTurn(sessionId, workspace);
    } else {
      const draft = s.agent.draft;
      patchAgent(sessionId, { pending: undefined, draft: { request: `${draft?.request ?? ''} ${clean}`.trim(), answers: draft?.answers ?? {}, attachments: [...(draft?.attachments ?? []), ...attachments] } });
      await offlineTurn(sessionId, workspace);
    }
    return;
  }

  // A fresh request.
  if (pending) resolvePendingAsSuperseded(sessionId);
  patchAgent(sessionId, { questionRound: 0, draft: { request: clean, answers: {}, attachments } });
  const engine = agentEngine();
  if (engine.kind === 'offline') {
    await offlineTurn(sessionId, workspace);
    return;
  }
  const ctx = buildContext(session(sessionId), contextOpts(sessionId, workspace, attachments));
  pushHistory(sessionId, { role: 'user', content: `${clean || '(no text)'}\n\n${ctx}` });
  patchAgent(sessionId, { notes: [] });
  await llmTurn(sessionId, workspace);
}

function contextOpts(sessionId: string, workspace: Workspace, attachments: string[]) {
  const s = session(sessionId);
  return { workspace, style: get().composer.agentStyle, round: s.agent.questionRound, maxRounds: get().settings.guidedRounds, attachments };
}

function resolvePendingAsSuperseded(sessionId: string): void {
  const s = session(sessionId);
  const p = s.agent.pending;
  if (!p) return;
  const item = s.feed.find((f) => f.id === p.feedItemId);
  if (item?.type === 'questions' && item.status === 'pending') updateFeedItem<QuestionsFeedItem>(sessionId, item.id, { status: 'skipped' });
  if (item?.type === 'plan' && item.status === 'awaiting') {
    updateFeedItem<PlanFeedItem>(sessionId, item.id, { status: 'canceled' });
    removeDraftNodes(sessionId, item.plan.id);
  }
  if (p.toolCallId) pushHistory(sessionId, { role: 'tool', tool_call_id: p.toolCallId, content: 'The user moved on to a new request without responding.' });
  patchAgent(sessionId, { pending: undefined });
}

function pushHistory(sessionId: string, msg: LlmMessage): void {
  patchAgent(sessionId, (a) => ({ history: [...a.history, msg] }));
}

/** Answers chosen in a questions card. */
export async function submitAnswers(sessionId: string, itemId: string, answers: Record<string, string>, how: 'chips' | 'typed' = 'chips'): Promise<void> {
  const s = session(sessionId);
  const item = s.feed.find((f) => f.id === itemId);
  if (!item || item.type !== 'questions' || item.status !== 'pending') return;
  updateFeedItem<QuestionsFeedItem>(sessionId, itemId, { status: 'answered', answers });
  const workspace = item.workspace;
  const pending = s.agent.pending;
  patchAgent(sessionId, { pending: undefined });
  const engine = agentEngine();
  if (engine.kind === 'llm' && pending?.toolCallId) {
    const lines = item.questions.map((q) => `- ${q.question}: ${answers[q.id] ?? '(no answer)'}`);
    if (answers.note) lines.push(`- User note: ${answers.note}`);
    const ctx = buildContext(session(sessionId), contextOpts(sessionId, workspace, s.agent.draft?.attachments ?? []));
    pushHistory(sessionId, { role: 'tool', tool_call_id: pending.toolCallId, content: `User answers (${how}):\n${lines.join('\n')}\n\n${ctx}` });
    patchAgent(sessionId, { notes: [] });
    await llmTurn(sessionId, workspace);
    return;
  }
  const draft = s.agent.draft ?? { request: '', answers: {}, attachments: [] };
  const merged = { ...draft.answers, ...answers };
  // A typed note on an offline card enriches the request itself.
  const request = answers.note ? `${draft.request} ${answers.note}`.trim() : draft.request;
  patchAgent(sessionId, { draft: { ...draft, request, answers: merged } });
  await offlineTurn(sessionId, workspace);
}

/** "Skip, plan now" on a questions card: no more questions, plan with sensible defaults. */
export async function skipQuestions(sessionId: string, itemId: string): Promise<void> {
  const s = session(sessionId);
  const item = s.feed.find((f) => f.id === itemId);
  if (!item || item.type !== 'questions' || item.status !== 'pending') return;
  updateFeedItem<QuestionsFeedItem>(sessionId, itemId, { status: 'skipped' });
  const pending = s.agent.pending;
  patchAgent(sessionId, { pending: undefined, questionRound: get().settings.guidedRounds });
  const engine = agentEngine();
  if (engine.kind === 'llm' && pending?.toolCallId) {
    const ctx = buildContext(session(sessionId), contextOpts(sessionId, item.workspace, s.agent.draft?.attachments ?? []));
    pushHistory(sessionId, {
      role: 'tool',
      tool_call_id: pending.toolCallId,
      content: `The user skipped the questions. Use sensible defaults and call propose_plan now.\n\n${ctx}`,
    });
    patchAgent(sessionId, { notes: [] });
    await llmTurn(sessionId, item.workspace);
    return;
  }
  await offlineTurn(sessionId, item.workspace);
}

export function stopAgent(): void {
  controller?.abort();
}

// ---------------------------------------------------------------------------
// Offline planner

async function offlineTurn(sessionId: string, workspace: Workspace): Promise<void> {
  const s = session(sessionId);
  const draft = s.agent.draft ?? { request: '', answers: {}, attachments: [] };
  const st = get();
  const docDims = workspace === 'designer' ? activeDoc(sessionId) ?? designerDims() : undefined;
  const action = offlinePlan({
    request: draft.request,
    answers: draft.answers,
    round: s.agent.questionRound,
    maxRounds: st.settings.guidedRounds,
    style: st.composer.agentStyle,
    workspace,
    attachments: draft.attachments.map((id) => ({ id, kind: st.assets[id]?.kind ?? 'image' })).filter((a) => st.assets[a.id]),
    skillHint: skillById(st.composer.skillId)?.promptHint,
    workflow: workflowById(st.composer.workflowId),
    doc: docDims ? { width: docDims.width, height: docDims.height } : undefined,
  });
  if (action.kind === 'reply') {
    appendFeed(sessionId, { ...feedBase(workspace), type: 'assistant', text: action.text, engine: 'Local planner' });
    return;
  }
  if (action.kind === 'questions') {
    showQuestions(sessionId, workspace, action.intro, action.questions, null);
    return;
  }
  const result = await presentPlan(sessionId, workspace, action.plan, null);
  if (result.errors.length) notice(sessionId, workspace, `The plan could not be built: ${result.errors.join(' ')}`);
}

function showQuestions(sessionId: string, workspace: Workspace, intro: string | undefined, questions: AgentQuestion[], toolCallId: string | null): void {
  const s = session(sessionId);
  const round = s.agent.questionRound + 1;
  const item: QuestionsFeedItem = {
    ...feedBase(workspace),
    type: 'questions',
    intro,
    questions,
    round,
    maxRounds: get().settings.guidedRounds,
    status: 'pending',
  };
  appendFeed(sessionId, item);
  patchAgent(sessionId, { questionRound: round, pending: { toolCallId, kind: 'questions', feedItemId: item.id } });
  if (get().ui.workspace !== 'chat') setThreadOpen(true);
}

/** Validate a raw plan and show it. Auto mode runs free plans immediately. */
async function presentPlan(sessionId: string, workspace: Workspace, raw: RawPlan, toolCallId: string | null): Promise<{ errors: string[]; itemId?: string }> {
  const planId = uid('pln');
  const { plan, errors } = await normalizePlan(raw, planContext(sessionId, workspace), planId);
  if (!plan) return { errors };
  const { total } = estimateSteps(plan.steps);
  const style = get().composer.agentStyle;
  const item: PlanFeedItem = {
    ...feedBase(workspace),
    type: 'plan',
    plan,
    style,
    status: 'awaiting',
    stepStates: Object.fromEntries(plan.steps.map((st) => [st.id, 'pending' as StepState])),
    stepGenerations: {},
    estimate: total,
  };
  appendFeed(sessionId, item);
  patchAgent(sessionId, { pending: { toolCallId, kind: 'plan', feedItemId: item.id } });
  if (workspace === 'node') materializeNodes(sessionId, plan);
  if (style === 'auto' && !needsSpendCheck(total)) {
    void approvePlan(sessionId, item.id);
  } else if (get().ui.workspace !== 'chat') {
    setThreadOpen(true);
  }
  return { errors: [], itemId: item.id };
}

function materializeNodes(sessionId: string, plan: Plan): void {
  const { nodes, edges } = planToGraph(plan, (id) => get().assets[id]?.kind);
  const graph = session(sessionId).graph;
  const bounds = graphBounds(graph.nodes);
  const origin = bounds ? { x: bounds.x + bounds.w + 160, y: bounds.y } : { x: 0, y: 0 };
  const positions = autoLayout(nodes, edges, origin);
  setGraph(sessionId, (g) => ({
    ...g,
    nodes: [...g.nodes, ...nodes.map((n) => ({ ...n, position: positions.get(n.id) ?? n.position }))],
    edges: [...g.edges, ...edges],
  }));
}

function removeDraftNodes(sessionId: string, planId: string): void {
  setGraph(sessionId, (g) => {
    const drop = new Set(
      g.nodes
        .filter((n) => n.planId === planId && !(runsGeneration(n.data) && n.data.generationId))
        .map((n) => n.id),
    );
    if (!drop.size) return g;
    return { ...g, nodes: g.nodes.filter((n) => !drop.has(n.id)), edges: g.edges.filter((e) => !drop.has(e.source) && !drop.has(e.target)) };
  });
}

// ---------------------------------------------------------------------------
// Plan approval & execution

export function remainingBudget(): number {
  const st = get();
  return st.settings.budgetUsd - st.spentUsd;
}

export async function approvePlan(sessionId: string, itemId: string): Promise<void> {
  const s = session(sessionId);
  const item = s.feed.find((f) => f.id === itemId);
  if (!item || item.type !== 'plan' || item.status !== 'awaiting') return;
  const { plan } = item;
  // Re-estimate: models or prices may have loaded since the plan was shown.
  const { total } = estimateSteps(plan.steps);
  if (total.usd != null && total.usd > remainingBudget() + 1e-9) {
    toast(`This plan (${formatUsd(total.usd)}) exceeds the remaining budget (${formatUsd(Math.max(0, remainingBudget()))}). Raise it in Settings.`, 'error');
    return;
  }
  const pending = s.agent.pending;
  if (pending?.feedItemId === itemId) {
    if (pending.toolCallId) pushHistory(sessionId, { role: 'tool', tool_call_id: pending.toolCallId, content: 'Approved by the user. The app is executing the plan now.' });
    patchAgent(sessionId, { pending: undefined, questionRound: 0, draft: undefined });
  }
  updateFeedItem<PlanFeedItem>(sessionId, itemId, { status: 'running', estimate: total });

  const workspace = plan.workspace;
  let steps = plan.steps;
  const nodeOf = (stepId: string) => `${plan.id}_${stepId}`;
  if (workspace === 'node') {
    // Run what is on the canvas now (the user may have edited the drafted nodes).
    const graph = session(sessionId).graph;
    const ids = graph.nodes.filter((n) => n.planId === plan.id).map((n) => n.id);
    const run = graphToSteps(graph, ids, get().generations);
    if (run.errors.length) {
      updateFeedItem<PlanFeedItem>(sessionId, itemId, { status: 'error', error: run.errors.join(' ') });
      return;
    }
    steps = run.steps;
  }
  let docId: string | undefined;
  if (workspace === 'designer') docId = ensureDoc(sessionId, designerDims()).id;

  const result = await executeSteps(steps, {
    sessionId,
    planId: plan.id,
    workspace,
    origin: 'agent',
    docId,
    onState: (stepId, state, info) => {
      // Node runs use node ids as step ids; map back to plan step ids for the card.
      const planStepId = workspace === 'node' ? stepId.replace(`${plan.id}_`, '') : stepId;
      updateFeedItem<PlanFeedItem>(sessionId, itemId, (it) => ({
        ...it,
        stepStates: { ...it.stepStates, [planStepId]: state },
        stepGenerations: info?.generationId ? { ...it.stepGenerations, [planStepId]: info.generationId } : it.stepGenerations,
      }));
      if (info?.generationId) {
        if (workspace === 'chat') {
          appendFeed(sessionId, { ...feedBase(workspace), type: 'generation', generationId: info.generationId });
        } else if (workspace === 'node') {
          const nodeId = stepId.startsWith(`${plan.id}_`) ? stepId : nodeOf(stepId);
          setGraph(sessionId, (g) => ({
            ...g,
            nodes: g.nodes.map((n) =>
              n.id === nodeId && runsGeneration(n.data) ? { ...n, data: { ...n.data, generationId: info.generationId } } : n,
            ),
          }));
        }
      }
    },
  });

  const failed = result.failed.length;
  const status: PlanFeedItem['status'] = failed === 0 && !result.skipped.length ? 'done' : result.outputs.size ? 'partial' : 'error';
  updateFeedItem<PlanFeedItem>(sessionId, itemId, { status, error: failed ? result.failed.map((f) => `${f.stepId}: ${f.error}`).join(' · ') : undefined });
  const summary = plan.steps
    .map((st) => {
      const key = workspace === 'node' ? nodeOf(st.id) : st.id;
      const out = result.outputs.get(key);
      const fail = result.failed.find((f) => f.stepId === key);
      if (fail) return `${st.id} failed (${fail.error})`;
      if (!out) return `${st.id} skipped`;
      if (out.assetIds.length) return `${st.id} → ${out.assetIds.map((a) => `asset:${a}`).join(', ')}`;
      if (out.layerId) return `${st.id} → layer ${out.layerId}`;
      return `${st.id} done`;
    })
    .join('; ');
  patchAgent(sessionId, (a) => ({ notes: [...a.notes, `Plan "${plan.title}" ${status}: ${summary}`].slice(-6) }));
  if (status === 'done') toast(`${plan.title} · done`, 'success');
  else if (status === 'partial') toast(`${plan.title} finished with ${failed} failed step${failed === 1 ? '' : 's'}`, 'error');
  else toast(`${plan.title} failed`, 'error');
}

export function cancelPlan(sessionId: string, itemId: string): void {
  const s = session(sessionId);
  const item = s.feed.find((f) => f.id === itemId);
  if (!item || item.type !== 'plan' || item.status !== 'awaiting') return;
  updateFeedItem<PlanFeedItem>(sessionId, itemId, { status: 'canceled' });
  removeDraftNodes(sessionId, item.plan.id);
  const pending = s.agent.pending;
  if (pending?.feedItemId === itemId) {
    if (pending.toolCallId) pushHistory(sessionId, { role: 'tool', tool_call_id: pending.toolCallId, content: 'The user canceled this plan.' });
    patchAgent(sessionId, { pending: undefined, questionRound: 0 });
  }
}

// ---------------------------------------------------------------------------
// LLM loop

async function llmTurn(sessionId: string, workspace: Workspace): Promise<void> {
  const engine = agentEngine();
  if (engine.kind !== 'llm') return;
  void loadLlmCatalog(engine.provider);
  patchAgent(sessionId, { busy: true });
  controller = new AbortController();
  const signal = controller.signal;
  let planFailures = 0;
  try {
    for (let iteration = 0; iteration < 5; iteration++) {
      let textItemId: string | null = null;
      let result: ChatResult;
      try {
        result = await chat({
          provider: engine.provider,
          apiKey: engine.key,
          model: engine.model,
          system: SYSTEM_PROMPT,
          messages: repairHistory(session(sessionId).agent.history),
          tools: TOOLS,
          effort: get().settings.agent.effort,
          signal,
          onText: (_delta, full) => {
            if (!textItemId) {
              const item: FeedItem = { ...feedBase(workspace), type: 'assistant', text: full, streaming: true, engine: engineLabel() };
              textItemId = item.id;
              appendFeed(sessionId, item);
            } else {
              updateFeedItem(sessionId, textItemId, { text: full });
            }
          },
        });
      } catch (err) {
        if (textItemId) updateFeedItem(sessionId, textItemId, { streaming: false });
        if (isAbort(err)) {
          notice(sessionId, workspace, 'Stopped.', 'info');
          return;
        }
        notice(sessionId, workspace, `${LLM_LABELS[engine.provider]}: ${(err as Error).message}`);
        return;
      }
      if (textItemId) updateFeedItem(sessionId, textItemId, { streaming: false, text: result.text.trim() });
      if (result.usage) {
        const u = result.usage;
        patchSession(sessionId, (s) => ({
          ...s,
          usage: { inputTokens: s.usage.inputTokens + u.inputTokens, outputTokens: s.usage.outputTokens + u.outputTokens, llmUsd: s.usage.llmUsd + (u.costUsd ?? 0) },
        }));
      }
      pushHistory(sessionId, {
        role: 'assistant',
        content: result.text || null,
        tool_calls: result.toolCalls.length ? result.toolCalls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.arguments } })) : undefined,
      });
      if (!result.toolCalls.length) {
        if (!result.text.trim()) notice(sessionId, workspace, 'The model returned an empty answer. Try rephrasing.');
        return;
      }

      const toolResults: LlmMessage[] = [];
      // One action (questions or plan) per turn; later calls in the same message are answered as ignored.
      const ignoreRest = (fromIndex: number) => {
        for (const c of result.toolCalls.slice(fromIndex + 1)) {
          toolResults.push({ role: 'tool', tool_call_id: c.id, content: 'Ignored: only one action per turn is processed.' });
        }
      };
      for (const [index, call] of result.toolCalls.entries()) {
        const respond = (content: string) => toolResults.push({ role: 'tool', tool_call_id: call.id, content });
        if (result.finishReason === 'length') {
          respond('Your output was cut off (length limit). Send a shorter tool call.');
          continue;
        }
        const parsed = parseToolArgs(call.arguments);
        if (!parsed.ok) {
          respond(parsed.error);
          continue;
        }
        if (call.name === 'ask_questions') {
          const style = get().composer.agentStyle;
          const s = session(sessionId);
          if (style === 'auto') {
            respond('Auto mode: do not ask questions. Decide the details yourself and call propose_plan now.');
            continue;
          }
          if (s.agent.questionRound >= get().settings.guidedRounds) {
            respond('Question rounds are used up. Use sensible defaults for anything still open and call propose_plan now.');
            continue;
          }
          const v = askQuestionsSchema.safeParse(parsed.value);
          if (!v.success) {
            respond(`Invalid ask_questions input: ${formatZodError(v.error)}`);
            continue;
          }
          // This call's result is sent later, with the user's answers.
          ignoreRest(index);
          flushToolResults(sessionId, toolResults);
          showQuestions(
            sessionId,
            workspace,
            v.data.intro,
            v.data.questions.map((q) => ({ id: q.id, question: q.question, options: q.options, allowCustom: q.allow_custom ?? true, multi: q.multi ?? false })),
            call.id,
          );
          return;
        }
        if (call.name === 'find_models') {
          // Local search in the app's refined catalog; the agent continues in the next round.
          const v = findModelsSchema.safeParse(parsed.value);
          respond(v.success ? findModelsResult(v.data.query, v.data.kind) : `Invalid find_models input: ${formatZodError(v.error)}`);
          continue;
        }
        if (call.name === 'propose_plan') {
          const v = proposePlanSchema.safeParse(parsed.value);
          if (!v.success) {
            respond(`Invalid propose_plan input: ${formatZodError(v.error)}`);
            planFailures++;
            continue;
          }
          const presented = await presentPlan(sessionId, workspace, toRawPlan(v.data), call.id);
          if (presented.errors.length) {
            planFailures++;
            respond(`Plan rejected by the validator. Fix these problems and call propose_plan again:\n- ${presented.errors.join('\n- ')}`);
            continue;
          }
          // This call's result is sent when the user approves or cancels.
          ignoreRest(index);
          flushToolResults(sessionId, toolResults);
          return;
        }
        respond(`Unknown tool "${call.name}".`);
      }
      flushToolResults(sessionId, toolResults);
      if (planFailures >= 3) {
        notice(sessionId, workspace, 'The agent could not produce a valid plan. Try rephrasing or pick another model.');
        return;
      }
    }
    notice(sessionId, workspace, 'The agent stopped after several attempts without a result.');
  } finally {
    patchAgent(sessionId, { busy: false });
    controller = null;
  }
}

function flushToolResults(sessionId: string, results: LlmMessage[]): void {
  if (results.length) patchAgent(sessionId, (a) => ({ history: [...a.history, ...results] }));
  results.length = 0;
}

/** Keeps OpenAI-format history valid: every assistant tool call gets exactly one tool message. */
export function repairHistory(history: LlmMessage[]): LlmMessage[] {
  const out: LlmMessage[] = [];
  for (let i = 0; i < history.length; i++) {
    const m = history[i];
    out.push(m);
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const ids = m.tool_calls.map((c) => c.id);
      const following: LlmMessage[] = [];
      let j = i + 1;
      while (j < history.length && history[j].role === 'tool') {
        following.push(history[j]);
        j++;
      }
      const have = new Set(following.map((f) => f.tool_call_id));
      out.push(...following);
      for (const id of ids) {
        if (!have.has(id)) out.push({ role: 'tool', tool_call_id: id, content: 'No result.' });
      }
      i = j - 1;
    }
  }
  return out;
}

/**
 * After a reload, plans that were running have lost their executor. Their generations are resumed by
 * `resumeInterrupted`; follow them and close each card with its real outcome instead of "Running" forever.
 * Nothing is submitted again: steps that had not started before the reload are reported as not run.
 */
export function settleInterruptedPlans(): void {
  const open = new Set<string>();
  for (const s of Object.values(get().sessions)) for (const f of s.feed) if (f.type === 'plan' && f.status === 'running') open.add(`${s.id}|${f.id}`);
  if (!open.size) return;
  const check = () => {
    const gens = get().generations;
    for (const key of [...open]) {
      const [sessionId, itemId] = key.split('|');
      const item = get().sessions[sessionId]?.feed.find((f) => f.id === itemId);
      if (!item || item.type !== 'plan' || item.status !== 'running') {
        open.delete(key);
        continue;
      }
      const states: Record<string, StepState> = { ...item.stepStates };
      let pending = false;
      for (const st of item.plan.steps) {
        const gid = item.stepGenerations[st.id];
        const g = gid ? gens[gid] : undefined;
        if (g) states[st.id] = g.status === 'done' ? 'done' : g.status === 'error' || g.status === 'canceled' ? 'error' : ((pending = true), 'running');
        else if (states[st.id] !== 'done') states[st.id] = 'skipped';
      }
      if (pending) continue;
      open.delete(key);
      const done = Object.values(states).filter((v) => v === 'done').length;
      const all = item.plan.steps.length;
      updateFeedItem<PlanFeedItem>(sessionId, itemId, {
        stepStates: states,
        status: done === all ? 'done' : done ? 'partial' : 'error',
        error: done === all ? undefined : 'Interrupted by a page reload; some steps did not run.',
      });
    }
    if (!open.size) unsubscribe();
  };
  const unsubscribe = useStore.subscribe(check);
  check();
}

