import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadDisk(fetcher: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn(fetcher));
  return (await import('../src/lib/disk')).disk;
}

describe('adversarial pagehide error suppression', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('still warns when an actual HTTP 500 arrives after pagehide without a reload', async () => {
    const win = new EventTarget();
    vi.stubGlobal('window', win);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const disk = await loadDisk(async (url, init) => {
      if (String(url).endsWith('/ping')) return new Response('ok');
      if ((init?.method ?? 'GET') === 'GET') return new Response('{"savedAt":1}');
      return new Response('server failure', { status: 500 });
    });
    win.dispatchEvent(new Event('pageshow'));
    await disk.getState();
    win.dispatchEvent(new Event('pagehide'));
    expect(await disk.setState('{"savedAt":2}')).toBe('fail');
    expect(warn).toHaveBeenCalled();
  });
});
