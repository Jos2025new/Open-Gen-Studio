import { afterEach, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import { atlas } from '../src/engine/providers/atlas';
import { confirmSettings } from '../src/engine/agent/runtime';
import { useStore } from '../src/store/store';
import { serve } from './fixtures/live/serve';
import type { SettingsFeedItem, SettingsChoice, PlanFeedItem, ImageStep } from '../src/engine/types';
const before = useStore.getState();
afterEach(() => { vi.unstubAllGlobals(); useStore.setState(before); });
it('publishes the plan after confirming Edit through the real runtime and recorded Atlas adapter', async () => {
  const edit = 'atlas::google/nano-banana-2/edit-developer';
  const text = 'atlas::google/nano-banana-2/text-to-image-developer';
  let llmCalls = 0;
  vi.stubGlobal('location', { href: 'http://localhost/' });
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (body.messages) {
      llmCalls++;
      const args = { title: 'Cuento', steps: [{ id: 's2', kind: 'image', model: edit, prompt: 'Invent the girl and cat' }, { id: 's3', kind: 'image', model: edit, refs: ['s2'], prompt: 'The same girl at the market' }] };
      const chunk = { choices: [{ delta: { tool_calls: [{ index: 0, id: 'plan-call', function: { name: 'propose_plan', arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] };
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    }
    return new Response(JSON.stringify(serve(String(url))));
  });
  const models = await atlas.listModels(undefined);
  const picked = models.filter(m => [edit, text].includes(m.ref));
  expect(picked).toHaveLength(2);
  const schemas = Object.fromEntries(await Promise.all(picked.map(async m => [m.ref, await atlas.loadSchema(m, undefined)])));
  const sid = before.activeSessionId;
  const choice: SettingsChoice = { modelRef: edit, needsImage: true, resolution: '1k', aspect: '16:9', count: 1 };
  const card = { id: 'settings-card', type: 'settings', workspace: 'chat', createdAt: Date.now(), status: 'pending', toolCallId: 'settings-call', sections: [{ kind: 'image', count: 1, recommended: choice, alternatives: [] }] } as SettingsFeedItem;
  useStore.setState({
    ui: { ...before.ui, workspace: 'chat' },
    settings: { ...before.settings, keys: { ...before.settings.keys, atlas: 'fixture', nanogpt: 'fixture' }, agent: { ...before.settings.agent, provider: 'nanogpt', model: 'fixture' } },
    composer: { ...before.composer, agentStyle: 'auto', attachments: [] },
    catalog: { ...before.catalog, models: Object.fromEntries(models.map(m => [m.ref, m])), schemas },
    sessions: { ...before.sessions, [sid]: { ...before.sessions[sid], feed: [card], agent: { busy: false, questionRound: 0, notes: [], history: [{ role: 'assistant', content: '', tool_calls: [{ id: 'settings-call', type: 'function', function: { name: 'confirm_settings', arguments: '{"parts":[{"kind":"image","refs":1}]}' } }] }], pending: { kind: 'settings', toolCallId: 'settings-call', feedItemId: card.id } } } },
  });
  await confirmSettings(sid, card.id, [choice]);
  const plan = useStore.getState().sessions[sid].feed.find(f => f.type === 'plan') as PlanFeedItem | undefined;
  expect(plan?.plan.steps.map(s => (s as ImageStep).modelRef)).toEqual([text, edit]);
  expect(llmCalls).toBe(1);
});
