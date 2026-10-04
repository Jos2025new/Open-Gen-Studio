import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* Phase 2: settings confirmed before prompts are written (better-worflows-xyz765). */

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));

import { local, LOCAL_IMAGE_REF, LOCAL_VIDEO_REF } from '../src/engine/providers/demo';
import { normalizePlan, type PlanContext } from '../src/engine/plan';
import { buildSettings } from '../src/engine/agent/settingsCard';
import { sendAgentMessage } from '../src/engine/agent/runtime';
import { useStore } from '../src/store/store';
import type { MediaKind, SettingsChoice, VideoStep } from '../src/engine/types';

const models = await local.listModels(undefined);
const getModel = async (ref: string) => {
  const model = models.find((m) => m.ref === ref);
  return model ? { model, schema: await local.loadSchema(model, undefined) } : null;
};
const base: PlanContext = {
  workspace: 'chat',
  getModel,
  defaultModel: (kind: MediaKind) => (kind === 'image' ? LOCAL_IMAGE_REF : LOCAL_VIDEO_REF),
  defaultSettings: () => ({}),
  asset: () => undefined,
  layer: () => undefined,
};

describe('confirmed settings win over what the plan wrote', () => {
  it('model, duration and aspect come from the confirmation, with a note when the plan differed', async () => {
    const confirmed: SettingsChoice = { modelRef: LOCAL_VIDEO_REF, duration: 8, aspect: '9:16', needsImage: false };
    const { plan, errors } = await normalizePlan({ steps: [{ id: 's1', kind: 'video', prompt: 'she walks in', duration: 5, aspect: '16:9' }] }, { ...base, confirmed: (k) => (k === 'video' ? confirmed : undefined) }, 'p');
    expect(errors).toEqual([]);
    const s1 = plan!.steps[0] as VideoStep;
    expect(s1.modelRef).toBe(LOCAL_VIDEO_REF);
    expect(plan!.adjustments.join(' ')).toMatch(/s1: aspect 16:9 → 9:16 \(confirmed\)/);
  });
});

describe('the settings card', () => {
  it('pixel sizes show as size tier + ratio, the same split as the composer and the nodes', async () => {
    const { defaultChoice, settingsOptions, sizeName } = await import('../src/engine/agent/settingsCard');
    const sizes = ['2048*2048', '2368*1776', '1776*2368', '2816*1584', '1584*2816', '1024*1024', '1536*1536', '2048*1152', '1152*2048'];
    const schema = { ref: 'x', params: [{ key: 'size', label: 'Size', role: 'aspect', type: 'enum', options: sizes }], slots: {} } as never;
    const opts = settingsOptions(schema, 'image');
    expect(opts.px?.tiers).toEqual(['1K', '1.5K', '2K']);
    expect(opts.px?.ratios).toContain('16:9');
    const c = defaultChoice('m', schema, { kind: 'image', aspect: '16:9', startImage: false });
    expect(sizeName(c.aspect!)).toBe('1.5K 16:9');
  });
  it('recommends a model the user named and lists only models that take the same inputs', async () => {
    const built = await buildSettings(
      { kind: 'video', purpose: 'normal', startImage: false, refs: 0, count: 2, duration: 5, model: LOCAL_VIDEO_REF },
      { getModel, suggestModel: () => undefined, composerChosen: () => false, routeModel: () => undefined, defaultModel: () => LOCAL_VIDEO_REF },
    );
    expect('error' in built).toBe(false);
    if ('error' in built) return;
    expect(built.recommended.modelRef).toBe(LOCAL_VIDEO_REF);
    expect(built.alternatives).not.toContain(LOCAL_VIDEO_REF);
  });
  it('an unknown model is an error for the agent, not a silent swap', async () => {
    const built = await buildSettings(
      { kind: 'video', purpose: 'normal', startImage: false, refs: 0, count: 1, model: 'nope::x' },
      { getModel, suggestModel: () => undefined, composerChosen: () => false, routeModel: () => undefined, defaultModel: () => LOCAL_VIDEO_REF },
    );
    expect(built).toMatchObject({ error: expect.stringMatching(/Unknown model/) });
  });
});

describe('images to generate', () => {
  it('the card starts at the agent\'s number (1–4) and the plan applies the confirmed one', async () => {
    const { defaultChoice } = await import('../src/engine/agent/settingsCard');
    expect(defaultChoice(LOCAL_IMAGE_REF, undefined, { kind: 'image', count: 3, startImage: false }).count).toBe(3);
    expect(defaultChoice(LOCAL_IMAGE_REF, undefined, { kind: 'image', count: 9, startImage: false }).count).toBe(4);
    const confirmed: SettingsChoice = { modelRef: LOCAL_IMAGE_REF, needsImage: false, count: 1 };
    const { plan } = await normalizePlan({ steps: [{ id: 's1', kind: 'image', prompt: 'a sheet', count: 3 }] }, { ...base, confirmed: (k) => (k === 'image' ? confirmed : undefined) }, 'p');
    expect(plan!.adjustments.join(' ')).toMatch(/s1: count 3 → 1 \(confirmed\)/);
  });
});

describe('candidates that differ', () => {
  it('one variation per result sets the count; a mismatch with the confirmed number is sent back to fix', async () => {
    const steps = [{ id: 's1', kind: 'image', prompt: 'gamer girl, 18-24, sheet', variations: ['short pink hair, oversized hoodie', 'black braids, bomber jacket', 'silver bob, track jacket'] }];
    const ok = await normalizePlan({ steps }, base, 'p');
    expect(ok.errors).toEqual([]);
    expect(ok.plan!.steps[0]).toMatchObject({ variations: steps[0].variations, settings: { count: 3 } });
    const confirmed: SettingsChoice = { modelRef: LOCAL_IMAGE_REF, needsImage: false, count: 2 };
    const bad = await normalizePlan({ steps }, { ...base, confirmed: (k) => (k === 'image' ? confirmed : undefined) }, 'p');
    expect(bad.errors.join(' ')).toMatch(/3 variations but the user confirmed 2 images/);
  });
});

describe('a cited image the step does not carry', () => {
  it('is sent back: the reference was forgotten (a text-to-image step would invent a new person)', async () => {
    const { errors } = await normalizePlan({ steps: [{ id: 's1', kind: 'image', prompt: 'Using image 1 as the character reference, she sits on a sofa' }] }, base, 'p');
    expect(errors.join(' ')).toMatch(/cites "image 1" but the step has no refs/);
    const ok = await normalizePlan({ steps: [{ id: 's1', kind: 'image', prompt: 'a girl on a sofa, image 1 of a series' }] }, base, 'p');
    expect(ok.errors.join(' ')).toMatch(/cites/);
    const text = await normalizePlan({ steps: [{ id: 's1', kind: 'image', prompt: 'a girl on a sofa' }] }, base, 'p');
    expect(text.errors).toEqual([]);
  });
});

describe('candidates end a plan', () => {
  it('a step that uses candidates the user has not picked is sent back (front ×2 → angle views)', async () => {
    const steps = [
      { id: 's1', kind: 'image', prompt: 'front view', variations: ['warm light', 'cool light'] },
      { id: 's2', kind: 'op', op: 'angle', input: 's1', params: { angle: 'back' } },
    ];
    const { plan, errors } = await normalizePlan({ steps }, base, 'p');
    expect(plan).toBeNull();
    expect(errors.join(' ')).toMatch(/s2: uses s1, which makes several images for the user to choose from[\s\S]*end this plan at s1/);
    // One result feeding the next step is fine.
    const one = await normalizePlan({ steps: [{ id: 's1', kind: 'image', prompt: 'front view' }, steps[1]] }, base, 'p');
    expect(one.errors).toEqual([]);
    // An op that makes several (Variations ×2) is candidates too.
    const ops = await normalizePlan({ steps: [{ id: 's1', kind: 'image', prompt: 'a girl' }, { id: 's2', kind: 'op', op: 'variations', input: 's1', params: { count: '2' } }, { id: 's3', kind: 'op', op: 'angle', input: 's2', params: { angle: 'back' } }] }, base, 'p');
    expect(ops.errors.join(' ')).toMatch(/s3: uses s2, which makes several images/);
  });
});

describe('a video plan before the settings are confirmed', () => {
  const sent: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
  let first: { name: string; args: unknown } = { name: 'propose_plan', args: { title: 'Clip', steps: [{ id: 's1', kind: 'video', prompt: 'a cat walks', model: LOCAL_VIDEO_REF }] } };
  beforeEach(() => {
    sent.length = 0;
    let n = 0;
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (!body.messages) return new Response(JSON.stringify({ data: [] }));
      sent.push(body);
      const call = n++ === 0 ? first : null;
      const chunk = call
        ? { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: call.name, arguments: JSON.stringify(call.args) } }] }, finish_reason: 'tool_calls' }] }
        : { choices: [{ delta: { content: 'ok' } }] };
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    });
    const st = useStore.getState();
    const sid = st.activeSessionId;
    useStore.setState({
      settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'm' } },
      composer: { ...st.composer, agentStyle: 'auto', attachments: [] },
      sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], feed: [], agent: { history: [], questionRound: 0, notes: [], busy: false } } },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is not shown: the agent is told to call confirm_settings first', async () => {
    await sendAgentMessage('Haz una animación de un gato');
    const feed = useStore.getState().sessions[useStore.getState().activeSessionId].feed;
    expect(feed.some((f) => f.type === 'plan')).toBe(false);
    const tool = sent[1].messages.filter((m) => m.role === 'tool').map((m) => String(m.content)).join('\n');
    expect(tool).toMatch(/call confirm_settings first \(kind "video"\)/);
  });

  it('a video model guide is not loaded before the model is confirmed', async () => {
    first = { name: 'read_guide', args: { id: 'model:minimax' } };
    await sendAgentMessage('Haz un video UGC');
    const tool = sent[1].messages.filter((m) => m.role === 'tool').map((m) => String(m.content)).join('\n');
    expect(tool).toMatch(/^Not loaded: the video model is not confirmed yet/);
    expect(tool).not.toContain('MiniMax H3');
  });
});

describe('the settings card renders', () => {
  it('shows the recommended model, the other models toggle and the price line', async () => {
    const { renderToString } = await import('react-dom/server');
    const { createElement } = await import('react');
    const { SettingsCard } = await import('../src/components/chat/SettingsCard');
    const html = (renderToString(createElement(SettingsCard, {
      sessionId: useStore.getState().activeSessionId,
      item: { id: 'x', createdAt: 0, workspace: 'chat', type: 'settings', summary: '3 clips', sections: [{ kind: 'image', count: 2, recommended: { modelRef: LOCAL_IMAGE_REF, needsImage: false }, alternatives: [] }, { kind: 'video', count: 3, recommended: { modelRef: LOCAL_VIDEO_REF, duration: 5, needsImage: false }, alternatives: [LOCAL_IMAGE_REF] }], status: 'pending' },
    }))).replace(/<!-- -->/g, '');
    expect(html).toContain('Settings · before the plan is written');
    expect(html).toContain('recommended');
    expect(html).toContain('Show 1 other model');
    expect(html).toContain('The exact cost is shown with the plan');
    expect(html).toContain('from ');
    expect(html).toContain('3 clips');
    // Images before video, each in its own section.
    expect(html.indexOf('Images · 2')).toBeGreaterThan(-1);
    expect(html.indexOf('Images · 2')).toBeLessThan(html.indexOf('Video · 3 clips'));
  });
});

describe('comparing two image models in one plan (A/B)', () => {
  it('each step keeps the confirmed part of the model line it names; nothing folds into the first model', async () => {
    const fake = (ref: string, id: string, name: string) => ({ ref, id, name, provider: 'atlas', kind: 'image' }) as never;
    const table: Record<string, unknown> = {
      'atlas::nb': fake('atlas::nb', 'google/nano-banana-2-lite/text-to-image', 'Nano Banana 2 Lite'),
      'atlas::grok': fake('atlas::grok', 'xai/grok-imagine-image-2.0/text-to-image', 'Grok Imagine Image 2'),
    };
    const ctxModel = async (ref: string) => (table[ref] ? { model: table[ref] as never, schema: { ref, params: [], slots: {} } as never } : getModel(ref));
    const nb: SettingsChoice = { modelRef: 'atlas::nb', needsImage: false, aspect: '3:4', count: 1 };
    const grok: SettingsChoice = { modelRef: 'atlas::grok', needsImage: false, aspect: '3:4', count: 1 };
    const steps = ['nb', 'nb', 'grok', 'grok'].map((m, i) => ({ id: `s${i + 1}`, kind: 'image', prompt: `sheet ${i}`, model: `atlas::${m}` }));
    const { plan, errors } = await normalizePlan({ steps }, { ...base, getModel: ctxModel, confirmed: (k) => (k === 'image' ? nb : undefined), confirmedParts: (k) => (k === 'image' ? [nb, grok] : []) }, 'p');
    expect(errors).toEqual([]);
    expect(plan!.steps.map((s) => (s as { modelRef: string }).modelRef)).toEqual(['atlas::nb', 'atlas::nb', 'atlas::grok', 'atlas::grok']);
    expect(plan!.adjustments.join(' ')).not.toMatch(/→ Nano Banana/);
  });
});
