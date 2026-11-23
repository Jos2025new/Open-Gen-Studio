// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const idb = vi.hoisted(() => ({
  lastRaw: undefined as string | undefined,
  onStateSet: null as ((raw: string) => void) | null,
}));

vi.mock('../src/lib/idb', () => ({
  stateDb: {
    get: async () => idb.lastRaw,
    set: async (_name: string, val: string | { text?: () => string }) => {
      const raw = typeof val === 'string' ? val : val?.text?.();
      idb.lastRaw = raw;
      if (raw) idb.onStateSet?.(raw);
      return { ok: true };
    },
    del: async () => undefined,
  },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  getAssetBlob: async () => new (globalThis as unknown as { window: { Blob: typeof Blob } }).window.Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
  putAssetBlob: async () => undefined,
  deleteAssetBlobs: async () => undefined,
}));
vi.mock('../src/lib/media', async (orig) => ({
  ...(await orig<typeof import('../src/lib/media')>()),
  probeMedia: async () => ({ width: 64, height: 64, size: 3 }),
  blobToDataUrl: async () => 'data:image/png;base64,cG5n',
  prepareImageForUpload: async (blob: Blob) => blob,
  jpegThumbnail: async () => undefined,
}));

import '../src/engine/commands';
import * as httpMod from '../src/lib/http';
import { useStore, createSession } from '../src/store/store';
import { askAgain, budgetVerdict, remainingBudget } from '../src/engine/budget';
import { useAlerts } from '../src/engine/alerts';
import { forgetBalances } from '../src/engine/credit';
import { llmTurn, settleInterruptedPlans } from '../src/engine/agent/runtime';
import { decideCommandApproval, runCommandsTool } from '../src/engine/agent/commandCalls';
import { rewritePrompts } from '../src/engine/agent/planSettings';
import { command, setApprover } from '../src/engine/commands';
import { resetActions } from '../src/engine/nodecore/action';
import { disconnectEdges, patchNodeData, previewRun, runNodes } from '../src/engine/flow/actions';
import { ADAPTERS } from '../src/engine/providers/registry';
import { createGeneration, recheckGeneration, resumeInterrupted, retryGeneration, runGeneration } from '../src/engine/jobs';
import type { CommandApprovalFeedItem, Graph, ModelSchema, ModelSummary, PlanFeedItem, PlanStep } from '../src/engine/types';
import { mainThread } from './helpers/threads';
import { createFakeProvider, pngBlob, simulateReload, snapshotStore, sseResponse, type FakeProvider } from './helpers/fakeProvider';

const IMG_REF = 'nanogpt::paid-img';
const T2I_REF = 'nanogpt::nano-banana';
const EDIT_REF = 'nanogpt::nano-banana-edit';
const AUDIO_REF = 'nanogpt::paid-song';
const ATLAS_REF = 'atlas::paid-img';
const ATLAS_LOWER_REF = 'atlas::paid-video';
const LLM_MODEL = 'paid-llm';

const AUDIO_SCHEMA: ModelSchema = {
  ref: AUDIO_REF,
  params: [{ key: 'lyrics', label: 'Lyrics', role: 'other', type: 'text', multiline: true }],
  slots: { prompt: 'prompt', promptRequired: true },
  source: 'catalog',
};

const IMG_SCHEMA: ModelSchema = {
  ref: IMG_REF,
  params: [],
  slots: { prompt: 'prompt', promptRequired: true, images: { key: 'image_urls', min: 0, max: 4, multiple: true, format: 'data-url' } },
  source: 'catalog',
};

const ATLAS_SCHEMA: ModelSchema = {
  ref: ATLAS_REF,
  params: [],
  slots: { prompt: 'prompt', promptRequired: true },
  source: 'catalog',
};

let sid = '';
let fake: FakeProvider;

const imgNode = (id: string, x: number, prompt: string, extra: Record<string, unknown> = {}) => ({
  id, position: { x, y: 0 },
  data: { kind: 'image', title: `Image ${prompt}`, prompt, modelRef: IMG_REF, settings: { count: 1, advanced: {} }, outputIndex: 0, ...extra },
});

const twoImageGraph = (connected = false): Graph => ({
  nodes: [imgNode('n1', 0, 'alpha mug'), imgNode('n2', 300, 'beta mug')] as never,
  edges: connected ? [{ id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'out', targetHandle: 'ref' } as never] : [],
});

const fanOutGraph = (): Graph => ({
  nodes: [imgNode('n1', 0, 'alpha mug'), imgNode('n2', 300, 'beta mug'), imgNode('n3', 300, 'gamma mug')] as never,
  edges: [
    { id: 'e12', source: 'n1', target: 'n2', sourceHandle: 'out', targetHandle: 'ref' } as never,
    { id: 'e13', source: 'n1', target: 'n3', sourceHandle: 'out', targetHandle: 'ref' } as never,
  ],
});

const nodeDataOf = (id: string) =>
  useStore.getState().sessions[sid].graph.nodes.find((n) => n.id === id)!.data as { generationId?: string; title: string };

const cardOf = (id: string) =>
  useStore.getState().sessions[sid].feed.find((x) => x.id === id) as CommandApprovalFeedItem;

async function waitForAwaiting(): Promise<CommandApprovalFeedItem> {
  await vi.waitFor(() => {
    expect(useStore.getState().sessions[sid].feed.some((f) => f.type === 'commands' && f.status === 'awaiting')).toBe(true);
  });
  return useStore.getState().sessions[sid].feed.find((f): f is CommandApprovalFeedItem => f.type === 'commands')!;
}

function putRewritePlan(id: string): void {
  const step: PlanStep = { id: 's1', kind: 'image', title: 'Shot', prompt: 'a bike', modelRef: IMG_REF, settings: { count: 1, advanced: {} }, refs: [] } as never;
  const planItem: PlanFeedItem = {
    id, type: 'plan', style: 'auto', status: 'awaiting', workspace: 'chat',
    plan: { id: `p_${id}`, title: 'R', summary: '', workspace: 'chat', style: '', steps: [step], subjects: [], adjustments: [] },
    stepStates: {}, stepGenerations: {}, estimate: { usd: 0.1, approximate: false }, createdAt: 1,
  } as never;
  useStore.setState((s) => ({ sessions: { ...s.sessions, [sid]: { ...s.sessions[sid], feed: [planItem] } } }));
}

function setupSession(opts: {
  spentUsd?: number; budgetUsd?: number; budgetOn?: boolean; graph?: Graph;
  autoSwitch?: 'ask' | 'always' | 'never'; llmCatalog?: Array<Record<string, unknown>>; effort?: 'none' | 'low' | 'medium' | 'high';
} = {}): void {
  const st = useStore.getState();
  const fresh = createSession('D+ Matrix');
  sid = fresh.id;
  const imgModel = (ref: string, provider: 'nanogpt' | 'atlas', id: string, name: string, usd: number, acceptsImage: boolean): ModelSummary =>
    ({ ref, provider, id, name, kind: 'image', acceptsText: true, acceptsImage, tags: [], price: { skus: [{ unit: 'output', usd }] } }) as unknown as ModelSummary;
  const audioModel = {
    ref: AUDIO_REF, provider: 'nanogpt', id: 'paid-song', name: 'Paid Song', kind: 'audio', textOutput: true, acceptsText: true, acceptsImage: false, tags: [], price: { skus: [{ unit: 'output', usd: 0.1 }] },
  } as unknown as ModelSummary;
  const atlasLowerModel = {
    ref: ATLAS_LOWER_REF, provider: 'atlas', id: 'paid-video', name: 'Paid Video', kind: 'video', acceptsText: true, acceptsImage: false, tags: [],
    price: { skus: [{ unit: 'second', usd: 0.02 }], approximate: true, lowerBound: true, note: 'Atlas base price per second' },
  } as unknown as ModelSummary;

  const llmList = opts.llmCatalog ?? [{ id: LLM_MODEL, name: 'Paid LLM', inputPrice: 5, outputPrice: 15, tools: true, vision: false }];
  useStore.setState({
    activeSessionId: sid, generations: {}, quotes: {}, spendLog: [], spentUsd: opts.spentUsd ?? 0,
    assets: { ast_base: { id: 'ast_base', sessionId: sid, kind: 'image', name: 'base.png', mime: 'image/png', width: 64, height: 64, size: 3, createdAt: Date.now(), origin: 'upload' } as never },
    sessions: {
      [sid]: {
        ...fresh, graph: opts.graph ?? twoImageGraph(false), feed: [], noAskOverLimit: false,
        agents: mainThread({ history: [{ role: 'user', content: 'Help me.' }], questionRound: 0, notes: [], busy: false }),
      },
    },
    catalog: {
      ...st.catalog,
      models: {
        ...st.catalog.models,
        [IMG_REF]: imgModel(IMG_REF, 'nanogpt', 'paid-img', 'Seed Model', 0.1, true),
        [T2I_REF]: imgModel(T2I_REF, 'nanogpt', 'nano-banana', 'Nano Banana', 0.1, false),
        [EDIT_REF]: imgModel(EDIT_REF, 'nanogpt', 'nano-banana-edit', 'Nano Banana Edit', 0.1, true),
        [AUDIO_REF]: audioModel,
        [ATLAS_REF]: imgModel(ATLAS_REF, 'atlas', 'paid-img', 'Seed Model', 0.1, true),
        [ATLAS_LOWER_REF]: atlasLowerModel,
      },
      schemas: {
        ...st.catalog.schemas,
        [IMG_REF]: IMG_SCHEMA,
        [T2I_REF]: { ...IMG_SCHEMA, ref: T2I_REF },
        [EDIT_REF]: { ...IMG_SCHEMA, ref: EDIT_REF },
        [AUDIO_REF]: AUDIO_SCHEMA,
        [ATLAS_REF]: ATLAS_SCHEMA,
        [ATLAS_LOWER_REF]: { ...ATLAS_SCHEMA, ref: ATLAS_LOWER_REF },
      },
      llm: { ...st.catalog.llm, nanogpt: llmList as never },
      llmStatus: { openrouter: 'idle', nanogpt: 'ready', atlas: 'idle' },
    },
    settings: {
      ...st.settings,
      keys: { ...st.settings.keys, nanogpt: 'test-nano-key', atlas: 'test-atlas-key' },
      agent: { ...st.settings.agent, provider: 'nanogpt', model: LLM_MODEL, effort: opts.effort ?? 'none' },
      ops: { ...st.settings.ops, edit: IMG_REF },
      budgetOn: opts.budgetOn ?? true, budgetUsd: opts.budgetUsd ?? 1.0, budgetAccepted: null, budgetNoAsk: false,
      autoSwitchProvider: opts.autoSwitch ?? 'ask',
    },
  });
  askAgain(sid);
}

beforeEach(() => {
  idb.lastRaw = undefined;
  idb.onStateSet = null;
  setApprover(null);
  resetActions();
  forgetBalances();
  useAlerts.setState({ alerts: [] });
  fake = createFakeProvider({ defaultImageCost: 0.1, defaultLlmCost: 0.01 });
  fake.install();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useAlerts.setState({ alerts: [] });
  resetActions();
});

describe('Escenario (a): recargas p9/p9c', () => {
  // reproduce: commandCalls.ts:70 guarda pending solo en RAM y flow/actions.ts:345 solo enlaza generationId al terminar; tras recargar n1->n2 en vuelo no reanuda con un clic y runNodes(n2) reenvia n1
  it.fails('a1: n1->n2 con recarga en vuelo y doble aprobacion no reenvia n1', async () => {
    setupSession({ graph: twoImageGraph(true) });
    const held = fake.holdNext('alpha mug');
    const oldRun = runCommandsTool(sid, {
      seq: [
        { cmd: 'nodes.run.start', args: { targets: ['n1'], force: true } },
        { cmd: 'nodes.run.start', args: { targets: ['n2'], force: true } },
      ],
    });
    const card = await waitForAwaiting();
    expect(decideCommandApproval(sid, card.id, 'approve')).toBe(true);
    await held.arrived;
    expect(fake.acceptedCount('alpha mug')).toBe(1);

    const saved = snapshotStore();
    held.cutAfterAccept();
    await oldRun.catch(() => undefined);
    simulateReload(null, { sessionId: sid, state: saved });
    await resumeInterrupted();
    settleInterruptedPlans();

    const firstClick = decideCommandApproval(sid, card.id, 'approve');
    const secondClick = decideCommandApproval(sid, card.id, 'approve');
    expect(firstClick).toBe(true);
    expect(secondClick).toBe(false);
    await runNodes(sid, ['n2']);
    expect(fake.acceptedCount('alpha mug')).toBe(1);
  });

  // fixed by task/urgente-dinero (991769f8): jobs.ts:433-438 (allDelivered) termina g1 sin enlazar n1.data.generationId; correr n2 recompila el grafo y vuelve a cobrar n1
  it('a2: allDelivered tras recargar enlaza n1 y correr n2 no reenvia n1', async () => {
    setupSession({ graph: twoImageGraph(true) });
    let savedAtDelivered: string | undefined;
    idb.onStateSet = (raw) => {
      if (savedAtDelivered) return;
      const gens = Object.values((JSON.parse(raw) as { state?: { generations?: Record<string, { status: string; assetIds: string[]; sending?: unknown; remoteJob?: unknown }> } }).state?.generations ?? {});
      if (gens.some((g) => g.status === 'running' && g.assetIds.length > 0 && !g.sending && !g.remoteJob)) savedAtDelivered = raw;
    };
    await runNodes(sid, ['n1']);
    expect(fake.acceptedCount('alpha mug')).toBe(1);
    expect(savedAtDelivered).toBeTruthy();

    const parsed = JSON.parse(savedAtDelivered!) as { state: unknown };
    simulateReload(null, { sessionId: sid, state: parsed.state });
    await resumeInterrupted();
    const gens = Object.values(useStore.getState().generations);
    expect(gens).toHaveLength(1);
    expect(gens[0].status).toBe('done');

    await runNodes(sid, ['n2']);
    expect(nodeDataOf('n1').generationId).toBe(gens[0].id);
    expect(fake.acceptedCount('alpha mug')).toBe(1);
    expect(fake.acceptedCount('beta mug')).toBe(1);
  });

  // fixed in D+ 2b-2: flow/freshness.ts reconoce edit twin (sentModelRef) al evaluar nodeIsCurrent y linkCompletedNode congela nodeRequest
  it('a3: followRemote con modelo de edicion (edit twin) enlaza n1 y correr n2 no reenvia n1', async () => {
    setupSession({
      graph: {
        nodes: [
          { id: 'a0', position: { x: -300, y: 0 }, data: { kind: 'asset', title: 'Base', assetId: 'ast_base' } },
          imgNode('n1', 0, 'alpha mug', { modelRef: T2I_REF }),
          imgNode('n2', 300, 'beta mug'),
        ] as never,
        edges: [
          { id: 'e0', source: 'a0', target: 'n1', sourceHandle: 'out', targetHandle: 'ref' } as never,
          { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'out', targetHandle: 'ref' } as never,
        ],
      },
    });
    const g1 = createGeneration({
      sessionId: sid, origin: 'node', stepId: 'n1', kind: 'image', prompt: 'alpha mug',
      modelRef: EDIT_REF, settings: { count: 1, advanced: {} }, inputs: { refs: ['ast_base'] },
    });
    useStore.setState((s) => ({
      generations: { ...s.generations, [g1.id]: { ...s.generations[g1.id], status: 'running', remoteJob: { provider: 'nanogpt', id: 'j_twin', meta: {} } } },
    }));

    vi.spyOn(ADAPTERS.nanogpt, 'resume').mockResolvedValueOnce({ outputs: [{ blob: pngBlob(), mime: 'image/png' }], costUsd: 0.1 });
    await recheckGeneration(g1.id);
    expect(useStore.getState().generations[g1.id].status).toBe('done');

    await runNodes(sid, ['n2']);
    expect(nodeDataOf('n1').generationId).toBe(g1.id);
    expect(fake.acceptedCount('alpha mug')).toBe(0);
    expect(fake.acceptedCount('beta mug')).toBe(1);
  });

  // reproduce: tras recargar con schemas vacios (mergePersistedState.ts:7-10), previewRun/freshness.ts:88 predice [n2] ($0.10) pero runNodes carga schema y graphToSteps reexpande n1 ($0.20)
  it.fails('a4: esquemas sin cargar tras recargar no provocan expansion oculta de ancestro n1 al ejecutar n2', async () => {
    setupSession({
      graph: {
        nodes: [
          { id: 't1', position: { x: -300, y: 0 }, data: { kind: 'text', title: 'Lyrics', text: 'new verse' } },
          { id: 'n1', position: { x: 0, y: 0 }, data: { kind: 'audio', title: 'Song 1', prompt: 'alpha song', modelRef: AUDIO_REF, textOutput: true, settings: { count: 1, advanced: {} }, outputIndex: 0 } },
          { id: 'n2', position: { x: 300, y: 0 }, data: { kind: 'audio', title: 'Song 2', prompt: 'beta song', modelRef: AUDIO_REF, textOutput: true, settings: { count: 1, advanced: {} }, outputIndex: 0 } },
        ] as never,
        edges: [
          { id: 'et1', source: 't1', target: 'n1', sourceHandle: 'out', targetHandle: 'lyrics' } as never,
          { id: 'e12', source: 'n1', target: 'n2', sourceHandle: 'out', targetHandle: 'lyrics' } as never,
        ],
      },
    });
    const g0 = createGeneration({
      sessionId: sid, origin: 'node', stepId: 'n1', kind: 'text', prompt: 'alpha song',
      modelRef: AUDIO_REF, settings: { count: 1, advanced: {} }, inputs: { refs: [] },
    });
    useStore.setState((s) => ({ generations: { ...s.generations, [g0.id]: { ...s.generations[g0.id], status: 'done', text: 'old song text' } } }));
    patchNodeData(sid, 'n1', { generationId: g0.id } as never);
    simulateReload(null, { sessionId: sid, state: snapshotStore(), clearSchemas: true });

    vi.spyOn(ADAPTERS.nanogpt, 'loadSchema').mockResolvedValue(AUDIO_SCHEMA);
    const audioPrompts: string[] = [];
    vi.spyOn(ADAPTERS.nanogpt, 'generate').mockImplementation(async (req) => {
      audioPrompts.push(req.prompt);
      return { outputs: [], text: `generated ${req.prompt}`, costUsd: 0.1 };
    });

    const shownPreview = previewRun(sid, ['n2']);
    await runNodes(sid, ['n2']);
    expect(shownPreview.runIds).toEqual(['n2']);
    expect(audioPrompts.filter((p) => p.includes('alpha song'))).toHaveLength(0);
  });

  // fixed by task/urgente-dinero (991769f8): tras salir n1 y recargar (corte post-aceptacion), desconectar e12 (n1->n2) y correr n3 recompila el grafo en flow/graph.ts:414 sin consultar envios previos de n1, reenviando n1 dos veces
  it('a5: arista desconectada entre recargar y aprobar no causa segundo cobro de n1 al ejecutar n3', async () => {
    setupSession({ graph: fanOutGraph() });
    const held = fake.holdNext('alpha mug');
    const first = runNodes(sid, ['n2']).catch(() => null);
    await held.arrived;
    expect(fake.acceptedCount('alpha mug')).toBe(1);

    const saved = snapshotStore();
    held.cutAfterAccept();
    await first;
    simulateReload(null, { sessionId: sid, state: saved });
    await resumeInterrupted();

    expect(disconnectEdges(sid, ['e12'])).toBeNull();
    await runNodes(sid, ['n3']);
    expect(fake.acceptedCount('alpha mug')).toBe(1);
  });

  // reproduce: commands/run.ts:134,371 omite pasos write de ApprovalRequest.steps y commandCalls.ts:70,164 no persiste la secuencia completa ni reanuda tras recargar; un paso write tras spend se pierde
  it.fails('a6: secuencia con paso write posterior al spend conserva el alcance congelado tras recargar', async () => {
    setupSession({ graph: twoImageGraph(false) });
    const oldRun = runCommandsTool(sid, {
      seq: [
        { cmd: 'nodes.run.start', args: { targets: ['n1'], force: true } },
        { cmd: 'nodes.node.rename', args: { node: 'n1', name: 'FinalHero' } },
      ],
    });
    const card = await waitForAwaiting();
    const saved = snapshotStore();
    decideCommandApproval(sid, card.id, 'cancel');
    await oldRun;

    simulateReload(null, { sessionId: sid, state: saved });
    settleInterruptedPlans();
    expect(decideCommandApproval(sid, card.id, 'approve')).toBe(true);
    await vi.waitFor(() => expect(cardOf(card.id).status).toBe('done'));
    expect(fake.acceptedCount('alpha mug')).toBe(1);
    expect(nodeDataOf('n1').title).toBe('FinalHero');
  });
});

describe('Escenario (b): Allow this time con subida de precio', () => {
  // fixed by task/urgente-dinero (991769f8): budget.ts:210-220 (beginOncePass) no tiene tope maxUsd y commandCalls.ts:99 emite un cheque en blanco; si count sube de 1 a 4 ($0.10 -> $0.40), Allow this time cobra $0.40 sin reconfirmar
  it('b1: Allow this time aprobado a $0.10 no puede cobrar $0.40 si count sube de 1 a 4 antes de ejecutar', async () => {
    setupSession({ spentUsd: 0, budgetUsd: 0.05, budgetOn: true, graph: twoImageGraph(false) });
    const running = runCommandsTool(sid, { seq: [{ cmd: 'nodes.run.start', args: { targets: ['n1'], force: true } }] });
    const card = await waitForAwaiting();
    expect(card.estimate.usd).toBeCloseTo(0.1, 6);

    patchNodeData(sid, 'n1', { settings: { count: 4, advanced: {} } } as never);
    expect(decideCommandApproval(sid, card.id, 'once')).toBe(true);
    await running;
    expect(useStore.getState().spentUsd).toBeLessThanOrEqual(0.1 + 1e-6);
  });

  // fixed by task/urgente-dinero (991769f8): nodecore/commands.ts:74 devuelve { usd: 0 } cuando snapshotById no encuentra la aprobacion en vez de precio desconocido (usd: null), burlando budgetVerdict como si fuera gratis
  it('b2: nodes.action.run sin snapshot devuelve precio desconocido (usd: null) y no $0', () => {
    setupSession({ spentUsd: 0, budgetUsd: 1.0, budgetOn: true });
    const est = command('nodes.action.run')!.estimate!({ on: { session: sid }, caller: 'agent' }, { approval: 'appr_missing' });
    expect(est.usd).toBeNull();
  });
});

describe('Escenario (c): Retry de un dudoso y lote parcial', () => {
  // fixed in D+ 2b-2: paidSend marca el envio uncertain reteniendo reservedUsd en tickets y remainingBudget descuenta la reserva
  it('c1: corte tras aceptar retiene reserva en remainingBudget e impide retry automatico sin confirmacion', async () => {
    setupSession({ spentUsd: 0, budgetUsd: 0.15, budgetOn: true });
    fake.onNext('uncertain shot', 'cut-after-accept');

    const g = createGeneration({
      sessionId: sid, origin: 'composer', kind: 'image', prompt: 'uncertain shot',
      modelRef: IMG_REF, settings: { count: 1, advanced: {} }, inputs: { refs: [] },
    });
    await expect(runGeneration(g.id)).rejects.toThrow();

    const after = useStore.getState().generations[g.id];
    expect(after.lostJob).toBe(true);
    expect(after.sends?.some((s) => s.status === 'uncertain')).toBe(true);
    expect(fake.acceptedCount('uncertain shot')).toBe(1);
    expect(remainingBudget()!).toBeLessThanOrEqual(0.05 + 1e-6);
  });

  // fixed in D+ 2b-2: el 2o POST uncertain retiene su reserva en tickets y holdRetry frena retryGeneration bajo el limite
  it('c2: lote parcial count=4 con corte post-aceptacion en 2o POST no cobra 5 envios ni rebasa el limite', async () => {
    setupSession({ spentUsd: 0, budgetUsd: 0.45, budgetOn: true });
    const g = createGeneration({
      sessionId: sid, origin: 'composer', kind: 'image', prompt: 'batch shot',
      modelRef: IMG_REF, settings: { count: 4, advanced: {} }, inputs: { refs: [] },
    });
    fake.onNext('batch shot', () => new Response(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgo=' }], cost: 0.1 }), { status: 200, headers: { 'content-type': 'application/json' } }));
    fake.onNext('batch shot', 'cut-after-accept');

    await expect(runGeneration(g.id)).rejects.toThrow();
    expect(useStore.getState().generations[g.id].assetIds).toHaveLength(1);
    expect(fake.acceptedCount('batch shot')).toBe(2);

    await retryGeneration(g.id).catch(() => undefined);
    expect(fake.acceptedCount('batch shot')).toBeLessThanOrEqual(4);
  });
});

describe('Escenario (d): reintento de Atlas y 402 bajo limite', () => {
  it('d1 (ya pasa en main): reintento interno de Atlas ante Upstream access denied entrega 1 resultado sin doble cobro', async () => {
    setupSession({ spentUsd: 0, budgetUsd: 0.15, budgetOn: true });
    vi.spyOn(httpMod, 'sleep').mockResolvedValue(undefined);
    fake.onNext('/api/v1/model/generateImage', 'atlas-upstream-denied');

    const g = createGeneration({
      sessionId: sid, origin: 'composer', kind: 'image', prompt: 'atlas retry shot',
      modelRef: ATLAS_REF, settings: { count: 1, advanced: {} }, inputs: { refs: [] },
    });
    const assets = await runGeneration(g.id);
    expect(assets).toHaveLength(1);
    expect(fake.attemptCount('/api/v1/model/generateImage')).toBe(2);
    expect(fake.acceptedCount('/api/v1/model/generateImage')).toBe(1);
    expect(useStore.getState().spentUsd).toBeCloseTo(0.1, 6);
  });

  it('d2a (ya pasa en main): 402 en nanogpt con autoSwitch=always cambia a atlas (mismo modelo, igual o menor precio) bajo limite', async () => {
    setupSession({ spentUsd: 0, budgetUsd: 0.15, budgetOn: true, autoSwitch: 'always' });
    fake.onNext('/v1/images', 'http-402');

    const g = createGeneration({
      sessionId: sid, origin: 'composer', kind: 'image', prompt: 'switch shot',
      modelRef: IMG_REF, settings: { count: 1, advanced: {} }, inputs: { refs: [] },
    });
    const assets = await runGeneration(g.id);
    expect(assets).toHaveLength(1);
    expect(fake.acceptedCount('/v1/images')).toBe(0);
    expect(fake.acceptedCount('/api/v1/model/generateImage')).toBe(1);
    expect(useStore.getState().spentUsd).toBeCloseTo(0.1, 6);
  });

  it('d2b: precio lowerBound sin techo verificable exige confirmacion bajo limite activo', () => {
    setupSession({ spentUsd: 0, budgetUsd: 0.15, budgetOn: true });
    const verdict = budgetVerdict({ usd: 0.08, approximate: true, lowerBound: true }, { sessionId: sid });
    expect(verdict.over).toBe(true);
  });
});

describe('Escenario (e): dos envios simultaneos junto al tope', () => {
  // fixed in D+ 2b-2: paidSend reserva sincronamente antes de save/transporte y remainingBudget frena el 2o envio concurrente
  it('e1: dos envios concurrentes de $0.10 con tope $0.15 solo dejan salir uno y nunca superan el limite', async () => {
    setupSession({ spentUsd: 0, budgetUsd: 0.15, budgetOn: true, graph: twoImageGraph(false) });
    const heldFirst = fake.holdNext('alpha mug');
    const firstRun = runNodes(sid, ['n1']);
    await heldFirst.arrived;
    expect(fake.acceptedCount('alpha mug')).toBe(1);

    const secondRun = runNodes(sid, ['n2']);
    await secondRun;
    heldFirst.resolve();
    await firstRun;

    expect(fake.acceptedCount('/v1/images')).toBe(1);
    expect(useStore.getState().spentUsd).toBeLessThanOrEqual(0.15 + 1e-6);
  });
});

describe('Escenario (f): LLM en streaming', () => {
  it('f1 (ya pasa en main): 2 iteraciones con tool call + reintento 400 por reasoning liquida ambos costes reales', async () => {
    setupSession({ spentUsd: 0, budgetUsd: 1.0, budgetOn: true, effort: 'low' });
    fake.onNext('/chat/completions', 'http-400-reasoning');
    fake.onNext('/chat/completions', () =>
      sseResponse([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'tc_1', function: { name: 'read_guide', arguments: '{"id":"workflow:story"}' } }] }, finish_reason: 'tool_calls' }] },
        { choices: [], usage: { prompt_tokens: 200, completion_tokens: 40, cost: 0.04 } },
      ]),
    );
    fake.onNext('/chat/completions', () =>
      sseResponse([
        { choices: [{ delta: { content: 'All done.' }, finish_reason: 'stop' }] },
        { choices: [], usage: { prompt_tokens: 250, completion_tokens: 30, cost: 0.06 } },
      ]),
    );

    await llmTurn(sid, 'chat', { route: 'new', agentNodeId: 'main' });
    expect(fake.attemptCount('/chat/completions')).toBe(3);
    expect(fake.acceptedCount('/chat/completions')).toBe(2);
    expect(useStore.getState().spentUsd).toBeCloseTo(0.1, 6);
  });

  // fixed by task/urgente-dinero (991769f8): budget.ts:383-388 (llmCallEstimate) devuelve $0.0001 en vez de usd:null cuando el modelo LLM no tiene precio en catalogo; bajo limite activo ($1.00), llmTurn y rewritePrompts envian POST sin preguntar
  it('f2: modelo LLM sin precio en catalogo exige aprobacion en llmTurn y bloquea rewritePrompts bajo limite activo', async () => {
    setupSession({ spentUsd: 0, budgetUsd: 1.0, budgetOn: true, llmCatalog: [] });
    await llmTurn(sid, 'chat', { route: 'new', agentNodeId: 'main' });
    putRewritePlan('it_rw');
    await rewritePrompts(sid, 'it_rw', 'image');
    expect(fake.acceptedCount('/chat/completions')).toBe(0);
  });

  // fixed in D+ 2b-3: llmSend enruta llmTurn y rewritePrompts por paidSend reservando presupuesto en vuelo y liquidando idempotentemente por sendId
  it('f3: llmTurn en vuelo reserva presupuesto y frena rewritePrompts concurrente que pasaria el tope', async () => {
    setupSession({
      spentUsd: 0, budgetUsd: 0.05, budgetOn: true,
      llmCatalog: [{ id: LLM_MODEL, name: 'Pricey LLM', inputPrice: 20, outputPrice: 40, tools: true, vision: false }],
    });
    const heldTurn = fake.holdNext('/chat/completions');
    const turnPromise = llmTurn(sid, 'chat', { route: 'new', agentNodeId: 'main' });
    await heldTurn.arrived;
    expect(fake.acceptedCount('/chat/completions')).toBe(1);

    putRewritePlan('it_rw2');
    await rewritePrompts(sid, 'it_rw2', 'image');
    heldTurn.resolve(sseResponse([
      { choices: [{ delta: { content: 'Done.' }, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 1000, completion_tokens: 500, cost: 0.04 } },
    ]));
    await turnPromise;

    expect(fake.acceptedCount('/chat/completions')).toBe(1);
    expect(useStore.getState().spentUsd).toBeLessThanOrEqual(0.05 + 1e-6);
  });
});
