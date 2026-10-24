import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The agent knows what a model takes before it plans (modelLimits): lengths, resolutions and shapes come with
 * find_models and confirm_settings; a length the model cannot make in one clip stops the plan with the options to ask
 * (several clips, a model that reaches it, one shorter clip); a resolution it lacks is told in one line.
 * Sandbox session 2026-10-24: 480p and 12 s asked of Seedance 2.0 Mini (720p/1080p, 5–12 s at NanoGPT).
 */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { askedSeconds, durationProblem, limitsLine, resolutionNote } from '../src/engine/agent/modelLimits';
import { describeIndexed } from '../src/engine/agent/modelIndex';
import { useStore } from '../src/store/store';
import type { ModelSchema, ModelSummary } from '../src/engine/types';

const SEED = 'nanogpt::bytedance-seedance-2-0-mini';
const LONG = 'nanogpt::kling-v3-long';
const before = useStore.getState();
afterEach(() => useStore.setState(before));

const video = (ref: string, name: string, secs: string[], res: string[]): [ModelSummary, ModelSchema] => [
  { ref, id: ref.split('::')[1], provider: 'nanogpt', kind: 'video', name, acceptsText: true, acceptsImage: true, tags: [] } as unknown as ModelSummary,
  { ref, source: 'catalog', slots: { prompt: 'prompt' }, params: [
    { key: 'resolution', label: 'Resolution', role: 'resolution', type: 'enum', options: res },
    { key: 'duration', label: 'Duration', role: 'duration', type: 'enum', options: secs },
    { key: 'aspect_ratio', label: 'Aspect', role: 'aspect', type: 'enum', options: ['16:9', '9:16', '4:3'] },
  ] } as unknown as ModelSchema,
];

function setup(withLong = true) {
  const list = [video(SEED, 'Seedance 2.0 Mini', ['5', '6', '7', '8', '9', '10', '11', '12'], ['720p', '1080p']), ...(withLong ? [video(LONG, 'Kling 3.0 Long', ['30', '60'], ['480p'])] : [])];
  const s = useStore.getState();
  useStore.setState({
    settings: { ...s.settings, keys: { ...s.settings.keys, nanogpt: 'k' } },
    catalog: { ...s.catalog, models: { ...s.catalog.models, ...Object.fromEntries(list.map(([m]) => [m.ref, m])) }, schemas: { ...s.catalog.schemas, ...Object.fromEntries(list.map(([m, sc]) => [m.ref, sc])) } },
  });
}

describe('model limits for the agent', () => {
  beforeEach(() => setup());

  it('limitsLine and find_models say what the model takes', () => {
    expect(limitsLine(SEED)).toBe('720p, 1080p · 5–12 s · 16:9, 9:16, 4:3');
    expect(describeIndexed(useStore.getState().catalog.models[SEED])).toContain('takes: 720p, 1080p · 5–12 s');
  });

  it('askedSeconds reads the user words', () => {
    expect(askedSeconds('un video de 45 segundos')).toBe(45);
    expect(askedSeconds('hazlo en 12 s, 4:3')).toBe(12);
    expect(askedSeconds('1 minuto de trote')).toBe(60);
    expect(askedSeconds('dos chicas en 1080p')).toBeUndefined();
  });

  it('a length over the clip maximum stops the plan with the three ways on', () => {
    const why = durationProblem(SEED, 12, 'Haz un video de 45 segundos', false)!;
    expect(why).toMatch(/^Not confirmed: 45 s were asked, but Seedance 2.0 Mini makes clips of at most 12 s/);
    expect(why).toContain('4 clips de unos 12 s unidos');
    expect(why).toContain('Kling 3.0 Long (nanogpt::kling-v3-long)');
    expect(why).toContain('Un solo clip de 12 s');
    expect(why).toContain('ask_questions');
  });

  it('no other model reaches it: no switch option', () => {
    setup(false);
    useStore.setState((s) => ({ catalog: { ...s.catalog, models: Object.fromEntries(Object.entries(s.catalog.models).filter(([r]) => r !== LONG)) } }));
    expect(durationProblem(SEED, 45, '', false)).not.toContain('Cambiar a un modelo');
  });

  it('fits, or the user already answered: it goes on (a length the model cannot take still comes back)', () => {
    expect(durationProblem(SEED, 12, 'un video de 12 segundos', false)).toBeUndefined();
    expect(durationProblem(SEED, 12, 'un video de 45 segundos', true)).toBeUndefined();
    expect(durationProblem(SEED, 45, 'un video de 45 segundos', true)).toMatch(/at most 12 s per clip/);
  });

  it('a resolution the model lacks is told in one line; one it has says nothing', () => {
    expect(resolutionNote(SEED, 'con seedance 2.0 mini 480p')).toContain('asked for 480p; Seedance 2.0 Mini has 720p, 1080p');
    expect(resolutionNote(SEED, 'en 1080p')).toBe('');
  });
});

import { sendAgentMessage } from '../src/engine/agent/runtime';
describe('confirm_settings in Auto: the length gate and the visible check', () => {
  beforeEach(() => setup());
  afterEach(() => vi.unstubAllGlobals());

  it('45 s asked of a 12 s model: no settings, the agent gets the options, and the check shows among the actions', async () => {
    const sent: string[] = [];
    const replies = [
      { name: 'confirm_settings', args: { parts: [{ kind: 'video', duration: 45, model: SEED }] } },
      'Seedance llega a 12 s por clip: ¿4 clips unidos, otro modelo o un clip de 12 s?',
    ];
    vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (!body.messages) return new Response(JSON.stringify({ data: [] }));
      sent.push(JSON.stringify(body.messages));
      const r = replies.shift() ?? 'ok';
      const chunk = typeof r === 'string' ? { choices: [{ delta: { content: r }, finish_reason: 'stop' }] } : { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: r.name, arguments: JSON.stringify(r.args) } }] }, finish_reason: 'tool_calls' }] };
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    });
    const s = useStore.getState();
    const sid = s.activeSessionId;
    useStore.setState({
      settings: { ...s.settings, agent: { ...s.settings.agent, provider: 'nanogpt', model: 'm' } },
      composer: { ...s.composer, agentStyle: 'auto', attachments: [], video: { ...s.composer.video, modelRef: SEED } },
      sessions: { ...s.sessions, [sid]: { ...s.sessions[sid], feed: [], agent: { history: [], questionRound: 0, notes: [], busy: false } } },
    });
    await sendAgentMessage('Un video de dos chicas trotando, 45 segundos, con seedance 2.0 mini');
    const feed = useStore.getState().sessions[sid].feed;
    expect(feed.some((f) => f.type === 'settings')).toBe(false);
    expect(sent[1]).toContain('Not confirmed: 45 s were asked');
    // The mocked provider lists come back empty, so the label may show the ref; the limits are what the user reads.
    const acts = JSON.stringify(feed.filter((f) => f.type === 'activity'));
    expect(acts).toContain('"label":"Checked ');
    expect(acts).toContain('720p, 1080p · 5–12 s');
  });
});
