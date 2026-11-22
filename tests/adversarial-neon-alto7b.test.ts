import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, {
  window: { setTimeout, clearTimeout, addEventListener: () => undefined, setInterval, clearInterval },
  document: { addEventListener: () => undefined, visibilityState: 'visible' },
}));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
  deleteAssetBlobs: async () => undefined,
  peekAssetUrl: () => undefined,
  loadAssetUrl: async () => undefined,
}));

import { llmTurn } from '../src/engine/agent/llmTurn';
import { stopAgent } from '../src/engine/agent/runtimeShared';
import { promptNodeText, resolveSystemNodeLive } from '../src/engine/nodes/spec';
import { addSystemNode } from '../src/engine/nodes/system';
import { systemRefDefault } from '../src/engine/nodes/systemDefaults';
import { createSession, useStore } from '../src/store/store';
import type { NoticeFeedItem, PlanFeedItem, QuestionsFeedItem, RefNodeData, Workspace } from '../src/engine/types';
import { mainThread } from './helpers/threads';

const enc = new TextEncoder();
const sse = (chunks: unknown[]) =>
  new Response(
    new ReadableStream({
      start(c) {
        chunks.forEach((x) => c.enqueue(enc.encode(`data: ${JSON.stringify(x)}\n\n`)));
        c.enqueue(enc.encode('data: [DONE]\n\n'));
        c.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );

const multiToolChunk = (calls: Array<{ name: string; args: unknown }>) => ({
  choices: [{
    delta: {
      tool_calls: calls.map((c, index) => ({
        index,
        id: `call_${index}_${c.name}`,
        function: { name: c.name, arguments: JSON.stringify(c.args) },
      })),
    },
    finish_reason: 'tool_calls',
  }],
});

let sid = '';

function setupSession(workspace: Workspace, agentStyle: 'auto' | 'guided' | 'direct' = 'guided') {
  const st = useStore.getState();
  const s = createSession('Neon adversarial alto7b');
  sid = s.id;
  useStore.setState({
    activeSessionId: sid,
    ui: { ...st.ui, workspace, space: undefined },
    composer: { ...st.composer, agentStyle, text: 'hello from studio', attachments: [] },
    settings: {
      ...st.settings,
      budgetOn: false,
      keys: { ...st.settings.keys, nanogpt: 'k' },
      agent: { ...st.settings.agent, provider: 'nanogpt', model: 'test-llm', showThinking: false },
    },
    catalog: {
      ...st.catalog,
      llm: {
        ...st.catalog.llm,
        nanogpt: [{ id: 'test-llm', name: 'Test LLM', tools: true, vision: true, inputPrice: 0, outputPrice: 0 }] as never,
      },
    },
    sessions: {
      ...st.sessions,
      [sid]: {
        ...s,
        feed: [],
        agents: mainThread({ history: [{ role: 'user', content: 'go' }], questionRound: 0, notes: [], busy: false }),
      },
    },
  });
}

const isLlmPost = (url: unknown, init?: RequestInit) =>
  (init?.method ?? 'GET').toUpperCase() === 'POST' && !String(url).includes('/x/store');

beforeEach(() => {
  setupSession('chat', 'guided');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Punto 7 (d6a32e7a) — workspace viejo capturado en llmTurn tras cambio de lienzo en runTurnToolLoop', () => {
  // Severidad: Alta | Origen: Nuevo (regresión introducida en d6a32e7a)
  it('H1-a: open_board(nodes) + ask_questions en el mismo mensaje conserva meta.space del lienzo nuevo ("canvas")', async () => {
    setupSession('chat', 'guided');
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
      if (isLlmPost(url, init)) {
        return sse([multiToolChunk([
          { name: 'open_board', args: { view: 'nodes' } },
          { name: 'ask_questions', args: { intro: 'Quick check', questions: [{ id: 'q1', question: 'Style?', options: ['A', 'B'] }] } },
        ])]);
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }));

    await llmTurn(sid, 'chat', { route: 'new', agentNodeId: 'main' });

    const q = useStore.getState().sessions[sid].feed.find((f): f is QuestionsFeedItem => f.type === 'questions');
    expect(q).toBeDefined();
    // Antes de d6a32e7a, workspace se mutaba en sitio antes del segundo tool call y turnMeta() emitía space: 'canvas'.
    // Tras d6a32e7a, llmTurn.ts no actualiza workspace hasta que runTurnToolLoop retorna, así que turnMeta() lee 'chat' -> 'studio'.
    expect(q?.meta?.space).toBe('canvas');
  });

  // Severidad: Alta | Origen: Nuevo (regresión introducida en d6a32e7a)
  it('H1-b: continue_in_canvas + propose_plan desde Designer escribe plan con meta.space "canvas" (coherente con workspace "node")', async () => {
    setupSession('designer', 'direct');
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
      if (isLlmPost(url, init)) {
        return sse([multiToolChunk([
          { name: 'continue_in_canvas', args: {} },
          {
            name: 'propose_plan',
            args: {
              title: 'Node plan after switch',
              steps: [{ id: 's1', kind: 'image', prompt: 'red apple', model: 'local::studio-image' }],
            },
          },
        ])]);
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }));

    await llmTurn(sid, 'designer', { route: 'new', agentNodeId: 'main' });

    const plan = useStore.getState().sessions[sid].feed.find((f): f is PlanFeedItem => f.type === 'plan');
    expect(plan).toBeDefined();
    expect(plan?.workspace).toBe('node');
    // presentPlan recibe workspace='node', pero meta viene de turnMeta() con workspace viejo ('designer').
    expect(plan?.meta?.space).toBe('canvas');
  });

  // Severidad: Alta | Origen: Nuevo (regresión introducida en d6a32e7a)
  it('H1-c: stopAgent durante una tool posterior a continue_in_canvas publica el aviso "Stopped." en el lienzo nuevo ("node" / "canvas")', async () => {
    setupSession('designer', 'guided');
    let enteredSecondTool!: () => void;
    const secondToolStarted = new Promise<void>((r) => { enteredSecondTool = r; });

    let llmAnswered = false;
    vi.stubGlobal('fetch', vi.fn((url: unknown, init?: RequestInit) => {
      if (isLlmPost(url, init)) {
        llmAnswered = true;
        return Promise.resolve(sse([multiToolChunk([
          { name: 'continue_in_canvas', args: {} },
          { name: 'find_models', args: { query: 'flux', kind: 'image' } },
        ])]));
      }
      // find_models consulta el catálogo si no está cargado; detenemos ahí para disparar stopAgent mid-loop.
      if (String(url).includes('nano-gpt.com') || String(url).includes('/x/store/log')) return Promise.resolve(new Response('{}', { status: 200 }));
      if (llmAnswered) enteredSecondTool(); // only the fetch made by the 2nd tool counts, not the catalog load at turn start
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    }));

    // Forzamos que find_models intente cargar catálogo remoto para tener un await observable en el 2º tool.
    useStore.setState((st) => ({
      settings: { ...st.settings, keys: { ...st.settings.keys, fal: 'k-fal' } },
      catalog: { ...st.catalog, status: { ...st.catalog.status, fal: 'idle' } },
    }));

    const turn = llmTurn(sid, 'designer', { route: 'new', agentNodeId: 'main' });
    await secondToolStarted;
    stopAgent(sid, 'main');
    await turn;

    const stopped = useStore.getState().sessions[sid].feed.find(
      (f): f is NoticeFeedItem => f.type === 'notice' && f.text === 'Stopped.',
    );
    expect(stopped).toBeDefined();
    // ending() en llmTurn.ts:78 lee el workspace externo ('designer') en vez del 'node' actualizado en turnToolLoop.ts:180.
    expect(stopped?.workspace).toBe('node');
    expect(stopped?.meta?.space).toBe('canvas');
  });
});

describe('Punto 6 (0d341213..af8e3869) — divergencia heredada addRef vs systemRefDefault y consumidores', () => {
  // Severidad: Media | Origen: Heredado (preservado vía addRef en 0d341213)
  it('H2-a: addSystemNode(prompt) sin ref debería enlazar al compositor ("composer") igual que systemRefDefault y los consumidores', () => {
    const id = addSystemNode(sid, { type: 'prompt' });
    const node = useStore.getState().sessions[sid].graph.nodes.find((n) => n.id === id)!;
    const data = node.data as RefNodeData;
    expect(data.ref).toBe(systemRefDefault('prompt', sid, useStore.getState().composer.image.modelRef));
    expect(promptNodeText(node)).toBe('hello from studio');
    expect(resolveSystemNodeLive(sid, node)?.subtitle).toBe('Studio prompt box');
  });

  // Severidad: Media | Origen: Heredado (preservado vía addRef en 0d341213)
  it('H2-b: addSystemNode(mediaSettings) sin ref debería usar una clave válida de store.composer ("image"), no "mediaSettings"', () => {
    const id = addSystemNode(sid, { type: 'mediaSettings' });
    const node = useStore.getState().sessions[sid].graph.nodes.find((n) => n.id === id)!;
    const data = node.data as RefNodeData;
    expect(data.ref).toBe(systemRefDefault('mediaSettings', sid, useStore.getState().composer.image.modelRef));
    expect(data.ref in useStore.getState().composer).toBe(true);
  });
});
