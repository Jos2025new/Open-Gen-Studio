import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { approvePlan, sendAgentMessage } from '../src/engine/agent/runtime';
import { carryOverRevision } from '../src/engine/planRevision';
import { normalizePlan, type PlanContext, type RawPlan } from '../src/engine/plan';
import { useStore } from '../src/store/store';
import type { Plan, PlanFeedItem } from '../src/engine/types';

type Reply = { title: string; revision?: boolean; style?: string; texts: string[] };
const sse = (r: Reply) => {
  const args = JSON.stringify({ title: r.title, revision: r.revision, style: r.style, steps: r.texts.map((t, i) => ({ id: `s${i + 1}`, kind: 'text', text: t })) });
  const chunk = { choices: [{ delta: { tool_calls: [{ index: 0, id: `c${Math.random()}`, function: { name: 'propose_plan', arguments: args } }] }, finish_reason: 'tool_calls' }] };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
};
let replies: Reply[] = [];

beforeEach(() => {
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    return body.messages ? sse(replies.shift() ?? { title: 'x', texts: ['x'] }) : new Response(JSON.stringify({ data: [] }));
  });
  const st = useStore.getState();
  const sid = st.activeSessionId;
  useStore.setState({
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'm' } },
    composer: { ...st.composer, agentStyle: 'direct', attachments: [] },
    sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], feed: [], agent: { history: [], questionRound: 0, notes: [], busy: false } } },
  });
});
afterEach(() => vi.unstubAllGlobals());

const sid = () => useStore.getState().activeSessionId;
const plans = () => useStore.getState().sessions[sid()].feed.filter((f): f is PlanFeedItem => f.type === 'plan');

describe('a revision keeps the style of the plan it replaces', () => {
  it('copies an omitted style and tells the agent when the plan is approved', async () => {
    replies = [{ title: 'Party', style: 'grainy 16mm film, warm tungsten light', texts: ['a', 'b'] }];
    await sendAgentMessage('a party');
    replies = [{ title: 'Party', revision: true, texts: ['a', 'B'] }];
    await sendAgentMessage('change the second');
    const [revised] = plans();
    expect(revised).toMatchObject({ revised: true });
    expect(revised.plan.style).toBe('grainy 16mm film, warm tungsten light');
    expect(revised.plan.adjustments).toContain('Kept the previous style');
    expect(revised.plan.adjustments.join(' ')).not.toContain('You omitted');
    await approvePlan(sid(), revised.id);
    const told = useStore.getState().sessions[sid()].agent.history.some((m) => m.role === 'tool' && typeof m.content === 'string' && /You omitted the style; the previous one was kept/.test(m.content));
    expect(told).toBe(true);
  });

  it('a style the agent writes wins and nothing is reported', async () => {
    replies = [{ title: 'Party', style: 'grainy 16mm film', texts: ['a'] }];
    await sendAgentMessage('a party');
    replies = [{ title: 'Party', revision: true, style: 'clean studio photo', texts: ['a'] }];
    await sendAgentMessage('make it a studio photo');
    expect(plans()[0].plan.style).toBe('clean studio photo');
    expect(plans()[0].plan.adjustments.join(' ')).not.toContain('omitted the style');
  });

  it('a new request (not a revision) gets no style it did not write', async () => {
    replies = [{ title: 'Party', style: 'grainy 16mm film', texts: ['a'] }];
    await sendAgentMessage('a party');
    replies = [{ title: 'Poster', revision: false, texts: ['p'] }];
    await sendAgentMessage('now a poster');
    expect(plans().find((p) => p.plan.title === 'Poster')?.plan.style).toBeUndefined();
  });
});

describe('continuity of the revised plan', () => {
  const prev = {
    style: 'film',
    continuity: [
      { source: 's1', preserve: 'her face', steps: ['s2', 's3'] },
      { source: 'asset:a1', preserve: 'the logo', steps: ['s3'] },
      { source: 's9', preserve: 'the room', steps: ['s2'] },
    ],
  } as unknown as Plan;
  const session = { feed: [{ id: 'f1', type: 'plan', status: 'awaiting', plan: prev }], agent: { revising: 'f1' } };
  const raw = (extra: Partial<RawPlan> = {}): RawPlan => ({ steps: [{ id: 's1' }, { id: 's2' }] as RawPlan['steps'], ...extra });

  it('copies the groups that still point at existing steps and says what it dropped', () => {
    const r = raw();
    const notes = carryOverRevision(r, session);
    expect(r.continuity).toEqual([{ source: 's1', preserve: 'her face', steps: ['s2'] }]);
    expect(notes.join(' ')).toContain('previous one was kept for 1 group (2 dropped because their steps were removed)');
    expect(r.carried).toEqual(['Kept the previous style', 'Kept the previous continuity']);
  });

  it('what the agent writes wins, even an empty list', () => {
    const r = raw({ continuity: [] });
    carryOverRevision(r, session);
    expect(r.continuity).toEqual([]);
  });

  it('does nothing when no plan is being revised', () => {
    const r = raw();
    expect(carryOverRevision(r, { feed: [], agent: {} })).toEqual([]);
    expect(r.continuity).toBeUndefined();
  });

  it('the normalizer starts its adjustments with the notes', async () => {
    const ctx = { workspace: 'chat', getModel: async () => null, defaultModel: () => undefined, defaultSettings: () => ({}), asset: () => undefined, layer: () => undefined } as unknown as PlanContext;
    const out = await normalizePlan({ steps: [{ id: 's1', kind: 'text', text: 'a' }], carried: ['You omitted the style; the previous one was kept: film'] } as RawPlan, ctx, 'p');
    expect(out.plan?.adjustments[0]).toContain('previous one was kept');
  });
});
