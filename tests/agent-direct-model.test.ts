import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * Direct runs the composer's models and the agent gets their guides, even after a card was confirmed earlier in the
 * session (Auto or Guided). Recorded Atlas catalog, stubbed LLM: nothing reaches a provider.
 */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import { atlas } from '../src/engine/providers/atlas';
import { sendAgentMessage } from '../src/engine/agent/runtime';
import { directModelRefs, earlyModelGuide } from '../src/engine/agent/requestGuides';
import { useStore } from '../src/store/store';
import { serve } from './fixtures/live/serve';
import type { AgentStyle, ImageStep, PlanFeedItem } from '../src/engine/types';

const NANO = 'atlas::google/nano-banana-2/text-to-image-developer';
const SEEDREAM = 'atlas::bytedance/seedream-v5.0-pro/text-to-image';
const before = useStore.getState();
afterEach(() => { vi.unstubAllGlobals(); useStore.setState(before); });

async function run(opts: { style: AgentStyle; confirmed?: string; userPicked: boolean; planModel?: string; text?: string; steps?: unknown[] }) {
  vi.stubGlobal('location', { href: 'http://localhost/' });
  const sent: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (!body.messages) return new Response(JSON.stringify(serve(String(url))));
    sent.push(JSON.stringify(body.messages));
    const step = { id: 's1', kind: 'image', title: 'Imagen', prompt: 'a red bicycle', count: 1, ...(opts.planModel ? { model: opts.planModel } : {}) };
    const delta = sent.length > 1
      ? { content: 'Listo.' }
      : { tool_calls: [{ index: 0, id: 'p', function: { name: 'propose_plan', arguments: JSON.stringify({ title: 't', steps: opts.steps ?? [step] }) } }] };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: sent.length > 1 ? 'stop' : 'tool_calls' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  });
  const models = await atlas.listModels(undefined);
  const schemas = Object.fromEntries(await Promise.all(models.filter((m) => [NANO, SEEDREAM].includes(m.ref)).map(async (m) => [m.ref, await atlas.loadSchema(m, undefined)])));
  const sid = before.activeSessionId;
  useStore.setState({
    settings: { ...before.settings, keys: { ...before.settings.keys, atlas: 'fixture', nanogpt: 'fixture' }, agent: { ...before.settings.agent, provider: 'nanogpt', model: 'fixture' } },
    composer: { ...before.composer, agentStyle: opts.style, attachments: [], image: { ...before.composer.image, modelRef: NANO }, userPicked: { ...(before.composer.userPicked ?? {}), image: opts.userPicked } },
    catalog: { ...before.catalog, models: Object.fromEntries(models.map((m) => [m.ref, m])), schemas },
    sessions: { ...before.sessions, [sid]: { ...before.sessions[sid], feed: [], agent: { busy: false, questionRound: 0, notes: [], history: [], ...(opts.confirmed ? { settings: { image: { modelRef: opts.confirmed, needsImage: false, resolution: '1k', aspect: '1:1', count: 1 } } } : {}) } } },
  });
  await sendAgentMessage(opts.text ?? 'Una imagen de una bicicleta roja');
  const plan = useStore.getState().sessions[sid].feed.find((f) => f.type === 'plan') as PlanFeedItem | undefined;
  return { model: plan ? (plan.plan.steps[0] as ImageStep).modelRef : undefined, plan, first: sent[0] ?? '' };
}

describe('Direct runs the composer model, not one confirmed earlier in the session', () => {
  it('a card confirmed in Auto does not replace the composer model in Direct, and the guide matches the model that runs', async () => {
    for (const userPicked of [true, false]) {
      const r = await run({ style: 'direct', confirmed: SEEDREAM, userPicked });
      expect(r.model).toBe(NANO);
      expect(r.first).toContain('(model:nano-banana)');
      expect(r.first).not.toContain('(model:seedream)');
    }
  });

  it('a model the plan names is not run in Direct unless the user named it', async () => {
    const r = await run({ style: 'direct', userPicked: false, planModel: SEEDREAM });
    expect(r.model).toBe(NANO);
    const named = await run({ style: 'direct', userPicked: false, planModel: SEEDREAM, text: 'Una bicicleta roja con Seedream 5.0 Pro' });
    expect(named.model).toBe(SEEDREAM);
  });

  it('Auto keeps the confirmed model, as before', async () => {
    const r = await run({ style: 'auto', confirmed: SEEDREAM, userPicked: true });
    expect(r.model).toBe(SEEDREAM);
  });
});

describe('Direct video guides follow the models that can run', () => {
  it('the per-route video models count, a session confirmation does not', () => {
    const sid = before.activeSessionId;
    useStore.setState({
      composer: { ...before.composer, agentStyle: 'direct', attachments: [], video: { ...before.composer.video, modelRef: 'nanogpt::seedance-2.0' }, videoRoutes: { image: 'atlas::kwaivgi/kling-v3.0-pro/image-to-video' } },
      sessions: { ...before.sessions, [sid]: { ...before.sessions[sid], agent: { ...before.sessions[sid].agent, settings: { video: { modelRef: 'atlas::alibaba/wan-3.0/text-to-video', needsImage: false } } } } },
    });
    expect(directModelRefs(sid, 'video')).toEqual(expect.arrayContaining(['nanogpt::seedance-2.0', 'atlas::kwaivgi/kling-v3.0-pro/image-to-video']));
    expect(earlyModelGuide(sid, 'model:seedance')).toBeUndefined();
    expect(earlyModelGuide(sid, 'model:kling')).toBeUndefined();
    expect(earlyModelGuide(sid, 'model:wan')).toContain('direct mode');
  });
});

describe('a chained upscale reads the source size from the step it comes from', () => {
  it('"súbela a 4K" on a generated 1K image is ×4, without a question', async () => {
    const steps = [
      { id: 's1', kind: 'image', title: 'Imagen', prompt: 'a red bicycle', count: 1 },
      { id: 's2', kind: 'op', op: 'upscale', input: 's1' },
    ];
    const r = await run({ style: 'direct', userPicked: true, text: 'Una bicicleta roja y súbela a 4K', steps });
    const s1 = r.plan!.plan.steps[0] as ImageStep;
    const s2 = r.plan!.plan.steps[1] as unknown as { params: Record<string, string> };
    expect(String(s1.settings.resolution).toLowerCase()).toBe('1k');
    expect(s2.params.factor).toBe('4');
    expect(r.plan!.plan.adjustments.join(' ')).not.toContain('source size is unknown');
  });
});

