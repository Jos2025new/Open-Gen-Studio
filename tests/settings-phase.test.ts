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
      item: { id: 'x', createdAt: 0, workspace: 'chat', type: 'settings', kind: 'video', summary: '3 clips', count: 3, recommended: { modelRef: LOCAL_VIDEO_REF, duration: 5, needsImage: false }, alternatives: [LOCAL_IMAGE_REF], status: 'pending' },
    }))).replace(/<!-- -->/g, '');
    expect(html).toContain('Settings · before the plan is written');
    expect(html).toContain('recommended');
    expect(html).toContain('Other models (1)');
    expect(html).toContain('3 clips');
  });
});
