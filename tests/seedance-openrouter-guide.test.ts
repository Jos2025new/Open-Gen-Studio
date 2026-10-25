import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));

import { rewritePrompts } from '../src/engine/agent/planSettings';
import { useStore } from '../src/store/store';
import type { FeedItem, ModelSchema, ModelSummary, PlanFeedItem } from '../src/engine/types';

const before = useStore.getState();
const ref = 'openrouter::bytedance/seedance-2.0-mini';
const sessionId = () => useStore.getState().activeSessionId;
const session = () => useStore.getState().sessions[sessionId()];

afterEach(() => { vi.unstubAllGlobals(); useStore.setState(before); });

describe('OpenRouter Seedance prompt writer guide (F1.7)', () => {
  it('includes the selected model guide in the writer system message', async () => {
    const model: ModelSummary = { ref, provider: 'openrouter', id: 'bytedance/seedance-2.0-mini', name: 'Seedance 2.0 Mini', kind: 'video', acceptsText: true, acceptsImage: true, tags: [] };
    const schema: ModelSchema = { ref, source: 'catalog', params: [], slots: { images: { key: 'input_references', max: 10, min: 0, multiple: true, format: 'content-part' } } };
    const plan: PlanFeedItem = {
      id: 'plan-seedance', createdAt: 0, workspace: 'chat', type: 'plan', style: 'auto', status: 'awaiting', stepStates: {}, stepGenerations: {}, estimate: { usd: 0.1 },
      plan: { id: 'p', title: 'Storyboard clip', summary: '', workspace: 'chat', adjustments: [], steps: [{ id: 's1', kind: 'video', title: 'clip', prompt: 'Animate the storyboard', modelRef: ref, refs: ['asset:grid', 'asset:character'], settings: { count: 1, duration: 5, advanced: {} } }] },
    } as unknown as PlanFeedItem;
    const state = useStore.getState();
    useStore.setState({
      settings: { ...state.settings, keys: { ...state.settings.keys, openrouter: 'test-key' }, agent: { ...state.settings.agent, provider: 'openrouter', model: 'test-model' } },
      catalog: { ...state.catalog, models: { ...state.catalog.models, [ref]: model }, schemas: { ...state.catalog.schemas, [ref]: schema } },
      sessions: { ...state.sessions, [sessionId()]: { ...session(), feed: [plan as FeedItem] } },
    });
    let system = '';
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      system = body.messages[0].content;
      const data = { choices: [{ delta: { content: '{"s1":"Follow the storyboard references."}' }, finish_reason: 'stop' }] };
      return new Response(`data: ${JSON.stringify(data)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    });
    await rewritePrompts(sessionId(), 'plan-seedance', 'video');
    expect(system).toContain('Seedance 2.0 / 2.5 (ByteDance) — prompting guide');
    expect(system).toContain('Storyboard grid to video');
    expect(system).toContain('@Image1 is the character');
  });
});
