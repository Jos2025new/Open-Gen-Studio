import { isStepKind, isVisualStep, stepInfo } from '../planSteps/inspect';
import { agentOf, dropThread, laneState, patchLane, resolveOwner } from './lanes';
import { MAIN_THREAD, feedOfAgentIn, feedOfChatIn } from './threads';
import { costAskMessage, needsConfirmation, roundsFor } from '../procedure';
import { prepareNodeRun } from '../flow/actions';
import { uid } from '../../lib/id';
import { journeyIdFor, recordJourneyEvent } from '../../lib/journeyTrace';
import { ratioOf } from '../params';
import { needsSpendCheck } from '../pricing';
import { pushAlert } from '../alerts';
import { normalizePlan, type RawPlan } from '../plan';
import { carryOverRevision } from '../planRevision';
import { offerRequest, userRequest } from '../modelNamed';
import { estimateSteps } from '../executor';
import { focusNodes } from '../flow/selection';
import { autoLayout, graphBounds, planToGraph, nodeOutputAsset } from '../flow/graph';
import { activeDoc } from '../design/actions';
import { LLM_LABELS, type ChatResult } from '../providers/llm';
import { composerChosen, defaultModelChoice, defaultModelFor, resolveModel, lineRoutes, sentModelRef } from '../catalog';
import { VISUAL_MEDIA_KINDS, type AgentQuestion, type AgentState, type Estimate, type LlmProviderId, type MediaKind, type NoticeFeedItem, type Plan, type PlanFeedItem, type QuestionsFeedItem, type Session, type StepState, type Workspace } from '../types';
import { localTimeZone, type ChatMessageMeta } from '../feedMeta';
import { placeFor } from '../place';
import { appendFeed, patchSession, toast, updateFeedItem, useStore } from '../../store/store';
import { editCompound, onNodesRemoved } from '../nodecore/edit';
import { suggestModel } from './modelIndex';
import { recordMetric } from './metrics';
import { gateOps } from './force';
import { agentCanvas } from './agentCanvas';
import { watchModel } from './turnStop';
import { approvePlan, removeDraftNodes } from './planRun';

export const get = useStore.getState;
/** One controller per turn, by session: a turn in one session never stops or clears another's. */
export const controllers = new Map<string, AbortController>();
/** Ends a turn at once (Stop, the cap), without waiting for what it awaits. */
export const ending = new WeakMap<AbortController, () => void>();

/** Stops one agent's turn (abort, then end it at once): the other agents of the session keep working. */
export function stopAgent(sessionId: string, owner: string): void {
  const c = controllers.get(turnKey(sessionId, owner));
  if (!c) return;
  c.abort();
  ending.get(c)?.();
}

/** Stops every agent of a session (deleting it, the writer handoff). */
export function stopSession(sessionId: string): void {
  for (const key of [...controllers.keys()]) if (key.startsWith(`${sessionId}|`)) stopAgent(sessionId, key.slice(sessionId.length + 1));
}

// An agent node that goes stops its own turn: nothing keeps working (and spending) for a node that is not there.
onNodesRemoved((sessionId, removed) => {
  for (const n of removed) {
    if (n.data.kind !== 'ref' || n.data.type !== 'agent') continue;
    stopAgent(sessionId, n.id);
    dropThread(sessionId, n.id);
  }
});

// ---------------------------------------------------------------------------
// Helpers

export function session(id: string): Session {
  return get().sessions[id];
}

/** The operations the current request names, fired or not by its attachments and parameters (agent/force.ts). */
export function requestGate(sessionId: string, owner: string) {
  const draft = agentOf(sessionId, owner).draft;
  const inputs = (draft?.attachments ?? []).flatMap((id) => (get().assets[id] ? [get().assets[id]] : []));
  return gateOps(draft?.request ?? '', inputs, get().composer.agentStyle === 'direct');
}


/** Write an agent's state: the one named by `agentNodeId` (a turn always names its own), else the agent on screen. */
export function patchAgent(sessionId: string, patch: Partial<AgentState> | ((a: AgentState) => Partial<AgentState>), agentNodeId: string): void {
  patchLane(sessionId, agentNodeId, patch);
}

/** An agent's state by id (explicit); `undefined` is the agent on screen, for a caller no agent owns. */
export { agentOf };

/** One abort controller per running turn: an agent's key is its own, so two agents of one session can run at once. */
export const turnKey = (sessionId: string, owner: string): string => `${sessionId}|${owner}`;

/** Where a row is shown: Studio's chat keeps every row as chat, also while the agent works on a canvas it opened in the board. */
export const rowCanvas = (workspace: Workspace): Workspace => (get().ui.workspace === 'chat' ? 'chat' : workspace);
/** Where a turn resumed from a row works: a chat row, the workspace the user is in (Studio is the chat canvas). */
export const turnCanvas = (workspace: Workspace): Workspace => (workspace === 'chat' ? agentCanvas() : get().ui.workspace === 'chat' ? 'chat' : workspace);

export function feedBase(workspace: Workspace) {
  return { id: uid('fd'), createdAt: Date.now(), workspace: rowCanvas(workspace) };
}

/** The chat each agent's current conversation comes from (set when a message is sent from a chat node): one per agent, so two agents of a session never share it. */
const turnChats = new Map<string, string>();
export const setTurnChat = (sessionId: string, chatNodeId: string | undefined, owner: string) => { const k = turnKey(sessionId, owner); if (chatNodeId) turnChats.set(k, chatNodeId); else turnChats.delete(k); };

function lastChatOfAgent(sessionId: string, agentNodeId: string | undefined): string | undefined {
  if (!agentNodeId) return undefined;
  const feed = get().sessions[sessionId]?.feed ?? [];
  for (let i = feed.length - 1; i >= 0; i--) {
    const m = (feed[i] as { meta?: { agentNodeId?: string; chatNodeId?: string } }).meta;
    if (m?.agentNodeId === agentNodeId && m.chatNodeId) return m.chatNodeId;
  }
  return undefined;
}

/** The metadata of a row. `owner` is the agent it is written for (explicit: pass `undefined` only for a row no agent owns). */
export function messageMeta(workspace: Workspace, extra: Partial<ChatMessageMeta>, sessionId: string, owner: string): ChatMessageMeta {
  const sender = extra.agentNodeId ?? owner;
  // After a reload the map is empty: the chat is the one this agent's own last row was written in.
  const chat = turnChats.get(turnKey(sessionId, sender)) ?? lastChatOfAgent(sessionId, sender) ?? chatNodeOf(sessionId);
  const e = agentEngine(sessionId, sender);
  const meta: ChatMessageMeta = {
    timeZone: localTimeZone(),
    agent: e.kind === 'offline' ? 'Local planner' : 'Director',
    // The sender's id stays on its rows even when its node is gone, so they do not pass for the first agent's.
    ...(sender !== MAIN_THREAD ? { agentNodeId: sender } : {}),
    ...(chat ? { chatNodeId: chat } : {}),
    space: placeFor(get().ui, workspace),
    provider: e.kind === 'offline' ? 'offline' : e.provider,
    model: e.kind === 'offline' ? 'Local planner' : e.model,
    ...extra,
  };
  if ('agent' in extra && extra.agent === undefined) delete meta.agent;
  return meta;
}

export function notice(
  sessionId: string,
  workspace: Workspace,
  text: string,
  level: 'info' | 'error' = 'error',
  retry?: NoticeFeedItem['retry'],
  meta?: Partial<ChatMessageMeta>,
): void {
  const itemMeta: ChatMessageMeta = {
    timeZone: localTimeZone(),
    space: placeFor(get().ui, workspace),
    ...meta,
  };
  appendFeed(sessionId, { ...feedBase(workspace), type: 'notice', level, text, ...(retry ? { retry } : {}), meta: itemMeta });
  // Errors also show above the prompt box, where they are seen.
  if (level === 'error') pushAlert({ level: 'error', text });
  if (level === 'error' && get().ui.workspace !== 'chat') setThreadOpen(true);
}

export function setThreadOpen(open: boolean): void {
  useStore.setState((st) => ({ ui: { ...st.ui, threadOpen: open } }));
}

/** The session's agent node (the first one: attachModelToNode and the chat use the same). */
export function agentNodeOf(sessionId: string = get().activeSessionId, nodeId?: string) {
  const agents = get().sessions[sessionId]?.graph.nodes.filter((n) => n.data.kind === 'ref' && n.data.type === 'agent') ?? [];
  return nodeId ? agents.find((n) => n.id === nodeId) : agents[0];
}

/** The chat node that owns a message with no `chatNodeId` of its own: the session's first chat node. */
export function chatNodeOf(sessionId: string = get().activeSessionId): string | undefined {
  return get().sessions[sessionId]?.graph.nodes.find((n) => n.data.kind === 'ref' && n.data.type === 'chat')?.id;
}

/** The agent nodes connected to a chat node by a control link (either direction). Several can share one chat. */
export function chatAgents(sessionId: string = get().activeSessionId, chatNodeId: string | undefined = chatNodeOf(sessionId)): string[] {
  const g = get().sessions[sessionId]?.graph;
  if (!g || !chatNodeId) return [];
  const ids = g.edges.filter((e) => (e.kind ?? 'data') === 'control').flatMap((e) => (e.source === chatNodeId ? [e.target] : e.target === chatNodeId ? [e.source] : []));
  return [...new Set(ids)].filter((id) => g.nodes.some((n) => n.id === id && n.data.kind === 'ref' && n.data.type === 'agent'));
}

/** The feed a chat node owns. Messages written before chats owned their feed carry no `chatNodeId` and belong to the first chat: nothing is moved or lost. */
export const feedOfChat = (sessionId: string, chatNodeId: string) => feedOfChatIn(get().sessions[sessionId], chatNodeId);

/** The feed one agent owns: what carries its id, plus what predates agent ids (the first agent's). */
export const feedOfAgent = (sessionId: string, owner: string) => feedOfAgentIn(get().sessions[sessionId], owner);

/** The provider and model of the agent a turn is for: the node's own choice, else the global one. */
export function agentChoice(sessionId: string = get().activeSessionId, agentNodeId?: string): { provider: LlmProviderId | 'offline'; model: string } {
  const own = agentNodeOf(sessionId, resolveOwner(sessionId, agentNodeId))?.data;
  const chosen = own?.kind === 'ref' ? own.llm : undefined;
  return chosen ? { provider: chosen.provider as LlmProviderId | 'offline', model: chosen.model } : get().settings.agent;
}

export function agentEngine(sessionId: string = get().activeSessionId, agentNodeId?: string): { kind: 'llm'; provider: 'openrouter' | 'nanogpt' | 'atlas'; model: string; key: string } | { kind: 'offline' } {
  const { keys } = get().settings;
  const agent = agentChoice(sessionId, agentNodeId);
  if (agent.provider === 'offline') return { kind: 'offline' };
  const key = keys[agent.provider]?.trim();
  if (!key || !agent.model) return { kind: 'offline' };
  return { kind: 'llm', provider: agent.provider, model: agent.model, key };
}

export function engineLabel(sessionId: string, owner: string): string {
  const e = agentEngine(sessionId, owner);
  return e.kind === 'offline' ? 'Local planner' : `${e.model.replace(/^[^/]+\//, '')} · ${LLM_LABELS[e.provider]}`;
}

/** Document size for a new design, from the composer's image aspect. */
export function designerDims(): { width: number; height: number } {
  const r = ratioOf(get().composer.image.settings.aspect) ?? 1;
  return r >= 1 ? { width: Math.round(1080 * r), height: 1080 } : { width: 1080, height: Math.round(1080 / r) };
}

/** The user's own words, marked off from what the app adds (context, guides, notes), with the canvas they wrote on. */
export function userBlock(text: string, canvas: Workspace): string {
  return `<user_message canvas="${canvas}">\n${text}\n</user_message>`;
}

/**
 * One conversation per session; restore an older parked canvas only when history is empty and the agent idle.
 */
export function toCanvas(sessionId: string, workspace: Workspace, owner: string): void {
  const a = session(sessionId) ? agentOf(sessionId, owner) : undefined;
  if (!a || a.busy || a.canvas === workspace) return;
  const there = a.parked?.[workspace];
  if (there && !a.history.length) {
    patchAgent(sessionId, { ...there, pending: there.pending, draft: there.draft, revising: there.revising, canvas: workspace, parked: { ...a.parked, [workspace]: undefined } }, owner);
    return;
  }
  patchAgent(sessionId, { canvas: workspace }, owner);
}

/** The conversation of the canvas a feed item belongs to. */
export function toCanvasOfItem(sessionId: string, itemId: string): void {
  const item = session(sessionId)?.feed.find((f) => f.id === itemId);
  if (item) toCanvas(sessionId, turnCanvas(item.workspace), resolveOwner(sessionId, (item as { meta?: { agentNodeId?: string } }).meta?.agentNodeId));
}

/** What the user wrote in this session (messages and answers): a model named there is the user's choice. */
function userWords(sessionId: string, owner: string): string {
  const draft = agentOf(sessionId, owner).draft;
  const said = feedOfAgent(sessionId, owner).flatMap((f) => (f.type === 'user' ? [f.text ?? ''] : f.type === 'questions' && f.answers ? Object.values(f.answers) : []));
  return [...said, draft?.request ?? '', ...Object.values(draft?.answers ?? {})].join('\n');
}

/** The variant a step's input route needs: with an image it is the catalog's one rule (sentModelRef), the same the send applies. */
export function routeModel(ref: string, route: import('../variants').VariantRoute): string | undefined {
  return route === 'edit' || route === 'image' || route === 'reference' ? sentModelRef(ref, route === 'edit' ? 'image' : 'video', true, route === 'reference' ? 'reference' : undefined) : lineRoutes(ref)[route];
}

function planContext(sessionId: string, workspace: Workspace, strict: boolean, owner: string) {
  const doc = workspace === 'designer' ? activeDoc(sessionId) : null;
  return {
    workspace,
    getModel: watchModel(sessionId, owner, resolveModel),
    variantModel: routeModel,
    defaultModel: (kind: MediaKind, needsImage: boolean) => {
      const ref = (kind === 'image' || kind === 'video') && agentOf(sessionId, owner).settings?.[kind]?.modelRef;
      return ref ? (needsImage ? sentModelRef(ref, kind, true) : lineRoutes(ref).text ?? ref) : defaultModelFor(kind, needsImage);
    },
    defaultIsFallback: (kind: MediaKind, needsImage: boolean) => defaultModelChoice(kind, needsImage).source === 'fallback',
    defaultSettings: (kind: MediaKind) => get().composer[kind].settings,
    asset: (id: string) => get().assets[id],
    layer: (id: string) => doc?.layers.find((l) => l.id === id),
    suggestModel,
    // Direct keeps session model precedence.
    composerChosen: (kind: MediaKind) => get().composer.agentStyle === 'direct' || Boolean((kind === 'image' || kind === 'video') && agentOf(sessionId, owner).settings?.[kind]) || composerChosen(kind),
    routeModel: (mode: 'text' | 'image' | 'reference') => get().composer.videoRoutes?.[mode],
    librarySubjects:()=>get().library,
    strictContinuity:strict,
    userText: () => userWords(sessionId, owner),
    // This request only (an old "un ángulo diferente" must not fit a new one), user words only; the agent's reply is in offerText.
    requestText: () => userRequest(agentOf(sessionId, owner)),
    offerText: () => offerRequest(agentOf(sessionId, owner)),
    // Angles already made from this source image, by finished angle operations on it.
    usedAngles: (assetId: string) => Object.values(get().generations)
      .filter((g) => g.status === 'done' && g.op?.id === 'angle' && g.op.sourceAssetId === assetId)
      .map((g) => String(g.op?.params.angle ?? ''))
      .filter(Boolean),
    requestImages: () => (agentOf(sessionId, owner).draft?.attachments ?? []).filter((id) => get().assets[id]?.kind === 'image'),
    direct: () => get().composer.agentStyle === 'direct',
    canAsk: () => agentOf(sessionId, owner).questionRound < roundsFor(get().composer.agentStyle, get().settings.guidedRounds),
    answered: () => Object.keys(agentOf(sessionId, owner).draft?.answers ?? {}).length > 0,
    opModel: () => (workspace === 'node' ? undefined : get().composer.agentStyle === 'direct' ? get().composer.image.modelRef : agentOf(sessionId, owner).settings?.image?.modelRef),
    // Direct inherits the session model without forcing the other settings.
    confirmed: (kind: MediaKind) => (workspace !== 'node' && get().composer.agentStyle !== 'direct' && (kind === 'video' || kind === 'image') ? agentOf(sessionId, owner).settings?.[kind] : undefined),
    switchedTo: (kind: MediaKind) => (workspace !== 'node' && get().composer.agentStyle === 'auto' && (kind === 'video' || kind === 'image') ? agentOf(sessionId, owner).switchedTo?.[kind] : undefined),
    confirmedParts: (kind: MediaKind) => (workspace !== 'node' && get().composer.agentStyle !== 'direct' ? (laneState(sessionId, owner)?.settingsParts ?? []).filter((p) => p.kind === kind) : []),
  };
}

// ---------------------------------------------------------------------------
// Entry points

/** A reply to a waiting card is part of the request: what the app reads for a model or provider the user named (userRequest) includes it. */
export function addReplyToRequest(sessionId: string, text: string, attachments: string[], owner: string): void {
  const draft = agentOf(sessionId, owner).draft;
  patchAgent(sessionId, { draft: { request: `${draft?.request ?? ''} ${text}`.trim(), answers: draft?.answers ?? {}, attachments: [...(draft?.attachments ?? []), ...attachments.filter((id) => !draft?.attachments?.includes(id))] } }, owner);
}

/** Send a message from the composer in agent mode. */
export function showQuestions(
  sessionId: string,
  workspace: Workspace,
  intro: string | undefined,
  questions: AgentQuestion[],
  toolCallId: string | null,
  owner: string,
  meta?: ChatMessageMeta,
): void {
  const round = (laneState(sessionId, owner)?.questionRound ?? 0) + 1;
  const item: QuestionsFeedItem = {
    ...feedBase(workspace),
    type: 'questions',
    intro,
    questions,
    round,
    maxRounds: roundsFor(get().composer.agentStyle, get().settings.guidedRounds),
    status: 'pending',
    ...(toolCallId ? { toolCallId } : {}),
    meta: meta ?? messageMeta(workspace, {}, sessionId, owner),
  };
  appendFeed(sessionId, item);
  recordJourneyEvent({ journeyId: journeyIdFor(sessionId) ?? sessionId, journey: 'settings-response', event: 'questions.presented', reason: 'agent asked for user information', sessionId, approvalId: item.id, after: { questionIds: questions.map((q) => q.id), round, maxRounds: item.maxRounds } });
  patchAgent(sessionId, { questionRound: round, pending: { toolCallId, kind: 'questions', feedItemId: item.id } }, owner);
  if (get().ui.workspace !== 'chat') setThreadOpen(true);
}

/** Validate a raw plan and show it. Auto mode runs free plans immediately. */
export async function presentPlan(
  sessionId: string,
  workspace: Workspace,
  raw: RawPlan,
  toolCallId: string | null,
  owner: string,
  revision = false,
  /** Agent time so far, for the request's metrics (LLM turns only). */
  agentMs?: number,
  /** The turn's signal: a plan checked after Stop is dropped */
  signal?: AbortSignal,
  meta?: ChatMessageMeta,
): Promise<{ errors: string[]; itemId?: string; settingsNeeded?: string }> {
  const started = Date.now();
  const planId = uid('pln');
  const carried = revision ? carryOverRevision(raw, { feed: session(sessionId).feed, revising: agentOf(sessionId, owner).revising }) : [];
  const { plan, errors } = await normalizePlan(raw, planContext(sessionId, workspace, !!toolCallId, owner), planId);
  if (plan && carried.length) plan.agentNotes = carried;
  if (signal?.aborted) return { errors: [] };
  const journey = revision ? 'plan-revision' : 'settings-correction';
  recordJourneyEvent({ journeyId: journeyIdFor(sessionId) ?? sessionId, journey, event: plan ? 'plan.normalized' : 'plan.rejected', reason: plan ? 'normalizer accepted resolved steps' : 'normalizer rejected plan', sessionId, planId, before: (raw.steps ?? []).map((step) => ({ stepId: step.id, kind: step.kind, model: step.model, references: step.refs, firstFrame: step.first_frame, lastFrame: step.last_frame })), after: plan ? plan.steps.map((step) => ({ stepId: step.id, kind: step.kind, modelRef: 'modelRef' in step ? step.modelRef : undefined, inputs: stepInfo(step).traceInputs(), settings: 'settings' in step ? step.settings : undefined, adjustments: plan.adjustments.filter((a) => a.startsWith(`${step.id}:`)) })) : { errors } });
  if (!plan) return { errors };
  const { total } = estimateSteps(plan.steps);
  // Automation policy (§11) on the normalized plan: cost and candidates are known only here.
  // Nothing is shown before this check: a plan that needs the settings card is not presented.
  const settingKinds = plan.steps.filter(isVisualStep).map((st) => st.kind);
  // Direct mode decides nothing before the plan card: the composer picks the models, the card approves the cost.
  if (workspace !== 'node' && settingKinds.length && get().composer.agentStyle !== 'direct') {
    const action = needsConfirmation({
      workspace,
      kinds: settingKinds,
      settings: laneState(sessionId, owner)?.settings,
      style: get().composer.agentStyle,
      userChoseModel: (raw.steps ?? []).some((s) => Boolean(s.model)),
      estimatedCost: total.usd,
      hasMultipleCandidates: plan.steps.some((st) => 'settings' in st && (st.settings.count ?? 1) > 1),
    });
    // The card just confirmed in this request already covers the cost: asking again looped (4 cards for one video).
    const confirmedNow = settingKinds.every((k) => (laneState(sessionId, owner)?.settingsParts ?? []).some((p) => p.kind === k));
    if (action === 'ask' && !confirmedNow) return { errors: [], settingsNeeded: costAskMessage([...new Set(settingKinds)], total.usd) };
  }
  const style = get().composer.agentStyle;
  // A Nodes plan is prepared (drafted nodes, reviewed price, signature) before its card exists: a card with no approval to carry is never shown, so it cannot be approved in the gap.
  let nodeRun: PlanFeedItem['nodeRun'];
  let prepared: Awaited<ReturnType<typeof prepareNodeRun>> | undefined;
  if (workspace === 'node') {
    materializeNodes(sessionId, plan);
    const targets = plan.steps.filter(s => !isStepKind(s, 'text')).map(s => `${plan.id}_${s.id}`);
    prepared = await prepareNodeRun(sessionId, targets);
    nodeRun = { targets, force: true, signature: prepared.signature, runIds: prepared.runIds };
  }
  const item: PlanFeedItem = {
    ...feedBase(workspace),
    type: 'plan',
    plan,
    style,
    comparisonKinds: VISUAL_MEDIA_KINDS.filter((k) => new Set(plan.steps.flatMap((s) => s.kind === k && 'modelRef' in s ? [lineRoutes(s.modelRef).text ?? s.modelRef] : [])).size > 1),
    status: 'awaiting',
    stepStates: Object.fromEntries(plan.steps.map((st) => [st.id, 'pending' as StepState])),
    stepGenerations: {},
    estimate: total,
    meta: meta ?? messageMeta(workspace, {}, sessionId, owner),
    ...(prepared ? { nodeRun, plan: { ...plan, steps: prepared.steps }, estimate: prepared.estimate, error: prepared.errors.join(' ') || undefined } : {}),
  };
  const replaced = closeRevisedPlan(sessionId, revision, owner);
  if (replaced) item.revised = true;
  appendFeed(sessionId, item);
  for (const a of plan.adjustments.filter((x) => /\byour [\w-]+ model\b/.test(x))) toast(a.replace(/^[\w-]+: /, ''), 'error', 5000);
  patchAgent(sessionId, { pending: { toolCallId, kind: 'plan', feedItemId: item.id } }, owner);
  // Recorded before auto-approval closes the request.
  if (agentMs != null) {
    const models = [...new Set(plan.steps.flatMap((st) => ('modelRef' in st && st.modelRef ? [st.modelRef] : [])))];
    recordMetric(sessionId, { type: 'plan', ms: agentMs, revision: replaced, models, usd: total.usd, checkMs: Date.now() - started });
  }
  if (autoApproves(style, total, prepared?.estimate)) {
    void approvePlan(sessionId, item.id);
  } else if (get().ui.workspace !== 'chat') {
    setThreadOpen(true);
  }
  return { errors: [], itemId: item.id };
}

/** Auto style approves a plan by itself only when it costs nothing. A Nodes plan's price is the prepared one (it adds the upstream nodes it must update), not the sum of its own steps. */
export function autoApproves(style: string, planTotal: Estimate, preparedTotal?: Estimate): boolean {
  return style === 'auto' && !needsSpendCheck(preparedTotal ?? planTotal);
}

/**
 * The plan the user commented on: a revision replaces it (removed from the feed, the new card says "Revised");
 * any other outcome closes it as canceled, so two plans never mix. Returns whether it was replaced.
 */
export function keepCommentedPlan(sessionId: string, owner: string): void {
  const id = agentOf(sessionId, owner).revising;
  if (!id) return;
  const plan = session(sessionId).feed.find((f) => f.id === id);
  patchAgent(sessionId, (a) => ({ revising: undefined, ...(plan?.type === 'plan' && plan.status === 'awaiting' && !a.pending ? { pending: { toolCallId: null, kind: 'plan', feedItemId: id } } : {}) }), owner);
}

export function closeRevisedPlan(sessionId: string, replace: boolean, owner: string): boolean {
  const id = agentOf(sessionId, owner).revising;
  if (!id) return false;
  patchAgent(sessionId, { revising: undefined }, owner);
  const old = session(sessionId).feed.find((f) => f.id === id);
  if (old?.type !== 'plan' || old.status !== 'awaiting') return false;
  removeDraftNodes(sessionId, old.plan.id);
  if (replace) patchSession(sessionId, (s) => ({ ...s, feed: s.feed.filter((f) => f.id !== id) }));
  else updateFeedItem<PlanFeedItem>(sessionId, id, { status: 'canceled' });
  return replace;
}

function materializeNodes(sessionId: string, plan: Plan): void {
  const graph = session(sessionId).graph;
  const st = get();
  const { nodes, edges } = planToGraph(plan, (id) => st.assets[id]?.kind, (id) => graph.nodes.find(n => nodeOutputAsset(n, st.generations) === id)?.id);
  const bounds = graphBounds(graph.nodes);
  const origin = bounds ? { x: bounds.x + bounds.w + 160, y: bounds.y } : { x: 0, y: 0 };
  const positions = autoLayout(nodes, edges, origin);
  editCompound(sessionId, 'plan-nodes', (g) => ({
    ...g,
    nodes: [...g.nodes, ...nodes.map((n) => ({ ...n, position: positions.get(n.id) ?? n.position }))],
    edges: [...g.edges, ...edges],
  }));
  // Bring the new nodes into view, with what they connect to.
  focusNodes(sessionId, [...new Set([...nodes.map((n) => n.id), ...edges.map((e) => e.source)])]);
}

// ---------------------------------------------------------------------------
// The user's own messages: edit (the answer is made again) and delete (it leaves the agent's context)

export function llmCallUsd(provider: LlmProviderId, model: string, usage: ChatResult['usage']): number {
  if (!usage) return 0;
  if (usage.costUsd != null) return usage.costUsd;
  const m = get().catalog.llm[provider]?.find((x) => x.id === model);
  return ((m?.inputPrice ?? 0) * usage.inputTokens + (m?.outputPrice ?? 0) * usage.outputTokens) / 1_000_000;
}
