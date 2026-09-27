import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * After a failed step (the user's case: "Network error reaching nano-gpt.com" on the key frame of a UGC plan):
 * Retry failed runs the failed step again in its own card and then the clip that waited for it; Check status asks
 * the provider about a job it received; the agent can do both when the user asks. Nothing reaches a provider.
 */

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

// Generations are simulated: s1's first run fails like the real one; what runs next succeeds.
const runs: string[] = [];
let failNext = new Set<string>();
vi.mock('../src/engine/jobs', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/engine/jobs')>();
  const { useStore } = await import('../src/store/store');
  let n = 0;
  const run = async (id: string): Promise<string[]> => {
    const st = useStore.getState();
    const g = st.generations[id];
    runs.push(`${g.stepId}:${id}`);
    if (failNext.has(g.stepId!)) {
      failNext.delete(g.stepId!);
      useStore.setState({ generations: { ...st.generations, [id]: { ...g, status: 'error', error: 'Network error reaching nano-gpt.com. Check your connection.' } } });
      throw new Error('Network error reaching nano-gpt.com. Check your connection.');
    }
    const asset = `ast_${id}_${runs.length}`;
    useStore.setState({
      assets: { ...st.assets, [asset]: { id: asset, kind: g.kind === 'video' ? 'video' : 'image', mime: 'image/png', width: 720, height: 1280, sessionId: g.sessionId, origin: 'generated', stored: true, favorite: false, createdAt: Date.now() } },
      generations: { ...st.generations, [id]: { ...g, status: 'done', error: undefined, assetIds: [asset], remoteJob: undefined } },
    });
    return [asset];
  };
  return {
    ...real,
    createGeneration: (spec: Record<string, unknown>) => {
      const id = `gen_${++n}`;
      const g = { id, ...spec, status: 'queued', assetIds: [], createdAt: Date.now(), estimate: { usd: 0.1, approximate: false }, provider: 'local', modelName: 'x', inputs: spec.inputs ?? { refs: [] } };
      useStore.setState((st) => ({ generations: { ...st.generations, [id]: g as never } }));
      return g;
    },
    runGeneration: run,
    retryGeneration: run,
    recheckGeneration: run,
  };
});

import { resumePlan, sendAgentMessage } from '../src/engine/agent/runtime';
import { useStore } from '../src/store/store';
import type { PlanFeedItem } from '../src/engine/types';

type Call = { name: string; args: unknown };
const sse = (call: Call) => {
  const chunk = { choices: [{ delta: { tool_calls: [{ index: 0, id: `c${Math.random()}`, function: { name: call.name, arguments: JSON.stringify(call.args) } }] }, finish_reason: 'tool_calls' }] };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
};
const text = (t: string) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\ndata: [DONE]\n\n`);
let replies: Array<Call | string> = [];

beforeEach(() => {
  runs.length = 0;
  failNext = new Set(['s1']);
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (!body.messages) return new Response(JSON.stringify({ data: [] }));
    const r = replies.shift() ?? 'ok';
    return typeof r === 'string' ? text(r) : sse(r);
  });
  const st = useStore.getState();
  const sid = st.activeSessionId;
  useStore.setState({
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'm' } },
    composer: { ...st.composer, agentStyle: 'auto', attachments: [] },
    sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], feed: [], subjects: [], agent: { history: [], questionRound: 0, notes: [], busy: false } } },
  });
});
afterEach(() => vi.unstubAllGlobals());

const sid = () => useStore.getState().activeSessionId;
const planItem = () => useStore.getState().sessions[sid()].feed.find((f): f is PlanFeedItem => f.type === 'plan')!;
const ugcPlan = {
  name: 'propose_plan',
  args: {
    title: 'Anuncio UGC del vestido de crochet',
    steps: [
      { id: 's1', kind: 'image', title: 'Fotograma clave UGC', model: 'local::studio-image', prompt: 'key frame' },
      { id: 's2', kind: 'video', title: 'Clip UGC con audio', model: 'local::studio-video', prompt: 'she shows the dress', first_frame: 's1' },
    ],
  },
};

describe('recovering a failed plan', () => {
  it('Retry failed runs the failed key frame again in its own card, then the clip that waited for it', async () => {
    replies = [ugcPlan];
    await sendAgentMessage('Quiero un anuncio UGC de este vestido');
    await vi.waitFor(() => expect(planItem().status).toBe('error'));
    expect(planItem().stepStates).toMatchObject({ s1: 'error', s2: 'skipped' });
    const s1Gen = planItem().stepGenerations.s1;
    const cards = useStore.getState().sessions[sid()].feed.filter((f) => f.type === 'generation').length;

    const summary = await resumePlan(sid(), planItem().id, 'retry');
    expect(planItem().status).toBe('done');
    expect(planItem().stepStates).toMatchObject({ s1: 'done', s2: 'done' });
    // The same generation (and card) ran again; only the clip got a new card.
    expect(runs).toEqual([`s1:${s1Gen}`, `s1:${s1Gen}`, expect.stringMatching(/^s2:/)]);
    expect(useStore.getState().sessions[sid()].feed.filter((f) => f.type === 'generation')).toHaveLength(cards + 1);
    expect(summary).toMatch(/all steps done/);
  });

  it('Check status without a job id says why instead of running anything', async () => {
    replies = [ugcPlan];
    await sendAgentMessage('Quiero un anuncio UGC de este vestido');
    await vi.waitFor(() => expect(planItem().status).toBe('error'));
    const msg = await resumePlan(sid(), planItem().id, 'check');
    expect(msg).toMatch(/no job id/);
    expect(runs).toHaveLength(1);
    expect(planItem().status).toBe('error');
  });

  it('Check status asks the provider about a job it received and then runs the clip', async () => {
    replies = [ugcPlan];
    await sendAgentMessage('Quiero un anuncio UGC de este vestido');
    await vi.waitFor(() => expect(planItem().status).toBe('error'));
    const genId = planItem().stepGenerations.s1;
    // The provider had given a job id before the connection dropped.
    useStore.setState((st) => ({ generations: { ...st.generations, [genId]: { ...st.generations[genId], remoteJob: { provider: 'nanogpt', id: 'run_1', meta: {} } } } }));
    const msg = await resumePlan(sid(), planItem().id, 'check');
    expect(msg).toMatch(/^Checked .*all steps done/);
    expect(runs).toEqual([`s1:${genId}`, `s1:${genId}`, expect.stringMatching(/^s2:/)]);
  });

  it('the agent retries when the user asks ("reinténtalo")', async () => {
    replies = [ugcPlan];
    await sendAgentMessage('Quiero un anuncio UGC de este vestido');
    await vi.waitFor(() => expect(planItem().status).toBe('error'));
    replies = [{ name: 'recover_plan', args: { action: 'retry' } }, 'Listo, lo reintento.'];
    await sendAgentMessage('reinténtalo');
    await vi.waitFor(() => expect(planItem().status).toBe('done'));
    expect(runs.filter((r) => r.startsWith('s1:'))).toHaveLength(2);
    const activity = useStore.getState().sessions[sid()].feed.filter((f) => f.type === 'activity').at(-1);
    expect(JSON.stringify(activity)).toMatch(/Retried the failed steps/);
  });
});
