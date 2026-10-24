import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Auto shows no "Confirm settings" card: confirm_settings is answered by the app in the same turn (an inline, confirmed
 * item) and the settings live on the plan card (planSettings): sections read from the steps, changes applied to the
 * steps of that kind, prompts rewritten by the agent's model only when asked, the draft choice locking the resolution.
 */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { sendAgentMessage } from '../src/engine/agent/runtime';
import { changePlanChoice, changePlanDraft, planSections, rewritePrompts, usePlanRewrite } from '../src/engine/agent/planSettings';
import { useStore } from '../src/store/store';
import type { FeedItem, ImageStep, ModelSchema, ModelSummary, PlanFeedItem, SettingsFeedItem } from '../src/engine/types';

const ATLAS = 'atlas::google/nano-banana-2/text-to-image';
const LITE = 'atlas::google/nano-banana-2-lite/text-to-image';
const VID = 'local::studio-video';
const NAME: Record<string, string> = { [ATLAS]: 'Nano Banana 2', [LITE]: 'Nano Banana 2 Lite' };
const before = useStore.getState();
const sid = () => before.activeSessionId;
const st = () => useStore.getState().sessions[sid()];
afterEach(() => { vi.unstubAllGlobals(); useStore.setState(before); });

type Reply = { name: string; args: unknown } | string;
let script: Reply[] = [];
const sse = (r: Reply) => new Response(`data: ${JSON.stringify(typeof r === 'string'
  ? { choices: [{ delta: { content: r }, finish_reason: 'stop' }] }
  : { choices: [{ delta: { tool_calls: [{ index: 0, id: `c${Math.random()}`, function: { name: r.name, arguments: JSON.stringify(r.args) } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
let calls = 0;

function setup() {
  script = [];
  calls = 0;
  const refs = [ATLAS, LITE];
  const models = Object.fromEntries(refs.map((ref) => [ref, { ref, id: ref.split('::')[1], provider: 'atlas', kind: 'image', name: NAME[ref], acceptsText: true, acceptsImage: false, tags: [], price: { skus: [{ unit: 'image', usd: 0.067 }] } } as unknown as ModelSummary]));
  const schemas = Object.fromEntries(refs.map((ref) => [ref, { ref, source: 'catalog', params: [], slots: { prompt: 'prompt' } } as ModelSchema]));
  const base = useStore.getState().catalog.schemas[VID] ?? ({ slots: {}, params: [] } as unknown as ModelSchema);
  schemas[VID] = { ...base, ref: VID, params: [{ key: 'resolution', label: 'Resolution', role: 'resolution', type: 'enum', options: ['480p', '720p', '1080p'], default: '720p' }] } as unknown as ModelSchema;
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (!body.messages) return new Response(JSON.stringify({ data: [] }));
    calls++;
    return sse(script.shift() ?? 'ok');
  });
  const s = useStore.getState();
  useStore.setState({
    settings: { ...s.settings, keys: { ...s.settings.keys, nanogpt: 'k', atlas: 'k' }, agent: { ...s.settings.agent, provider: 'nanogpt', model: 'm' } },
    composer: { ...s.composer, agentStyle: 'auto', attachments: [], image: { ...s.composer.image, modelRef: ATLAS } },
    catalog: { ...s.catalog, models: { ...s.catalog.models, ...models }, schemas: { ...s.catalog.schemas, ...schemas } },
    sessions: { ...s.sessions, [sid()]: { ...s.sessions[sid()], feed: [], subjects: [], agent: { history: [], questionRound: 0, notes: [], busy: false, settings: { image: { modelRef: ATLAS, needsImage: false, count: 1, aspect: '1:1' } } } } },
  });
  usePlanRewrite.setState({ busy: {}, failed: {} });
}

const ask = (part: Record<string, unknown>) => ({ name: 'confirm_settings', args: { parts: [{ kind: 'image', ...part }] } });
const proposal = (model?: string) => ({ name: 'propose_plan', args: { title: 'P', steps: [{ id: 's1', kind: 'image', title: 'I', prompt: 'a lighthouse', count: 1, ...(model ? { model } : {}) }] } });
const settingsItems = () => st().feed.filter((f): f is SettingsFeedItem => f.type === 'settings');
const planItem = () => st().feed.filter((f): f is PlanFeedItem => f.type === 'plan').at(-1);

describe('Auto: confirm_settings without a card', () => {
  beforeEach(setup);

  it('(a) no pending card; an inline confirmed item stays in the feed; the plan is shown in the same turn', async () => {
    useStore.setState((x) => ({ sessions: { ...x.sessions, [sid()]: { ...st(), agent: { ...st().agent, settings: undefined } } } }));
    script = [ask({}), proposal()];
    await sendAgentMessage('Una imagen de un faro');
    expect(st().agent.pending?.kind).not.toBe('settings');
    expect(settingsItems().filter((f) => f.status === 'pending')).toHaveLength(0);
    expect(settingsItems()).toHaveLength(1);
    expect(settingsItems()[0]).toMatchObject({ status: 'confirmed', inline: true });
    expect(planItem()).toBeDefined();
    expect(st().agent.settings?.image?.modelRef).toBe(ATLAS);
  });

  it('(b) a model the user names in the request is applied with no Keep / Change card', async () => {
    script = [ask({ model: 'nano banana 2 lite' }), proposal(LITE)];
    await sendAgentMessage('Una imagen de un faro con nano banana 2 lite');
    expect(settingsItems()).toHaveLength(1);
    expect(settingsItems()[0]).toMatchObject({ status: 'confirmed', inline: true, sections: [{ chosen: { modelRef: LITE } }] });
    expect(settingsItems()[0].switchFrom).toBeUndefined();
    expect(st().agent.pending).toBeUndefined();
    expect(st().agent.settings?.image?.modelRef).toBe(LITE);
    expect(planItem()?.plan.steps.map((x) => (x as ImageStep).modelRef)).toEqual([LITE]);
  });
});

const awaiting = (steps: unknown[]): PlanFeedItem => ({
  id: 'pl1', createdAt: 0, workspace: 'chat', type: 'plan', style: 'auto', status: 'awaiting', stepStates: {}, stepGenerations: {}, estimate: { usd: 0.2 },
  plan: { id: 'p', title: 'T', summary: '', workspace: 'chat', adjustments: [], steps },
} as unknown as PlanFeedItem);
const img = (id: string, over: Record<string, unknown> = {}) => ({ id, kind: 'image', title: id, prompt: `prompt ${id}`, modelRef: ATLAS, refs: [], settings: { aspect: '1:1', count: 1, advanced: {} }, ...over });
const vid = (id: string, over: Record<string, unknown> = {}) => ({ id, kind: 'video', title: id, prompt: `clip ${id}`, modelRef: VID, refs: [], settings: { aspect: '16:9', duration: 5, resolution: '1080p', advanced: {} }, ...over });
const put = (steps: unknown[]) => { useStore.setState((s) => ({ sessions: { ...s.sessions, [sid()]: { ...s.sessions[sid()], feed: [awaiting(steps) as FeedItem] } } })); };
const steps = () => planItem()!.plan.steps as unknown as Array<{ kind: string; prompt: string; modelRef: string; settings: Record<string, unknown> }>;

describe('plan card settings', () => {
  beforeEach(setup);

  it('(c) planSections derives one section per generation kind from the steps (images first); none outside Auto', () => {
    put([vid('v1'), img('i1'), img('i2'), { id: 'o', kind: 'op', op: 'upscale', input: 'i1' }]);
    const secs = planSections(st().feed, planItem()!);
    expect(secs.map((x) => [x.kind, x.count, x.recommended.modelRef])).toEqual([['image', 2, ATLAS], ['video', 1, VID]]);
    expect(secs[1].recommended).toMatchObject({ duration: 5, aspect: '16:9', resolution: '1080p' });
    expect(planSections(st().feed, { ...planItem()!, style: 'guided' } as PlanFeedItem)).toEqual([]);
  });

  it('(d) changePlanChoice applies model, duration and aspect to the steps of that kind and updates agent.settings', async () => {
    put([img('i1'), img('i2'), vid('v1')]);
    // No agent engine reply is needed: the model has no prompt guide and the rewrite answers with a default text; a bad one leaves prompts as they are.
    script = ['{"i1":"new 1","i2":"new 2"}'];
    await changePlanChoice(sid(), 'pl1', 'image', { modelRef: LITE, aspect: '3:4', count: 2, needsImage: false });
    expect(steps().filter((x) => x.kind === 'image').map((x) => [x.modelRef, x.settings.aspect, x.settings.count])).toEqual([[LITE, '3:4', 2], [LITE, '3:4', 2]]);
    expect(steps().find((x) => x.kind === 'video')).toMatchObject({ modelRef: VID, settings: { aspect: '16:9', duration: 5 } });
    expect(st().agent.settings?.image).toMatchObject({ modelRef: LITE, aspect: '3:4', count: 2 });
    script = ['{"v1":"clip rewritten"}'];
    await changePlanChoice(sid(), 'pl1', 'video', { modelRef: VID, aspect: '9:16', duration: 8, resolution: '1080p', needsImage: false });
    expect(steps().find((x) => x.kind === 'video')).toMatchObject({ modelRef: VID, settings: { aspect: '9:16', duration: 8 } });
    expect(st().agent.settings?.video).toMatchObject({ aspect: '9:16', duration: 8 });
  });

  it('(e) rewritePrompts replaces only the prompts and clears busy; a bad answer sets failed and leaves them unchanged', async () => {
    put([img('i1'), img('i2'), vid('v1')]);
    const id = planItem()!.id;
    script = ['```json\n{"i1":"rewritten one","i2":"rewritten two","v1":"must not apply"}\n```'];
    const pending = rewritePrompts(sid(), id, 'image');
    expect(usePlanRewrite.getState().busy[id]).toBe(true);
    await pending;
    expect(usePlanRewrite.getState().busy[id]).toBe(false);
    expect(usePlanRewrite.getState().failed[id]).toBeFalsy();
    expect(steps().map((x) => x.prompt)).toEqual(['rewritten one', 'rewritten two', 'clip v1']);
    expect(steps().map((x) => x.modelRef)).toEqual([ATLAS, ATLAS, VID]);

    script = ['I cannot do that'];
    await rewritePrompts(sid(), id, 'image');
    expect(usePlanRewrite.getState().busy[id]).toBe(false);
    expect(usePlanRewrite.getState().failed[id]).toMatch(/not rewritten/);
    expect(steps().map((x) => x.prompt)).toEqual(['rewritten one', 'rewritten two', 'clip v1']);
    expect(calls).toBe(2);
  });

  it('(f) changePlanDraft("draft") locks the lowest resolution on the video steps', () => {
    put([vid('v1'), vid('v2', { settings: { aspect: '16:9', duration: 5, resolution: '720p', advanced: {} } }), img('i1')]);
    changePlanDraft(sid(), 'pl1', 'draft');
    expect(steps().filter((x) => x.kind === 'video').map((x) => x.settings.resolution)).toEqual(['480p', '480p']);
    expect(st().agent.draftMode).toMatchObject({ kind: 'draft', locked: true });
    expect(steps().find((x) => x.kind === 'image')?.settings).toMatchObject({ aspect: '1:1' });
  });
});

describe('Auto: which model and values, without a card (sandbox session 2026-10-24)', () => {
  beforeEach(setup);
  const withAspects = () => useStore.setState((s) => ({ catalog: { ...s.catalog, schemas: Object.fromEntries(Object.entries(s.catalog.schemas).map(([r, sc]) => [r, r === ATLAS || r === LITE ? { ...sc, params: [{ key: 'aspect_ratio', label: 'Aspect', role: 'aspect', type: 'enum', options: ['1:1', '16:9', '4:3', '9:16'], default: '1:1' }] } as ModelSchema : sc])) } }));

  it('(g) a model switch keeps the values this request asked for, not the ones confirmed before', async () => {
    withAspects();
    script = [ask({ model: 'nano banana 2 lite', aspect: '4:3' }), proposal(LITE)];
    await sendAgentMessage('Ahora con nano banana 2 lite, en 4:3');
    expect(settingsItems()[0].sections[0].chosen).toMatchObject({ modelRef: LITE, aspect: '4:3' });
  });

  it('(h) no model named: the one picked in the composer is the model, not the confirmed one', async () => {
    useStore.setState((s) => ({ composer: { ...s.composer, image: { ...s.composer.image, modelRef: LITE }, userPicked: { ...(s.composer.userPicked ?? {}), image: true } } }));
    script = [ask({ model: ATLAS }), proposal()];
    await sendAgentMessage('Una imagen de un faro');
    expect(settingsItems()[0].sections[0].chosen?.modelRef).toBe(LITE);
  });

  it('(i) a model named in the request wins over the composer pick', async () => {
    useStore.setState((s) => ({ composer: { ...s.composer, image: { ...s.composer.image, modelRef: LITE }, userPicked: { ...(s.composer.userPicked ?? {}), image: true } }, sessions: { ...s.sessions, [sid()]: { ...st(), agent: { ...st().agent, settings: undefined } } } }));
    script = [ask({ model: ATLAS }), proposal(ATLAS)];
    await sendAgentMessage('Una imagen de un faro con nano banana 2');
    expect(settingsItems()[0].sections[0].chosen?.modelRef).toBe(ATLAS);
  });
});
