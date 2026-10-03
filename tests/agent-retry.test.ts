import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined, setInterval, clearInterval }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { retryAgentTurn, sendAgentMessage } from '../src/engine/agent/runtime';
import { useStore } from '../src/store/store';
import type { NoticeFeedItem } from '../src/engine/types';

const enc = new TextEncoder();
const line = (x: unknown) => enc.encode(`data: ${JSON.stringify(x)}\n\n`);
const text = (t: string) => ({ choices: [{ delta: { content: t } }] });
const tool = (name: string, args: unknown) => ({ choices: [{ delta: { tool_calls: [{ index: 0, id: `c${Math.random()}`, function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] });
// A stream that starts answering and then loses the connection, as Chrome reports it ("network error").
const dropped = (chunks: unknown[]) =>
  new Response(new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(line(x))); }, pull(c) { c.error(new TypeError('network error')); } }), { headers: { 'content-type': 'text/event-stream' } });
const sse = (chunks: unknown[]) =>
  new Response(new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(line(x))); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
/** A provider that keeps the connection alive with empty chunks and never says anything (no per-call stall). */
const alive = (signal?: AbortSignal) =>
  new Response(new ReadableStream({
    start(c) {
      c.enqueue(line({ choices: [{ delta: {} }] }));
      const beat = setInterval(() => c.enqueue(line({ choices: [{ delta: {} }] })), 30_000);
      signal?.addEventListener('abort', () => { clearInterval(beat); c.error(new DOMException('aborted', 'AbortError')); });
    },
  }), { headers: { 'content-type': 'text/event-stream' } });

afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  const st = useStore.getState();
  const sid = st.activeSessionId;
  useStore.setState({
    settings: { ...st.settings, keys: { ...st.settings.keys, nanogpt: 'k' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'm', showThinking: false } },
    composer: { ...st.composer, agentStyle: 'guided', attachments: [] },
    sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], feed: [], agentMetrics: [], agent: { history: [], questionRound: 0, notes: [], busy: false } } },
  });
});

describe('retry after a dropped connection', () => {
  it('names the lost connection, offers Retry, and repeats only the failed call', async () => {
    const calls: number[] = [];
    const replies = [
      () => sse([tool('read_guide', { id: 'workflow:story' })]),
      () => dropped([text('¡Buena elección! Aquí va la idea: una chica joven… y acerc')]),
      () => sse([text('¡Buena elección! Aquí va la idea completa.')]),
    ];
    vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)).messages.length);
      return replies[calls.length - 1]();
    });
    const sid = useStore.getState().activeSessionId;
    await sendAgentMessage('un vídeo UGC con este conjunto');

    let feed = useStore.getState().sessions[sid].feed;
    const note = feed.at(-1) as NoticeFeedItem;
    expect(note.type).toBe('notice');
    expect(note.text).toBe('NanoGPT: connection lost mid-response (network error)');
    expect(note.retry?.partialItemId).toBeTruthy();
    expect(feed.some((f) => f.type === 'assistant' && f.text.includes('y acerc'))).toBe(true);

    await retryAgentTurn(sid, note.id);
    feed = useStore.getState().sessions[sid].feed;
    // The half answer and the error are gone; the finished answer is there once.
    expect(feed.some((f) => f.type === 'notice')).toBe(false);
    expect(feed.filter((f) => f.type === 'assistant').map((f) => f.type === 'assistant' && f.text)).toEqual(['¡Buena elección! Aquí va la idea completa.']);
    // The guide read before the failure stays in the history: the retry sends the same messages as the failed call.
    expect(calls).toHaveLength(3);
    expect(calls[2]).toBe(calls[1]);
  });

  it('errors that retrying cannot fix (a bad key) offer no Retry', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), { status: 401 }));
    const sid = useStore.getState().activeSessionId;
    await sendAgentMessage('hola');
    const note = useStore.getState().sessions[sid].feed.at(-1) as NoticeFeedItem;
    expect(note.type).toBe('notice');
    expect(note.retry).toBeUndefined();
  });
});

describe('a request answered without a plan (auto)', () => {
  const run = async (style: 'auto' | 'guided', msg: string) => {
    const st = useStore.getState();
    useStore.setState({ composer: { ...st.composer, agentStyle: style } });
    vi.stubGlobal('fetch', async () => sse([text('Una heroína original de videojuego, adulta, en pose de tres cuartos.')]));
    await sendAgentMessage(msg);
    return useStore.getState().sessions[st.activeSessionId].feed.at(-1) as NoticeFeedItem;
  };
  it('offers "Propose the plan" only when it failed', async () => {
    expect((await run('auto', 'Crea una chica 3D tipo overwatch')).proposePlan).toBe(true);
  });
  it('not for a question, nor in guided mode', async () => {
    expect((await run('auto', '¿Qué modelos de 3D tengo?')).type).toBe('assistant');
    expect((await run('guided', 'Crea una chica 3D tipo overwatch')).type).toBe('assistant');
    expect((await run('auto', 'Pasemonos al canvas de nodos')).type).toBe('assistant');
  });
});

describe('a provider that goes silent', () => {
  it('ends the call after the stall time with Retry instead of hanging', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', (_u: string, init?: RequestInit) => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    const sid = useStore.getState().activeSessionId;
    const turn = sendAgentMessage('hola');
    await vi.advanceTimersByTimeAsync(120_000);
    await turn;
    vi.useRealTimers();
    const note = useStore.getState().sessions[sid].feed.at(-1) as NoticeFeedItem;
    expect(note.text).toMatch(/no response for 120 s/);
    expect(note.retry).toBeDefined();
    expect(useStore.getState().sessions[sid].agent.busy).toBe(false);
  });
});

describe('an answer with nothing in it', () => {
  /** A stream with no text and no tool call, only a reason for ending (the 16 000-token case of ses_murtssey7y). */
  const empty = (finish: string) => sse([{ choices: [{ delta: {}, finish_reason: finish }] }]);

  it('cut off by the output limit: says the model spent its budget thinking, and offers Retry', async () => {
    vi.stubGlobal('fetch', async () => empty('length'));
    const sid = useStore.getState().activeSessionId;
    await sendAgentMessage('Crea una chica para vender una corneta bluetooth');
    const note = useStore.getState().sessions[sid].feed.at(-1) as NoticeFeedItem;
    expect(note.type).toBe('notice');
    expect(note.text).toMatch(/output budget/i);
    expect(note.text).toMatch(/reasoning/i);
    expect(note.retry).toBeDefined();
    // Retrying works: the same turn runs again and the answer is used.
    vi.stubGlobal('fetch', async () => sse([text('Aquí va la propuesta.')]));
    await retryAgentTurn(sid, note.id);
    const feed = useStore.getState().sessions[sid].feed;
    expect(feed.some((f) => f.type === 'assistant' && f.text.includes('propuesta'))).toBe(true);
    expect(feed.some((f) => f.type === 'notice')).toBe(false);
  });

  it('stopped with nothing: says the model did not answer, and offers Retry', async () => {
    vi.stubGlobal('fetch', async () => empty('stop'));
    const sid = useStore.getState().activeSessionId;
    await sendAgentMessage('hola');
    const note = useStore.getState().sessions[sid].feed.at(-1) as NoticeFeedItem;
    expect(note.text).toMatch(/did not answer|empty answer/i);
    expect(note.retry).toBeDefined();
  });

  it('a call that fails is counted in the metrics, with its seconds and error', async () => {
    vi.stubGlobal('fetch', async () => dropped([text('Empiezo:')]));
    const sid = useStore.getState().activeSessionId;
    await sendAgentMessage('un vídeo UGC de este conjunto');
    const m = useStore.getState().sessions[sid].agentMetrics!.at(-1)!;
    expect(m.llmCalls).toBe(1);
    expect(m.failedCalls).toHaveLength(1);
    expect(m.failedCalls![0].error).toMatch(/connection lost/i);
    expect(Number.isFinite(m.failedCalls![0].seconds)).toBe(true);
    // The failed call adds no timing sample: averages over callTimings stay numbers.
    expect(m.callTimings ?? []).toHaveLength(0);
  });
});

describe('a turn that goes quiet (T3)', () => {
  it('after 60 s without a word the activity block says so, and the turn keeps going', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    const sid = useStore.getState().activeSessionId;
    const turn = sendAgentMessage('hola');
    await vi.advanceTimersByTimeAsync(60_000);
    const act = useStore.getState().sessions[sid].feed.find((f) => f.type === 'activity');
    expect(JSON.stringify(act)).toMatch(/no answer for 60 s/);
    // Nothing was cut: the turn is still working and can be stopped from the composer.
    expect(useStore.getState().sessions[sid].agent.busy).toBe(true);
    expect(useStore.getState().sessions[sid].feed.some((f) => f.type === 'notice')).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    await turn;
    vi.useRealTimers();
  });

  it('a turn that reaches 5 min is cut with an error notice and Retry', async () => {
    vi.useFakeTimers();
    // The provider keeps the connection alive (no per-call stall) but says nothing at all.
    vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => alive(init?.signal ?? undefined));
    const sid = useStore.getState().activeSessionId;
    const turn = sendAgentMessage('hola');
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await turn;
    vi.useRealTimers();
    const note = useStore.getState().sessions[sid].feed.at(-1) as NoticeFeedItem;
    expect(note.type).toBe('notice');
    expect(note.level).toBe('error');
    expect(note.text).toMatch(/5 min/);
    expect(note.text).not.toMatch(/^Stopped\.$/);
    expect(note.retry).toBeDefined();
    expect(useStore.getState().sessions[sid].agent.busy).toBe(false);
  });

  it('no clock survives the turn: a finished turn leaves nothing running', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', async () => sse([text('Listo.')]));
    const sid = useStore.getState().activeSessionId;
    await sendAgentMessage('hola');
    vi.useRealTimers();
    // Past the silence mark and past the cap, nothing new appears in the feed.
    const before = useStore.getState().sessions[sid].feed.length;
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    vi.useRealTimers();
    expect(useStore.getState().sessions[sid].feed).toHaveLength(before);
    expect(useStore.getState().sessions[sid].agent.busy).toBe(false);
  });
});

describe('a tool call written as text (DeepSeek DSML)', () => {
  it('unreadable: hides the markup, keeps it out of the history and offers Retry and Delete', async () => {
    vi.stubGlobal('fetch', async () => sse([text('La rehago con la cara más joven.\n\n<｜DSML｜ calls>\n<｜DSML｜ invoke name="propose_plan">\n<｜DSML｜ parameter name="steps" string="false">[{"id": broken</｜DSML｜ parameter>\n</｜DSML｜ invoke>')]));
    const sid = useStore.getState().activeSessionId;
    await sendAgentMessage('parece una vieja');
    const s = useStore.getState().sessions[sid];
    const note = s.feed.at(-1) as NoticeFeedItem;
    expect(note.retry).toBeDefined();
    expect(note.garbledItemId).toBeTruthy();
    expect(s.feed.find((f) => f.id === note.garbledItemId)).toMatchObject({ text: 'La rehago con la cara más joven.' });
    expect(s.agent.history.some((m) => m.role === 'assistant')).toBe(false);
    const { deleteGarbled } = await import('../src/engine/agent/runtime');
    deleteGarbled(sid, note.id);
    expect(useStore.getState().sessions[sid].feed.some((f) => f.type === 'assistant' || f.type === 'notice')).toBe(false);
  });
});

describe('a readable tool call written as text', () => {
  it('becomes the real call: DSML ask_questions shows its card', async () => {
    const q = JSON.stringify([{ id: 'edad', question: '¿Qué edad?', options: ['18–24', '25–30'] }]);
    const dsml = `Te pregunto una cosa.\n<｜DSML｜ calls>\n<｜DSML｜ invoke name="ask_questions">\n<｜DSML｜ parameter name="intro" string="true">Una duda</｜DSML｜ parameter>\n<｜DSML｜ parameter name="questions" string="false">${q}</｜DSML｜ parameter>\n</｜DSML｜ invoke>\n</｜DSML｜ calls>`;
    vi.stubGlobal('fetch', async () => sse([text(dsml)]));
    const sid = useStore.getState().activeSessionId;
    await sendAgentMessage('crea una heroína');
    const feed = useStore.getState().sessions[sid].feed;
    expect(feed.find((f) => f.type === 'questions')).toBeTruthy();
    expect(feed.some((f) => f.type === 'assistant' && f.text.includes('DSML'))).toBe(false);
    expect(feed.some((f) => f.type === 'notice')).toBe(false);
    // On its next call the model reads a warning with the result of the converted call.
    const { repairHistory } = await import('../src/engine/agent/runtime');
    const sent = repairHistory(useStore.getState().sessions[sid].agent.history);
    expect(sent.find((m) => m.role === 'tool')?.content).toMatch(/^Warning: you wrote this call as text markup/);
  });

  it('parses DSML strings and JSON values, and <tool_call> JSON', async () => {
    const { parseToolMarkup } = await import('../src/engine/agent/toolMarkup');
    expect(parseToolMarkup('<｜DSML｜ invoke name="propose_plan"><｜DSML｜ parameter name="title" string="true">Hola</｜DSML｜ parameter><｜DSML｜ parameter name="revision" string="false">true</｜DSML｜ parameter></｜DSML｜ invoke>')).toEqual([{ name: 'propose_plan', arguments: '{"title":"Hola","revision":true}' }]);
    expect(parseToolMarkup('<tool_call>{"name":"read_guide","arguments":{"id":"skill:archviz"}}</tool_call>')).toEqual([{ name: 'read_guide', arguments: '{"id":"skill:archviz"}' }]);
  });
});

describe("the user's own messages", () => {
  const said = (sid: string) => useStore.getState().sessions[sid].agent.history.filter((m) => m.role === 'user').map((m) => String(m.content).split('\n').slice(1, 2).join(''));
  it('delete: gone from the chat, and the agent reads only a deletion note in its place', async () => {
    let n = 0;
    vi.stubGlobal('fetch', async () => sse([text(`answer ${++n}`)]));
    const sid = useStore.getState().activeSessionId;
    await sendAgentMessage('primero');
    await sendAgentMessage('segundo');
    const first = useStore.getState().sessions[sid].feed.find((f) => f.type === 'user' && f.text === 'primero')!;
    const { deleteUserMessage } = await import('../src/engine/agent/runtime');
    deleteUserMessage(sid, first.id);
    const s = useStore.getState().sessions[sid];
    expect(s.feed.some((f) => f.id === first.id)).toBe(false);
    expect(s.agent.history.some((m) => String(m.content).includes('primero'))).toBe(false);
    expect(s.agent.history.find((m) => m.role === 'user')?.content).toMatch(/^\[The user deleted this message/);
    expect(said(sid)[1]).toBe('segundo');
  });

  it('edit: the old answer and what followed are dropped, the edited text is answered again', async () => {
    let n = 0;
    vi.stubGlobal('fetch', async () => sse([text(`answer ${++n}`)]));
    const sid = useStore.getState().activeSessionId;
    await sendAgentMessage('uno');
    await sendAgentMessage('dos');
    const msg = useStore.getState().sessions[sid].feed.find((f) => f.type === 'user' && f.text === 'uno')!;
    const { editUserMessage } = await import('../src/engine/agent/runtime');
    await editUserMessage(sid, msg.id, 'uno, corregido');
    const s = useStore.getState().sessions[sid];
    expect(said(sid)).toEqual(['uno, corregido']);
    expect(s.feed.filter((f) => f.type === 'user').map((f) => f.type === 'user' && f.text)).toEqual(['uno, corregido']);
    expect(s.feed.filter((f) => f.type === 'assistant').map((f) => f.type === 'assistant' && f.text)).toEqual(['answer 3']);
  });
});
