import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * T1: a step is done only if its generation finished with results. From ses_mursnwichu: the plan said "done", the
 * agent's closing message said "here is the image" and no image existed (the one generation ended in an error).
 * Nothing reaches a provider.
 */

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

/** How the runner answers, per step: results, nothing at all, or a generation left in error. */
let mode = 'ok';
const runs: string[] = [];
vi.mock('../src/engine/jobs', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/engine/jobs')>();
  const { useStore } = await import('../src/store/store');
  let n = 0;
  const run = async (id: string): Promise<string[]> => {
    const st = useStore.getState();
    const g = st.generations[id];
    runs.push(g.stepId ?? id);
    if (mode === 'empty') {
      // The runner resolved, but the generation holds no result: nothing was made.
      useStore.setState({ generations: { ...st.generations, [id]: { ...g, status: 'done', assetIds: [] } } });
      return [];
    }
    if (mode === 'error-status') {
      useStore.setState({ generations: { ...st.generations, [id]: { ...g, status: 'error', error: 'Stopped waiting after 10 min; the job may still finish at Atlas Cloud. Use Check again later.', assetIds: [] } } });
      return [];
    }
    const asset = `ast_${id}_${runs.length}`;
    useStore.setState({
      assets: { ...st.assets, [asset]: { id: asset, kind: 'image', mime: 'image/png', width: 720, height: 1280, sessionId: g.sessionId, origin: 'generated', stored: true, favorite: false, createdAt: Date.now() } },
      generations: { ...st.generations, [id]: { ...g, status: 'done', error: undefined, assetIds: [asset] } },
    });
    return [asset];
  };
  return {
    ...real,
    createGeneration: (spec: Record<string, unknown>) => {
      const id = `gen_${++n}`;
      const g = { id, ...spec, status: 'queued', assetIds: [], createdAt: Date.now(), estimate: { usd: 0.1, approximate: false }, provider: 'local', modelName: 'Studio Image', inputs: spec.inputs ?? { refs: [] } };
      useStore.setState((st) => ({ generations: { ...st.generations, [id]: g as never } }));
      return g as never;
    },
    runGeneration: run,
    retryGeneration: run,
    recheckGeneration: run,
  };
});

import { approvePlan, confirmSettings, sendAgentMessage, settleInterruptedPlans } from '../src/engine/agent/runtime';
import { executeSteps } from '../src/engine/executor';
import { useStore } from '../src/store/store';
import type { PlanFeedItem, PlanStep, SettingsFeedItem } from '../src/engine/types';

type Call = { name: string; args: unknown };
const sse = (call: Call) =>
  new Response(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: `c${Math.random()}`, function: { name: call.name, arguments: JSON.stringify(call.args) } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
const text = (t: string) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\ndata: [DONE]\n\n`);

let replies: Array<Call | string> = [];
const bodies: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];

const sid = () => useStore.getState().activeSessionId;
const planItem = () => useStore.getState().sessions[sid()].feed.find((f): f is PlanFeedItem => f.type === 'plan')!;
const oneStep: PlanStep = { id: 's1', kind: 'image', title: 'La chica con la corneta', prompt: 'chica', modelRef: 'local::studio-image', settings: { count: 1, advanced: {} }, refs: [] };
const propose = { name: 'propose_plan', args: { title: 'Chica presentando la corneta', steps: [{ id: 's1', kind: 'image', title: 'La chica con la corneta', model: 'local::studio-image', prompt: 'chica' }] } };

beforeEach(() => {
  mode = 'ok';
  runs.length = 0;
  bodies.length = 0;
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (!body.messages) return new Response(JSON.stringify({ data: [] }));
    bodies.push(body);
    const r = replies.shift() ?? 'ok';
    return typeof r === 'string' ? text(r) : sse(r);
  });
  const st = useStore.getState();
  const id = st.activeSessionId;
  useStore.setState({
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'm' } },
    composer: { ...st.composer, agentStyle: 'auto', attachments: [] },
    sessions: { ...st.sessions, [id]: { ...st.sessions[id], feed: [], subjects: [], agent: { history: [], questionRound: 0, notes: [], busy: false, settings: { video: { modelRef: 'local::studio-video', needsImage: true }, image: { modelRef: 'local::studio-image', needsImage: false } } } } },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('a step is done only if its generation finished with results (T1)', () => {
  it('a generation that resolves with nothing fails its step', async () => {
    mode = 'empty';
    const result = await executeSteps([oneStep], { sessionId: sid(), workspace: 'chat', origin: 'agent', onState: () => undefined });
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].stepId).toBe('s1');
    expect(result.failed[0].error).toMatch(/no result/i);
    expect(result.outputs.size).toBe(0);
  });

  it('a generation left in error fails its step with the provider message', async () => {
    mode = 'error-status';
    const result = await executeSteps([oneStep], { sessionId: sid(), workspace: 'chat', origin: 'agent', onState: () => undefined });
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toMatch(/Stopped waiting after 10 min/);
  });

  it('a text result (transcription, lyrics) finishes with no files and stays done', async () => {
    mode = 'empty';
    // A lyrics step: its generation is kind "text" and holds text instead of files.
    const textStep: PlanStep = { id: 's1', kind: 'audio', title: 'Letra', prompt: 'una canción', modelRef: 'local::studio-image', settings: { count: 1, advanced: {} }, textOutput: true };
    const result = await executeSteps([textStep], { sessionId: sid(), workspace: 'chat', origin: 'agent', onState: () => undefined });
    expect(result.failed).toHaveLength(0);
    expect(result.outputs.has('s1')).toBe(true);
  });

  it('the plan says failed and the closing message does not claim the image (ses_mursnwichu)', async () => {
    mode = 'error-status';
    // Phase 2 as in real use: the agent asks for the settings, the user confirms the recommended ones, then the plan.
    replies = [{ name: 'confirm_settings', args: { parts: [{ kind: 'image', model: 'local::studio-image' }] } }];
    await sendAgentMessage('Crea una chica para vender una corneta bluetooth');
    const card = useStore.getState().sessions[sid()].feed.find((f): f is SettingsFeedItem => f.type === 'settings')!;
    replies = [propose, 'Lista la imagen'];
    await confirmSettings(sid(), card.id, card.sections.map((x) => x.recommended));
    await approvePlan(sid(), planItem().id);
    await vi.waitFor(() => expect(planItem().status).toBe('error'));
    expect(planItem().stepStates).toMatchObject({ s1: 'error' });
    const app = bodies.map((b) => String(b.messages.at(-1)?.content ?? '')).find((t) => t.startsWith('[app] Plan'));
    expect(app).toBeTruthy();
    expect(app).toMatch(/finished \(error\)/);
    expect(app).not.toMatch(/s1 done/);
  });

  it('after a reload the plan of an unfinished generation is never left "done" (ses_mursnwichu, on load)', () => {
    // The tab closed while the step ran: the plan is "running" and its generation "running" with the provider's job id.
    const plan: PlanFeedItem = {
      id: 'fd_plan', createdAt: Date.now(), workspace: 'chat', type: 'plan', style: 'auto',
      plan: { id: 'pln_x', title: 'Chica presentando la corneta', summary: '', workspace: 'chat', style: '', steps: [oneStep], subjects: [], adjustments: [] },
      status: 'running', stepStates: { s1: 'running' }, stepGenerations: { s1: 'gen_job' }, estimate: { usd: 0.01, approximate: false },
    };
    const st = useStore.getState();
    const s = st.sessions[sid()];
    useStore.setState({
      sessions: { ...st.sessions, [sid()]: { ...s, feed: [plan] } },
      generations: {
        ...st.generations,
        gen_job: { id: 'gen_job', sessionId: sid(), kind: 'image', prompt: 'chica', modelRef: 'local::studio-image', modelName: 'Nano Banana 2 Lite', provider: 'atlas', settings: { count: 1, advanced: {} }, inputs: { refs: [] }, origin: 'agent', status: 'running', assetIds: [], remoteJob: { provider: 'atlas', id: '9fdd955d', meta: {} }, createdAt: Date.now(), estimate: { usd: 0.01, approximate: false }, stepId: 's1', planId: 'pln_x' } as never,
      },
    });
    // The provider's answer on the next poll: the job failed there.
    const after = useStore.getState();
    useStore.setState({ generations: { ...after.generations, gen_job: { ...after.generations.gen_job, status: 'error', error: 'Stopped waiting after 10 min' } as never } });
    settleInterruptedPlans();
    expect(planItem().status).toBe('error');
    expect(planItem().stepStates).toMatchObject({ s1: 'error' });
  });
});
