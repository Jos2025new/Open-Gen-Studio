import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Graph, ModelSchema } from '../src/engine/types';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} }, document: { addEventListener() {}, visibilityState: 'visible' } }));
const getAssetBlob = vi.hoisted(() => vi.fn<() => Promise<Blob | undefined>>(async () => undefined));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob, putAssetBlob: async (id: string) => id }));
type ChatOpts = { model: string; messages: unknown[]; signal?: AbortSignal };
const chat = vi.hoisted(() => vi.fn<(o: ChatOpts) => Promise<unknown>>());
vi.mock('../src/engine/providers/llm', async (orig) => ({ ...(await orig<typeof import('../src/engine/providers/llm')>()), chat }));
const resolveModelHook = vi.hoisted(() => ({ fn: null as null | ((ref: string) => Promise<unknown>) }));
vi.mock('../src/engine/catalog', async (orig) => {
  const real = await orig<typeof import('../src/engine/catalog')>();
  return { ...real, resolveModel: (ref: string) => (resolveModelHook.fn ? resolveModelHook.fn(ref) : real.resolveModel(ref)) };
});

import { check as ownerCheck } from '../scripts/check-agent-owner.mjs';
import { useStore } from '../src/store/store';
import { sendAgentMessage } from '../src/engine/agent/conversation';
import { stopAgent } from '../src/engine/agent/runtimeShared';
import { enterLane, laneState, patchLane } from '../src/engine/agent/lanes';
import { controllers } from '../src/engine/agent/runtimeShared';

import { mainThread } from './helpers/threads';
const HOME = useStore.getState().activeSessionId;
const ref = (id: string, type: 'chat' | 'agent') => ({ id, position: { x: 0, y: 0 }, data: { kind: 'ref' as const, type, ref: HOME, title: id } });
const control = (id: string, source: string, target: string) => ({ id, source, target, sourceHandle: 'out_control', targetHandle: 'control', kind: 'control' as const });
const baseGraph = (): Graph => ({
  nodes: [ref('chat', 'chat'), ref('chat2', 'chat'), ref('agentA', 'agent'), ref('agentB', 'agent')],
  edges: [control('c1', 'chat', 'agentA'), control('c2', 'chat2', 'agentB')],
});
const S = () => useStore.getState().sessions[HOME];
const llmReply = (t: string, toolCalls: unknown[] = []) => ({
  text: t, toolCalls, finishReason: toolCalls.length ? 'tool_calls' : 'stop', timing: { ttfbMs: 1, totalMs: 1 },
});

const imgSchema = (ref: string): ModelSchema => ({
  ref, source: 'catalog',
  slots: { prompt: 'prompt' },
  params: [{ key: 'aspect', label: 'Aspect', role: 'aspect', type: 'enum', options: ['1:1', '16:9'], default: '1:1' }],
});

const tempDirs: string[] = [];
const cleanups: Array<() => void> = [];

beforeEach(() => {
  chat.mockReset();
  getAssetBlob.mockReset().mockResolvedValue(undefined);
  resolveModelHook.fn = null;
  controllers.clear();
  vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
  const st = useStore.getState();
  useStore.setState({
    activeSessionId: HOME,
    assets: {
      ...st.assets,
      img1: { id: 'img1', sessionId: HOME, kind: 'image', origin: 'upload', name: 'photo.png', width: 512, height: 512, createdAt: 1 } as never,
    },
    catalog: {
      ...st.catalog,
      models: {
        ...st.catalog.models,
        'local::img-a': { ref: 'local::img-a', provider: 'local', id: 'img-a', name: 'Img A', kind: 'image', acceptsImage: false } as never,
        'local::img-b': { ref: 'local::img-b', provider: 'local', id: 'img-b', name: 'Img B', kind: 'image', acceptsImage: false } as never,
      },
      schemas: {
        ...st.catalog.schemas,
        'local::img-a': imgSchema('local::img-a'),
        'local::img-b': imgSchema('local::img-b'),
      },
      llm: {
        ...st.catalog.llm,
        openrouter: [{ id: 'default/model', name: 'Default', tools: true, vision: true, inputPrice: 1, outputPrice: 1 }],
      },
    },
    settings: { ...st.settings, keys: { ...st.settings.keys, openrouter: 'sk-test' }, agent: { ...st.settings.agent, provider: 'openrouter', model: 'default/model' } },
    composer: { ...st.composer, agentStyle: 'auto', attachments: [] },
    sessions: {
      ...st.sessions,
      [HOME]: {
        ...st.sessions[HOME],
        graph: baseGraph(),
        feed: [],
        agents: mainThread({ history: [], questionRound: 0, notes: [], busy: false }),
        agentLane: undefined,
      },
    },
  });
});

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  resolveModelHook.fn = null;
  for (const c of controllers.values()) c.abort();
  controllers.clear();
  vi.unstubAllGlobals();
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe('adversarial: Stop a medias, requestGate y escapes de check-agent-owner', () => {
  // FALLO REAL: conversation.ts:47 marca busy=true y hace await visibleAttachments ANTES de registrar el controller en llmTurn.ts:67; stopAgent(HOME) no encuentra controller para A y al resolver el adjunto A llama al LLM después de Stop.
  it('Stop mientras A prepara sus adjuntos antes de llmTurn debe cancelar el turno sin llamar al LLM', async () => {
    let releaseBlob!: () => void;
    getAssetBlob.mockImplementationOnce(() => new Promise<Blob | undefined>((res) => { releaseBlob = () => res(undefined); cleanups.push(releaseBlob); }));
    chat.mockResolvedValue(llmReply('should never run after Stop'));

    const aTurn = sendAgentMessage('describe this photo', { agentNodeId: 'agentA', chatNodeId: 'chat', attachments: ['img1'] });
    await vi.waitFor(() => expect(getAssetBlob).toHaveBeenCalledTimes(1));
    expect(laneState(HOME, 'agentA')?.busy).toBe(true);

    // El usuario pulsa Stop mientras A está ocupado.
    stopAgent(HOME, 'agentA');
    releaseBlob();
    await aTurn;

    expect(chat).not.toHaveBeenCalled();
    expect(laneState(HOME, 'agentA')?.busy).toBe(false);
  });

  // FALLO REAL: llmTurn.ts:342-347 hace await switchSection/keepConfirmed sin until(...) y sin comprobar done/signal.aborted; pulsar Stop durante ese await deja una tarjeta settings fantasma y pending colgado en A.
  it('Stop durante confirm_settings (en await switchSection) no debe escribir una tarjeta settings ni dejar pending tras Stop', async () => {
    useStore.setState((st) => ({ composer: { ...st.composer, agentStyle: 'guided' } }));
    enterLane(HOME, 'agentA');
    patchLane(HOME, 'agentA', { settings: { image: { modelRef: 'local::img-a', needsImage: false } } });

    let releaseSwitch!: () => void;
    const realCatalog = await vi.importActual<typeof import('../src/engine/catalog')>('../src/engine/catalog');
    resolveModelHook.fn = async (modelRef: string) => {
      // sectionsOfParts solo resuelve 'local::img-b'; 'local::img-a' (confirmado) solo se resuelve en switchSection/keepConfirmed (llmTurn.ts:342-343, fuera de until).
      if (modelRef === 'local::img-a') {
        await new Promise<void>((res) => { releaseSwitch = res; cleanups.push(res); });
      }
      return realCatalog.resolveModel(modelRef);
    };

    const confirmCall = { id: 'cs1', name: 'confirm_settings', arguments: JSON.stringify({ parts: [{ kind: 'image', model: 'local::img-b', user_requested: true }] }) };
    chat.mockResolvedValueOnce(llmReply('', [confirmCall]));

    const aTurn = sendAgentMessage('make an image with Img B', { agentNodeId: 'agentA', chatNodeId: 'chat' });
    await vi.waitFor(() => expect(releaseSwitch).toBeTypeOf('function'));

    stopAgent(HOME, 'agentA');
    expect(laneState(HOME, 'agentA')?.busy).toBe(false);

    releaseSwitch();
    await aTurn;

    expect(S().feed.some((f) => f.type === 'settings')).toBe(false);
    expect(laneState(HOME, 'agentA')?.pending).toBeUndefined();
  });

  // FALLO REAL: requestGate (runtimeShared.ts:45) lee session(sessionId).agent.draft sin owner; si B entra en pantalla mientras A espera visibleAttachments, A hereda las operaciones del draft de B.
  it('requestGate de A tras await visibleAttachments no debe leer el draft de B (en pantalla)', async () => {
    let releaseBlob!: () => void;
    getAssetBlob.mockImplementationOnce(() => new Promise<Blob | undefined>((res) => { releaseBlob = () => res(undefined); cleanups.push(releaseBlob); }));
    let seenPromptForA = '';
    chat.mockImplementation(async (o) => {
      const last = JSON.stringify(o.messages.at(-1));
      if (last.includes('plain caption for A')) seenPromptForA = last;
      return llmReply('ok');
    });

    const aTurn = sendAgentMessage('plain caption for A', { agentNodeId: 'agentA', chatNodeId: 'chat', attachments: ['img1'] });
    await vi.waitFor(() => expect(getAssetBlob).toHaveBeenCalledTimes(1));

    // Mientras A espera visibleAttachments, B entra en pantalla con un draft que dispara la op remove_background.
    enterLane(HOME, 'agentB');
    patchLane(HOME, 'agentB', { draft: { request: 'remove background from this image', answers: {}, attachments: ['img1'] } });

    releaseBlob();
    await aTurn;

    expect(seenPromptForA).toContain('plain caption for A');
    expect(seenPromptForA).not.toContain('remove_bg');
    expect(seenPromptForA).not.toContain('background');
  });

  // FALLO REAL: check-agent-owner.mjs usa una regex de una sola línea; deja pasar escrituras directas a session.agent en multilínea, con variable intermedia o con Object.assign.
  it('check-agent-owner debe detectar escrituras manuales a session.agent en multilínea, con variable intermedia y con Object.assign', () => {
    const root = mkdtempSync(join(tmpdir(), 'owner-escape-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'src/engine'), { recursive: true });
    writeFileSync(
      join(root, 'src/engine/multiline.ts'),
      'export const f = (s: any) => ({\n  ...s,\n  agent: { ...s.agent, notes: [] },\n});\n',
    );
    writeFileSync(
      join(root, 'src/engine/tempvar.ts'),
      'export const g = (s: any) => { const a = { ...s.agent, busy: false }; return { ...s, agent: a }; };\n',
    );
    writeFileSync(
      join(root, 'src/engine/mutate.ts'),
      'export const h = (s: any) => { Object.assign(s.agent, { busy: true }); return s; };\n',
    );

    const errors = ownerCheck(root);
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});
