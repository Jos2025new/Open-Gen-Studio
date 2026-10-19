// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { idbKeyval, resetWorld, settle, until } from './helpers/fakeTabs';

/*
 * Plan 1.4, test 15f: work in flight when another tab asks for the lock. Generations with a provider job (remoteJob)
 * move to the next tab with no cancel and no partial charge; the rest is listed, waited for or given up on purpose.
 */
vi.mock('idb-keyval', () => idbKeyval());
vi.mock('../src/engine/design/raster', () => ({ flushRaster: async () => undefined, pendingRaster: () => [] }));
vi.mock('../src/lib/log', () => ({ logEvent: () => undefined, logged: (_: string, f: unknown) => f, logSettled: async () => undefined }));
const polls = vi.hoisted(() => [] as Array<{ job: string; reason?: unknown }>);
vi.mock('../src/engine/providers/registry', async (orig) => {
  const real = await orig<typeof import('../src/engine/providers/registry')>();
  // A job the provider keeps running: the follower waits until its tab stops it; the reason of the abort is recorded.
  const follow = (job: { id: string }, ctx: { signal: AbortSignal }) => new Promise((_, reject) => {
    const entry: { job: string; reason?: unknown } = { job: job.id };
    polls.push(entry);
    ctx.signal.addEventListener('abort', () => { entry.reason = ctx.signal.reason; reject(new DOMException('aborted', 'AbortError')); });
  });
  return { ...real, ADAPTERS: { ...real.ADAPTERS, atlas: { ...real.ADAPTERS.atlas, resume: follow } } };
});
vi.stubGlobal('fetch', async (url: string) => (url === '/x/store/ping' ? new Response('ok') : url === '/x/store/blobs' ? new Response('[]') : new Response(null, { status: 204 })));

const ref = 'atlas::google/nano-banana-2-lite/text-to-image';
async function openTab() {
  vi.resetModules();
  const lock = await import('../src/lib/writerLock');
  const store = await import('../src/store/store');
  await import('../src/store/writerHandoff');
  const jobs = await import('../src/engine/jobs');
  const runtime = await import('../src/engine/agent/runtime');
  return { lock, store, jobs, runtime, state: () => store.useStore.getState() };
}
type Tab = Awaited<ReturnType<typeof openTab>>;
const hydrated = (t: Tab) => until(() => t.state().hydrated);
function generation(t: Tab, remote: boolean) {
  const st = t.state();
  t.store.useStore.setState({ settings: { ...st.settings, keys: { ...st.settings.keys, atlas: 'k' } } });
  const g = t.jobs.createGeneration({ sessionId: st.activeSessionId, kind: 'image', prompt: 'x', modelRef: ref, settings: { count: 1, advanced: {} }, inputs: { refs: [] }, origin: 'composer' });
  t.store.patchGeneration(g.id, { status: 'running', ...(remote ? { remoteJob: { provider: 'atlas', id: `job_${g.id}` } as never } : {}) });
  return g.id;
}

beforeEach(() => { resetWorld(); polls.length = 0; vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined })); });
afterEach(() => { vi.useRealTimers(); });

describe('test 15f: handing over work in flight', () => {
  it('a generation with a remoteJob is cut with WRITER_HANDOFF: it stays running, is not canceled or charged, and the new tab resumes it', async () => {
    const a = await openTab();
    await hydrated(a);
    const id = generation(a, true);
    a.store.useStore.setState({ spentUsd: 1 });
    await a.jobs.resumeInterrupted(); // the follower of tab A
    await until(() => polls.length === 1);

    const b = await openTab();
    await settle();
    b.lock.useHere();
    await hydrated(b);

    expect(polls[0]).toMatchObject({ job: `job_${id}`, reason: 'writer-handoff' });
    const old = a.state().generations[id];
    expect(old.status).toBe('running');
    expect(old.remoteJob).toMatchObject({ id: `job_${id}` });
    expect(a.state().spentUsd).toBe(1);
    // The new tab got it from IndexedDB, still running with its job, and follows it again.
    const mine = b.state().generations[id];
    expect(mine.status).toBe('running');
    expect(mine.remoteJob).toMatchObject({ id: `job_${id}` });
    await b.jobs.resumeInterrupted();
    await until(() => polls.length === 2);
    expect(polls[1].job).toBe(`job_${id}`);
    expect(b.state().generations[id].status).toBe('running');
    expect(b.state().spentUsd).toBe(1);
  });

  it('after the request the old tab starts no new work, the user\'s or the agent\'s; the list is shown and "wait" releases when the work ends', async () => {
    const a = await openTab();
    await hydrated(a);
    const id = generation(a, false); // answered in its own request: cannot be handed over
    expect(a.lock.mayStartWork()).toBe(true);
    const b = await openTab();
    await settle();
    b.lock.useHere();
    await until(() => b.lock.getWriterState().asking === 'choose');
    expect(b.lock.getWriterState().work).toEqual({ transferable: 0, generations: 1, agent: 0 });
    expect(a.lock.holdsWriterLock()).toBe(true);
    expect(a.lock.getWriterState().requested).toBe(true);
    expect(a.lock.mayStartWork()).toBe(false);
    await expect(a.jobs.runGeneration(id)).rejects.toThrow('another tab');
    await a.runtime.sendAgentMessage('hello');
    expect(a.state().sessions[a.state().activeSessionId].feed.some((f) => f.type === 'user')).toBe(false);

    b.lock.waitForThem();
    await until(() => b.lock.getWriterState().asking === 'waiting-them');
    expect(a.lock.holdsWriterLock()).toBe(true);
    a.store.patchGeneration(id, { status: 'done' }); // the work ends
    await hydrated(b);
    expect(b.lock.holdsWriterLock()).toBe(true);
    expect(a.lock.holdsWriterLock()).toBe(false);
    expect(b.state().generations[id].status).toBe('done');
  });

  it('"take over now" says what is lost: the generation without a job is interrupted by the tab change in the new tab', async () => {
    const a = await openTab();
    await hydrated(a);
    const id = generation(a, false);
    const b = await openTab();
    await settle();
    b.lock.useHere();
    await until(() => b.lock.getWriterState().asking === 'choose');
    b.lock.takeNow();
    await hydrated(b);
    expect(b.lock.holdsWriterLock()).toBe(true);
    await b.jobs.resumeInterrupted();
    const g = b.state().generations[id];
    expect(g.status).toBe('error');
    expect(g.error).toContain('page reload or tab change');
  });

  it('a busy agent counts as work that cannot be handed over', async () => {
    const a = await openTab();
    await hydrated(a);
    const sid = a.state().activeSessionId;
    a.store.useStore.setState((s) => ({ sessions: { ...s.sessions, [sid]: { ...s.sessions[sid], agent: { ...s.sessions[sid].agent, busy: true } } } }));
    const b = await openTab();
    await settle();
    b.lock.useHere();
    await until(() => b.lock.getWriterState().asking === 'choose');
    expect(b.lock.getWriterState().work).toEqual({ transferable: 0, generations: 0, agent: 1 });
    // The agent turn already running may still start its generations; nobody else may.
    expect(a.lock.mayStartWork()).toBe(true);
  });

  it('review 4: a handover whose browser save fails keeps the lock in the old tab and tells the new one', async () => {
    const a = await openTab();
    await hydrated(a);
    a.lock.setWriterHooks({ report: () => ({ transferable: 0, generations: 0, agent: 0 }), agentBusy: () => false, abortTransferable() {}, abortAll() {}, flush: async () => { throw new Error('quota'); } });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const b = await openTab();
    await settle();
    b.lock.useHere();
    await settle();
    expect(a.lock.holdsWriterLock()).toBe(true);
    expect(b.lock.holdsWriterLock()).toBe(false);
    expect(b.lock.getWriterState().asking).toBe('idle'); // told "kept": not left waiting
  });
});
