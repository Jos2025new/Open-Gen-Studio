import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Asset, Generation, GraphNode, Session } from '../src/engine/types';

vi.hoisted(() => {
  Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } });
});
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async (id: string) => id,
}));

import { canvasIndex } from '../src/engine/canvas';
import { SYSTEM_PROMPT } from '../src/engine/agent/context';
import { sendAgentMessage } from '../src/engine/agent/runtime';
import { TOOLS } from '../src/engine/agent/tools';
import { nodeWorkNotInChat, nodesToChat } from '../src/engine/flow/fromNodes';
import { createSession, useStore } from '../src/store/store';

const generation = (id: string, sessionId: string, assetIds: string[]): Generation => ({
  id,
  sessionId,
  kind: 'image',
  prompt: `prompt ${id}`,
  modelRef: 'local::studio-image',
  modelName: 'Studio Image',
  provider: 'local',
  settings: { count: assetIds.length, advanced: {} },
  inputs: { refs: [] },
  origin: 'node',
  status: 'done',
  assetIds,
  estimate: { usd: 0 },
  createdAt: 1,
} as unknown as Generation);

const asset = (id: string, generationId: string): Asset => ({
  id,
  sessionId: 's',
  kind: 'image',
  name: id,
  mime: 'image/png',
  width: 512,
  height: 512,
  generationId,
  origin: 'generated',
  stored: true,
  favorite: false,
  createdAt: 1,
} as Asset);

const resultNode = (id: string, generationId: string, outputIndex: number): GraphNode => ({
  id,
  position: { x: 0, y: 0 },
  data: { kind: 'image', title: `Node ${id}`, prompt: id, modelRef: 'local::studio-image', settings: { count: 3, advanced: {} }, generationId, outputIndex },
});

beforeEach(() => {
  const session: Session = { ...createSession('Nodes to Chat'), id: 's' };
  session.graph = {
    nodes: [
      resultNode('image-node', 'g1', 2),
      { id: 'manual-text', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'Notes', text: 'not a result' } },
      { id: 'reference', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Reference', assetId: 'upload' } },
      resultNode('missing-output', 'g2', 0),
    ],
    edges: [],
  };
  const g1 = generation('g1', 's', ['a1', 'a2', 'a3']);
  const g2 = generation('g2', 's', ['missing']);
  useStore.setState({
    sessions: { s: session },
    activeSessionId: 's',
    generations: { g1, g2 },
    assets: { a1: asset('a1', 'g1'), a2: asset('a2', 'g1'), a3: asset('a3', 'g1') },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('node results → chat', () => {
  it('lists only current node results backed by a real selected asset', () => {
    expect(nodeWorkNotInChat('s')).toEqual([
      { nodeId: 'image-node', generationId: 'g1', outputIndex: 2, assetId: 'a3', label: 'Node image-node' },
    ]);
  });

  it('adds one marked feed reference, preserves the selected result and is idempotent', () => {
    const beforeGenerations = useStore.getState().generations;
    const beforeAssets = useStore.getState().assets;

    expect(nodesToChat('s', ['image-node']).added).toHaveLength(1);
    const item = useStore.getState().sessions.s.feed[0];
    expect(item).toMatchObject({ workspace: 'chat', type: 'generation', generationId: 'g1', mirroredFrom: 'node', outputIndex: 2 });
    expect(useStore.getState().generations).toBe(beforeGenerations);
    expect(useStore.getState().assets).toBe(beforeAssets);
    expect(nodeWorkNotInChat('s')).toEqual([]);
    expect(nodesToChat('s', ['image-node']).added).toEqual([]);
    expect(useStore.getState().sessions.s.feed).toHaveLength(1);
  });

  it('does not let the mirrored Chat card change the generation canvas', () => {
    nodesToChat('s');
    const st = useStore.getState();
    expect(canvasIndex(st.sessions.s, st.generations).generation(st.generations.g1)).toBe('node');
  });
});

describe('agent Nodes → Chat action', () => {
  it('exposes the action and tells the agent to use it for returning to Chat', () => {
    expect(TOOLS.some((tool) => tool.function.name === 'continue_in_chat')).toBe(true);
    expect(SYSTEM_PROMPT).toMatch(/continue_in_chat/);
  });

  it('runs the same import as the button, keeps the selected output and switches to Chat', async () => {
    const replies: Array<{ tool: { name: string; args: unknown } } | { text: string }> = [
      { tool: { name: 'continue_in_chat', args: { node_ids: ['image-node'] } } },
      { text: 'Listo, seguimos en Chat.' },
    ];
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (!body.messages) return new Response(JSON.stringify({ data: [] }));
      const reply = replies.shift() ?? { text: 'Listo.' };
      const delta = 'tool' in reply
        ? { tool_calls: [{ index: 0, id: 'continue-chat', function: { name: reply.tool.name, arguments: JSON.stringify(reply.tool.args) } }] }
        : { content: reply.text };
      return new Response(`data: ${JSON.stringify({ choices: [{ delta, ...('tool' in reply ? { finish_reason: 'tool_calls' } : {}) }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    });
    const st = useStore.getState();
    useStore.setState({
      ui: { ...st.ui, workspace: 'node' },
      settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'test' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'test' } },
      composer: { ...st.composer, agentStyle: 'auto', attachments: [] },
    });

    await sendAgentMessage('Lleva este resultado al chat');

    const next = useStore.getState();
    expect(next.ui.workspace).toBe('chat');
    expect(next.sessions.s.feed).toContainEqual(expect.objectContaining({ type: 'generation', generationId: 'g1', mirroredFrom: 'node', outputIndex: 2 }));
    expect(next.sessions.s.graph.nodes.find((node) => node.id === 'image-node')?.data).toMatchObject({ generationId: 'g1', outputIndex: 2 });
  });
});
