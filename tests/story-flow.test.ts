import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * F6: the request from the real test ("a story and an animation of this character, 3 clips of 7 s", Auto mode)
 * end to end with a simulated LLM. It checks the flow agreed with the user: the story workflow is loaded, Auto
 * may ask one card, the plan saves the character as a subject before any clip runs, and the clips are joined.
 * Generations are stubbed: nothing reaches a provider.
 */

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

const runs: Array<{ kind: string; prompt: string; subjects: string[]; clips?: string }> = [];
vi.mock('../src/engine/jobs', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/engine/jobs')>();
  const { useStore } = await import('../src/store/store');
  let n = 0;
  const specs = new Map<string, { kind: string; prompt: string; sessionId: string; op?: { params: Record<string, unknown> } }>();
  return {
    ...real,
    createGeneration: (spec: { kind: string; prompt: string; sessionId: string }) => {
      const id = `gen_${++n}`;
      specs.set(id, spec);
      return { id, ...spec };
    },
    opSpec: async (input: { sessionId: string; op: string; params: Record<string, unknown>; sourceAssetId: string }) => ({
      sessionId: input.sessionId,
      kind: 'video',
      prompt: input.op,
      op: { id: input.op, params: input.params, sourceAssetId: input.sourceAssetId },
    }),
    runGeneration: async (id: string) => {
      const spec = specs.get(id)!;
      const st = useStore.getState();
      runs.push({
        kind: spec.kind,
        prompt: spec.prompt,
        subjects: st.library.map((x) => x.name),
        clips: spec.op ? `${(spec.op as { sourceAssetId?: string }).sourceAssetId},${spec.op.params.clips}` : undefined,
      });
      const asset = `ast_${id}`;
      useStore.setState({ assets: { ...st.assets, [asset]: { id: asset, kind: 'video', mime: 'video/mp4', width: 480, height: 854, sessionId: spec.sessionId, origin: 'generated', stored: true, favorite: false, createdAt: Date.now() } } });
      return [asset];
    },
  };
});

import { sendAgentMessage, submitAnswers } from '../src/engine/agent/runtime';
import { useStore } from '../src/store/store';
import type { FeedItem, PlanFeedItem, QuestionsFeedItem } from '../src/engine/types';

type Call = { name: string; args: unknown };
const sse = (call: Call) => {
  const chunk = { choices: [{ delta: { tool_calls: [{ index: 0, id: `c${Math.random()}`, function: { name: call.name, arguments: JSON.stringify(call.args) } }] }, finish_reason: 'tool_calls' }] };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
};

let replies: Call[] = [];
const sent: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];

beforeEach(() => {
  runs.length = 0;
  sent.length = 0;
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (!body.messages) return new Response(JSON.stringify({ data: [] }));
    sent.push(body);
    return sse(replies.shift() ?? { name: 'none', args: {} });
  });
  const st = useStore.getState();
  const sid = st.activeSessionId;
  useStore.setState({
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'm' } },
    composer: { ...st.composer, agentStyle: 'auto', attachments: ['char'] },
    assets: { ...st.assets, char: { id: 'char', kind: 'image', mime: 'image/png', width: 384, height: 682, sessionId: sid, origin: 'upload', stored: true, favorite: false, createdAt: 1 } },
    library: [],
    sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], feed: [], agent: { history: [], questionRound: 0, notes: [], busy: false } } },
  });
});
afterEach(() => vi.unstubAllGlobals());

const feed = (): FeedItem[] => useStore.getState().sessions[useStore.getState().activeSessionId].feed;
const clip = (id: string, beat: string) => ({ id, kind: 'video', title: beat, model: 'local::studio-video', prompt: `@Reto ${beat}` });

describe('story request in Auto mode (F1–F4 together)', () => {
  it('loads the story workflow, asks one card, saves the character, runs every clip and joins them', async () => {
    replies = [
      { name: 'read_guide', args: { id: 'workflow:story' } },
      { name: 'ask_questions', args: { intro: 'Dos cosas antes del guion', questions: [{ id: 'tone', question: 'Tono', options: ['Acción', 'Humor seco'], default: 'Acción' }] } },
    ];
    await sendAgentMessage('Quiero una historia y una animacion de este personaje, unos 3 clips de 7 segs');

    // The workflow text reached the model, and Auto was allowed one questions card (it used to be refused).
    const toolMsgs = sent[1].messages.filter((m) => m.role === 'tool').map((m) => String(m.content));
    expect(toolMsgs.join('\n')).toMatch(/Story \/ series[\s\S]*join_clips/);
    const card = feed().find((f): f is QuestionsFeedItem => f.type === 'questions');
    expect(card).toMatchObject({ status: 'pending', maxRounds: 1 });
    expect(card!.questions[0].default).toBe('Acción');

    replies = [
      {
        name: 'propose_plan',
        args: {
          title: 'Turno de guardia',
          total_duration: 21,
          subjects: [{ name: 'Reto', from: 'asset:char' }],
          steps: [clip('s1', 'sighs at the door'), clip('s2', 'walks the corridor'), clip('s3', 'faces the open hatch'), { id: 's4', kind: 'op', title: 'Join', op: 'join_clips', input: 's1', more: ['s2', 's3'] }],
        },
      },
    ];
    await submitAnswers(useStore.getState().activeSessionId, card!.id, { tone: 'Acción' });
    await vi.waitFor(() => expect(feed().find((f): f is PlanFeedItem => f.type === 'plan')?.status).toBe('done'), { timeout: 5000 });

    const plan = feed().find((f): f is PlanFeedItem => f.type === 'plan')!;
    expect(plan.plan.subjects).toEqual([{ name: 'Reto', from: 'asset:char' }]);
    // Every clip ran with @Reto already saved; the join got the three clips in order.
    const videos = runs.filter((r) => !r.clips);
    expect(videos).toHaveLength(3);
    expect(videos.every((r) => r.subjects.includes('Reto'))).toBe(true);
    const join = runs.find((r) => r.clips)!;
    expect(join.clips!.split(',')).toHaveLength(3);
    // guide, questions, plan, then the one text-only wrap-up after the plan ran (S4): no other model calls.
    await vi.waitFor(() => expect(sent).toHaveLength(4));
    expect(String(sent[3].messages.at(-1)!.content)).toMatch(/^\[app\] Plan "Turno de guardia" finished \(done\)/);
  });

  it('a clear request in Auto still goes straight to the plan: a second card is refused', async () => {
    replies = [
      { name: 'ask_questions', args: { questions: [{ id: 'a', question: 'A?', options: ['x', 'y'] }] } },
    ];
    await sendAgentMessage('three clips');
    const card = feed().find((f): f is QuestionsFeedItem => f.type === 'questions')!;
    replies = [
      { name: 'ask_questions', args: { questions: [{ id: 'b', question: 'B?', options: ['x', 'y'] }] } },
      { name: 'propose_plan', args: { title: 'T', steps: [{ id: 't1', kind: 'text', text: 'ok' }] } },
    ];
    await submitAnswers(useStore.getState().activeSessionId, card.id, { a: 'x' });
    expect(feed().filter((f) => f.type === 'questions')).toHaveLength(1);
    const refusal = sent[2].messages.filter((m) => m.role === 'tool').map((m) => String(m.content)).join(' ');
    expect(refusal).toMatch(/Question rounds are used up/);
  });
});
