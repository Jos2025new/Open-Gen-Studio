import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBlob } from '../src/lib/media';
import { statusChecker } from '../src/engine/checkStatus';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const stalled = (_: unknown, init: RequestInit) => new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));

describe('bounded generation downloads', () => {
  it('falls back to the relay when the direct request stalls, without submitting anything', async () => {
    vi.useFakeTimers();
    const f = vi.fn().mockImplementationOnce(stalled).mockResolvedValueOnce(new Response('video', { headers: { 'Content-Type': 'video/mp4' } }));
    vi.stubGlobal('fetch', f);
    const p = fetchBlob('https://storage.example/video.mp4', { timeoutMs: 30 });
    await vi.advanceTimersByTimeAsync(31);
    expect(await (await p).text()).toBe('video');
    expect(f.mock.calls[1][0]).toBe('/x/media?url=https%3A%2F%2Fstorage.example%2Fvideo.mp4');
    expect(f.mock.calls.every(([, init]) => !init.method || init.method === 'GET')).toBe(true);
  });
  it('bounds a stalled response body as well as the initial request', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, init) => Promise.resolve({ ok: true, blob: () => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))) })));
    const p = fetchBlob('https://storage.example/video.mp4', { timeoutMs: 30 });
    const result = expect(p).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(61); await result;
  });
  it('caller cancellation stops immediately and does not start a relay download', async () => {
    const f = vi.fn(stalled); vi.stubGlobal('fetch', f);
    const c = new AbortController(), p = fetchBlob('https://storage.example/video.mp4', { signal: c.signal });
    const result = expect(p).rejects.toThrow(); c.abort(); await result;
    expect(f).toHaveBeenCalledTimes(1);
  });
});

it('Check status aborts the existing follower, waits for cleanup and resumes only once', async () => {
  const c = new AbortController(), order: string[] = [];
  const p = new Promise((_, reject) => c.signal.addEventListener('abort', () => { order.push('abort'); reject(new Error('aborted')); })).finally(() => { order.push('cleanup'); });
  const resume = vi.fn(async () => { order.push('resume'); });
  const check = statusChecker({ job: () => ({ remoteJob: { id: 'existing' }, status: 'running' }), pending: () => p, controller: () => c, wake: vi.fn(), resume });
  check('g'); check('g');
  await new Promise((r) => setTimeout(r, 0));
  expect(order).toEqual(['abort', 'cleanup', 'resume']); expect(resume).toHaveBeenCalledTimes(1);
});

it('Check status keeps an active multi-output submission intact', () => {
  const controller = new AbortController(), wake = vi.fn(), resume = vi.fn(async () => undefined);
  const check = statusChecker({ job: () => ({ remoteJob: {}, status: 'running' }), pending: () => new Promise(() => undefined), controller: () => controller, wake, resume, restartable: () => false });
  check('batch'); expect(controller.signal.aborted).toBe(false); expect(wake).toHaveBeenCalledOnce(); expect(resume).not.toHaveBeenCalled();
});
