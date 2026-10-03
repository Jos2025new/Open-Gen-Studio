import { describe, expect, it, vi } from 'vitest';
import { canvasIndex } from '../src/engine/canvas';
import { buildContext } from '../src/engine/agent/context';
import { createSession, useStore } from '../src/store/store';
import type { Asset, Generation, Session } from '../src/engine/types';

vi.hoisted(() => {
  Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } });
});
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async (id: string) => id,
}));

const asset = (id: string, generationId?: string): Asset => ({ id, kind: 'image', mime: 'image/png', width: 512, height: 512, sessionId: 's', generationId, origin: generationId ? 'generated' : 'upload', stored: true, favorite: false, createdAt: Date.now() });
const gen = (id: string, origin: Generation['origin'], planId?: string): Generation => ({ id, sessionId: 's', status: 'done', origin, planId, prompt: id, assetIds: [`a_${id}`], settings: { count: 1, advanced: {} }, inputs: { refs: [] } } as unknown as Generation);
const base = (workspace: 'chat' | 'node') => ({ id: Math.random().toString(36), createdAt: 0, workspace });

function setup(): Session {
  const s: Session = { ...createSession('t'), id: 's' };
  s.feed = [
    { ...base('chat'), type: 'user', text: 'hi', mode: 'agent', attachments: ['up_chat'] },
    { ...base('chat'), type: 'generation', generationId: 'chat1' },
    { ...base('chat'), type: 'generation', generationId: 'nodeGen', mirroredFrom: 'node', outputIndex: 0 },
    { ...base('node'), type: 'plan', plan: { id: 'p_node', title: '', summary: '', workspace: 'node', steps: [], adjustments: [] } } as never,
    { ...base('chat'), type: 'plan', plan: { id: 'p_chat', title: '', summary: '', workspace: 'chat', steps: [], adjustments: [] } } as never,
  ];
  s.graph = { ...s.graph, nodes: [{ id: 'n1', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'x', assetId: 'up_node' } } as never, { id: 'n2', position: { x: 300, y: 0 }, data: { kind: 'image', title: 'Live output', prompt: '', generationId: 'nodeGen', outputIndex: 0, settings: {} } } as never] };
  const gens = { chat1: gen('chat1', 'composer'), nodeGen: gen('nodeGen', 'node'), nodePlan: gen('nodePlan', 'agent', 'p_node'), chatPlan: gen('chatPlan', 'agent', 'p_chat') };
  const assets: Record<string, Asset> = { up_chat: asset('up_chat'), up_node: asset('up_node'), loose: asset('loose') };
  for (const g of Object.values(gens)) assets[`a_${g.id}`] = asset(`a_${g.id}`, g.id);
  useStore.setState(() => ({ sessions: { s }, activeSessionId: 's', generations: gens, assets }));
  return s;
}

describe('the agent sees only the active canvas', () => {
  it('assigns each result to the canvas it was made on', () => {
    const s = setup();
    const c = canvasIndex(s, useStore.getState().generations);
    const st = useStore.getState();
    expect(c.asset(st.assets.a_chat1)).toBe('chat');
    expect(c.asset(st.assets.a_chatPlan)).toBe('chat');
    expect(c.asset(st.assets.a_nodeGen)).toBe('node');
    expect(c.asset(st.assets.a_nodePlan)).toBe('node');
    expect(c.asset(st.assets.up_chat)).toBe('chat');
    expect(c.asset(st.assets.up_node)).toBe('node');
    expect(c.asset(st.assets.loose)).toBeUndefined();
  });

  it('lists only that canvas’s assets in the agent context', () => {
    const s = setup();
    const ctx = (w: 'chat' | 'node') => buildContext(s, { workspace: w, style: 'auto', round: 0, maxRounds: 2, attachments: [] });
    const chat = ctx('chat');
    for (const id of ['a_chat1', 'a_chatPlan', 'up_chat', 'loose']) expect(chat).toContain(`asset:${id}`);
    for (const id of ['a_nodeGen', 'a_nodePlan', 'up_node']) expect(chat).not.toContain(`asset:${id}`);
    const node = ctx('node');
    for (const id of ['a_nodeGen', 'up_node']) expect(node).toContain(`asset:${id}`);
    for (const id of ['a_chat1', 'a_chatPlan', 'up_chat', 'a_nodePlan', 'loose']) expect(node).not.toContain(`asset:${id}`);
  });
});
