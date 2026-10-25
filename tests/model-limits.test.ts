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
    catalog: { ...s.catalog, status: { ...s.catalog.status, nanogpt: 'ready' }, models: { ...s.catalog.models, ...Object.fromEntries(list.map(([m]) => [m.ref, m])) }, schemas: { ...s.catalog.schemas, ...Object.fromEntries(list.map(([m, sc]) => [m.ref, sc])) } },
  });
}

describe('model limits for the agent', () => {
  beforeEach(() => setup());

  it('limitsLine and find_models say what the model takes', () => {
    expect(limitsLine(SEED)).toBe('720p, 1080p · 5–12 s · 16:9, 9:16, 4:3 · no reference images');
    expect(describeIndexed(useStore.getState().catalog.models[SEED])).toContain('takes: 720p, 1080p · 5–12 s');
  });

  it('a model that takes one start image says so before the plan is written (2026-10-24: three images on Seedance 2.0 Mini at OpenRouter)', () => {
    const s = useStore.getState();
    const schema = s.catalog.schemas[SEED];
    useStore.setState({ catalog: { ...s.catalog, schemas: { ...s.catalog.schemas, [SEED]: { ...schema, slots: { ...schema.slots, firstFrame: { key: 'image' } } } as ModelSchema } } });
    expect(limitsLine(SEED)).toContain('1 start image, no reference images');
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

import { sendAgentMessage, submitAnswers } from '../src/engine/agent/runtime';
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

/*
 * Auto resolves what the agent skipped (2026-10-24): a plan with video before any settings makes the app run the
 * confirm path, quality words win over the inherited draft choice, the duration question reaches the user even once
 * the round is used, and a turn that really fails says why and how to go on.
 */
import type { FeedItem, PlanFeedItem, SettingsFeedItem } from '../src/engine/types';
type Reply = { name: string; args: unknown } | string;
const sidOf = () => useStore.getState().activeSessionId;
const feedOf = (): FeedItem[] => useStore.getState().sessions[sidOf()].feed;
const agentOf = () => useStore.getState().sessions[sidOf()].agent;

/** Runs one request in Auto (or `style`) with scripted agent replies; returns what each model call was sent and the plan cards seen at that moment. */
async function drive(replies: Reply[], text: string, over: { style?: 'auto' | 'guided'; agent?: Record<string, unknown>; feed?: FeedItem[] } = {}) {
  const sent: string[] = [];
  const plansSeen: number[] = [];
  vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (!body.messages) return new Response(JSON.stringify({ data: [] }));
    sent.push(JSON.stringify(body.messages));
    plansSeen.push(feedOf().filter((f) => f.type === 'plan').length);
    const r = replies.shift() ?? 'ok';
    const chunk = typeof r === 'string' ? { choices: [{ delta: { content: r }, finish_reason: 'stop' }] } : { choices: [{ delta: { tool_calls: [{ index: 0, id: `c${sent.length}`, function: { name: r.name, arguments: JSON.stringify(r.args) } }] }, finish_reason: 'tool_calls' }] };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  });
  const s = useStore.getState();
  const sid = s.activeSessionId;
  useStore.setState({
    settings: { ...s.settings, agent: { ...s.settings.agent, provider: 'nanogpt', model: 'm' } },
    composer: { ...s.composer, agentStyle: over.style ?? 'auto', attachments: [], video: { ...s.composer.video, modelRef: SEED } },
    sessions: { ...s.sessions, [sid]: { ...s.sessions[sid], feed: over.feed ?? [], agent: { history: [], questionRound: 0, notes: [], busy: false, ...over.agent } } },
  });
  await sendAgentMessage(text);
  return { sent, plansSeen };
}
/** The user answers the open questions card, which resumes the turn (a request whose question round is now used). */
async function answer(): Promise<void> {
  const q = feedOf().find((f) => f.type === 'questions' && f.status === 'pending')!;
  await submitAnswers(sidOf(), q.id, { q1: 'Un solo clip de 12 s' });
}
const videoPlan = (prompt = 'a runner on a beach') => ({ name: 'propose_plan', args: { title: 'Run', steps: [{ id: 'v1', kind: 'video', title: 'Run', prompt, duration: 5, aspect: '16:9' }] } });
const settingsItems = () => feedOf().filter((f): f is SettingsFeedItem => f.type === 'settings');
const plans = () => feedOf().filter((f): f is PlanFeedItem => f.type === 'plan');

describe('Auto: a plan sent before any settings makes the app confirm them (item 2)', () => {
  beforeEach(() => setup());
  afterEach(() => vi.unstubAllGlobals());

  it('propose_plan with video and no confirmation that fits the chosen settings: the app confirms them and shows that plan, written once (2026-10-24)', async () => {
    await drive([{ ...videoPlan('a runner at dawn, slow dolly'), args: { ...videoPlan().args, steps: [{ ...videoPlan().args.steps[0], prompt: 'a runner at dawn, slow dolly', duration: undefined, aspect: undefined }] } }, 'listo'], 'Un video de un corredor en la playa');
    expect(settingsItems()).toHaveLength(1);
    expect(plans()).toHaveLength(1);
    expect((plans()[0].plan.steps[0] as { prompt: string }).prompt).toContain('dolly');
  });

  it('propose_plan with video and no confirmation in a frame the model lacks: the app confirms, the agent gets the guide and writes the prompts again, then the plan card appears', async () => {
    const { sent, plansSeen } = await drive([{ ...videoPlan(), args: { ...videoPlan().args, steps: [{ ...videoPlan().args.steps[0], aspect: '1:1' }] } }, videoPlan('a runner at dawn, slow dolly'), 'listo'], 'Un video de un corredor en la playa');
    expect(settingsItems()).toHaveLength(1);
    expect(settingsItems()[0]).toMatchObject({ status: 'confirmed', inline: true, sections: [{ chosen: { modelRef: SEED } }] });
    // The second model call carries the app's answer to the first plan; no plan card existed yet.
    expect(sent[1]).toContain('Prompting guide of ');
    expect(sent[1]).toContain('call propose_plan again');
    expect(sent[1]).not.toContain('Not shown: call confirm_settings');
    expect(plansSeen[1]).toBe(0);
    expect(plans()).toHaveLength(1);
    expect((plans()[0].plan.steps[0] as { modelRef: string }).modelRef).toBe(SEED);
    expect((plans()[0].plan.steps[0] as { prompt: string }).prompt).toContain('dolly');
  });

  it('the app confirming settings gives the round back: guides read, two invalid plans and the settings step still end in a plan card (2026-10-24 sandbox)', async () => {
    const guide = { name: 'read_guide', args: { id: 'model:seedance', ready: true } };
    const long = videoPlan('x'.repeat(4001));
    await drive([guide, guide, long, videoPlan(), long, videoPlan('a runner at dawn, slow dolly'), 'listo'], 'Un video de un corredor en la playa');
    expect(plans()).toHaveLength(1);
    expect(feedOf().some((f) => f.type === 'notice')).toBe(false);
  });

  it('Guided keeps its gate: no inline item, the old message', async () => {
    const q = { name: 'ask_questions', args: { questions: [{ id: 'q1', question: '¿Cómo?', options: ['a', 'b'] }] } };
    const replies: Reply[] = [q];
    await drive(replies, 'Un video de un corredor', { style: 'guided' });
    replies.push(videoPlan(), 'ok');
    await answer();
    expect(settingsItems()).toHaveLength(0);
    expect(agentOf().history.map((m) => String(m.content)).join('\n')).toContain('Not shown: call confirm_settings first');
  });
});

describe('Auto: requested quality takes effect (item 4)', () => {
  beforeEach(() => setup());
  afterEach(() => vi.unstubAllGlobals());
  const ask = () => ({ name: 'confirm_settings', args: { parts: [{ kind: 'video', duration: 5 }] } });
  /** An earlier request of the session confirmed high quality. */
  const hq = (): FeedItem[] => [{ id: 'old', createdAt: 0, workspace: 'chat', type: 'settings', status: 'confirmed', inline: true, sections: [], draft: { kind: 'hq', locked: false } } as unknown as FeedItem];

  it('a new session asking "en alta calidad" gets hq, not the locked draft resolution', async () => {
    await drive([ask(), 'ok'], 'Un video de un corredor en alta calidad');
    expect(settingsItems()[0].draft).toMatchObject({ kind: 'hq', locked: false });
    expect(agentOf().draftMode).toMatchObject({ kind: 'hq' });
    expect(settingsItems()[0].sections[0].chosen?.resolution).not.toBe('720p');
  });
  it('"borrador" over a previous hq goes back to the draft', async () => {
    await drive([ask(), 'ok'], 'Ahora un borrador de un corredor', { feed: hq() });
    expect(settingsItems().at(-1)?.draft).toMatchObject({ kind: 'draft', locked: true });
  });
  it('a request with no quality words keeps the previous hq; with no previous choice it is Borrador', async () => {
    await drive([ask(), 'ok'], 'Un video de un corredor', { feed: hq() });
    expect(settingsItems().at(-1)?.draft).toMatchObject({ kind: 'hq' });
    await drive([ask(), 'ok'], 'Un video de un corredor');
    expect(settingsItems().at(-1)?.draft).toMatchObject({ kind: 'draft', locked: true });
  });
  it('"cambia la resolución" alone keeps the previous choice', async () => {
    await drive([ask(), 'ok'], 'cambia la resolución del corredor', { feed: hq() });
    expect(settingsItems().at(-1)?.draft).toMatchObject({ kind: 'hq' });
  });
});

describe('Auto: the duration question reaches the user (item 5)', () => {
  beforeEach(() => setup());
  afterEach(() => vi.unstubAllGlobals());
  const over = { name: 'confirm_settings', args: { parts: [{ kind: 'video', duration: 45, model: SEED }] } };
  const question = { name: 'ask_questions', args: { questions: [{ id: 'q1', question: '¿Cómo seguimos?', options: ['4 clips unidos', 'Un solo clip de 12 s'] }] } };
  /** A request whose one question round is used: a first card, answered. */
  const roundUsed = async (second: Reply[], text: string) => {
    const replies: Reply[] = [question];
    await drive(replies, text);
    replies.push(...second);
    await answer();
  };

  it('with the question round already used, ask_questions still produces the card', async () => {
    await roundUsed([over, question, 'ok'], 'Un video de 45 segundos con seedance 2.0 mini');
    expect(feedOf().filter((f) => f.type === 'questions' && f.status === 'pending')).toHaveLength(1);
    expect(agentOf().history.map((m) => String(m.content)).join('')).not.toContain('Question rounds are used up');
  });
  it('without a duration problem the used-up rule still refuses the question', async () => {
    await roundUsed([{ name: 'confirm_settings', args: { parts: [{ kind: 'video', duration: 5 }] } }, question, 'ok'], 'Un video de 5 segundos');
    expect(feedOf().filter((f) => f.type === 'questions' && f.status === 'pending')).toHaveLength(0);
    expect(agentOf().history.map((m) => String(m.content)).join('')).toContain('Question rounds are used up');
  });
  it('the text confirms settings before it plans the clips', () => {
    const why = durationProblem(SEED, 12, 'Haz un video de 45 segundos', false)!;
    expect(why.indexOf('call confirm_settings again')).toBeGreaterThan(-1);
    expect(why.indexOf('call confirm_settings again')).toBeLessThan(why.indexOf('plan the clips'));
  });
});

import { earlyModelGuide } from '../src/engine/agent/requestGuides';
import { rejectionOf, stoppedText } from '../src/engine/agent/stopNotice';
describe('a model the app keeps is said, not offered again (item 3)', () => {
  beforeEach(() => setup());
  const confirmed = (style: 'auto' | 'guided') => {
    const s = useStore.getState();
    const id = s.activeSessionId;
    useStore.setState({ composer: { ...s.composer, agentStyle: style }, sessions: { ...s.sessions, [id]: { ...s.sessions[id], agent: { ...s.sessions[id].agent, history: [], settings: { video: { modelRef: SEED, needsImage: false, duration: 5 } } } } } });
    return id;
  };
  it('Auto: states the model kept and why, and never asks for confirm_settings', () => {
    const text = earlyModelGuide(confirmed('auto'), 'model:kling')!;
    expect(text).toContain('keeps Seedance 2.0 Mini');
    expect(text).toContain('the user did not name another model');
    expect(text).not.toContain('confirm_settings');
  });
  it('Guided keeps its text', () => {
    expect(earlyModelGuide(confirmed('guided'), 'model:kling')).toContain('To use another model, call confirm_settings again.');
  });
});

describe('the notice of a turn that really fails (item 6)', () => {
  beforeEach(() => setup());
  afterEach(() => vi.unstubAllGlobals());

  it('a scripted agent that keeps hitting the length limit ends with the code and an explanation', async () => {
    const over = { name: 'confirm_settings', args: { parts: [{ kind: 'video', duration: 45, model: SEED }] } };
    await drive([over, over, over, over, over, over], 'Un video de 45 segundos con seedance 2.0 mini');
    const note = feedOf().filter((f) => f.type === 'notice').at(-1) as { text: string; level: string };
    expect(note.level).toBe('error');
    expect(note.text).toContain('No pude preparar el plan: Seedance 2.0 Mini admite hasta 12 s por clip.');
    expect(note.text).toContain('Código: DURACION');
    expect(note.text).not.toContain('stopped after several attempts');
  });

  it('known causes map to a code; the rest is GENERAL; raw errors are never dumped', () => {
    const code = (t?: string) => /Código: (\w+)$/.exec(stoppedText(t))?.[1];
    expect(code('Not confirmed: 45 s were asked, but Seedance 2.0 Mini makes clips of at most 12 s (it takes 720p).')).toBe('DURACION');
    expect(code('Not confirmed: Seedance 2.0 Mini takes at most 12 s per clip (720p).')).toBe('DURACION');
    expect(code('Not shown: call confirm_settings first (kind "video") so the user')).toBe('AJUSTES');
    expect(code('video: Unknown model "Foo". Call find_models')).toBe('MODELO');
    expect(code('Plan rejected by the validator. Fix these problems:\n- Step v1: x')).toBe('PLAN');
    expect(code('Invalid propose_plan input: [{"code":"invalid_type"}]')).toBe('PLAN');
    expect(code('Graph actions work only on the node canvas.')).toBe('CANVAS');
    expect(code('something else')).toBe('GENERAL');
    expect(code(undefined)).toBe('GENERAL');
    expect(stoppedText('Invalid propose_plan input: [{"code":"invalid_type","path":["steps"]}]')).not.toContain('invalid_type');
  });

  it('the app confirming settings itself is a flow step, not a rejection', () => {
    expect(rejectionOf('Settings chosen by the app (Auto shows no settings card): ...\nNow write the prompts and call propose_plan.')).toBeUndefined();
    expect(rejectionOf('Not shown: call confirm_settings first')).toBeDefined();
  });
});
