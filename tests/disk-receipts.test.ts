import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function loadDisk(fetcher: FetchMock) {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn(fetcher));
  return (await import('../src/lib/disk')).disk;
}

const state = (savedAt: number, label: string) => `{"savedAt":${savedAt},"label":"${label}"}`;
const ok = (body = 'ok') => new Response(body, { status: 200 });
const failed = (status: number) => new Response('server error', { status });
const method = (init?: RequestInit) => init?.method ?? 'GET';

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('disk write receipts', () => {
  it('returns conflict on a 409 and skips later writes from the stale tab', async () => {
    let writes = 0;
    const disk = await loadDisk(async (_url, init) => {
      if (String(_url).endsWith('/ping')) return ok();
      if (method(init) === 'GET') return ok(state(10, 'base'));
      writes++;
      return writes === 1 ? ok() : failed(409);
    });
    await disk.getState();

    expect(await disk.setState(state(20, 'first'))).toBe('ok');
    expect(await disk.setState(state(30, 'conflict'))).toBe('conflict');
    expect(await disk.setState(state(40, 'blocked'))).toBe('conflict');
    expect(writes).toBe(2);
  });

  it('returns fail for an HTTP 500 state write', async () => {
    const disk = await loadDisk(async (_url, init) => {
      if (String(_url).endsWith('/ping')) return ok();
      if (method(init) === 'GET') return ok(state(10, 'base'));
      return failed(500);
    });
    await disk.getState();

    expect(await disk.setState(state(20, 'write failed'))).toBe('fail');
  });

  it('recovers after a failed write when the caller manually retries', async () => {
    let puts = 0;
    const disk = await loadDisk(async (_url, init) => {
      if (String(_url).endsWith('/ping')) return ok();
      if (method(init) === 'GET') return ok(state(10, 'base'));
      puts++;
      if (puts === 1) throw new TypeError('server unavailable');
      return ok();
    });
    await disk.getState();

    expect(await disk.setState(state(20, 'first attempt'))).toBe('fail');
    expect(await disk.setState(state(30, 'manual retry'))).toBe('ok');
    expect(puts).toBe(2);
  });

  it.each([
    ['HTTP 500', async () => failed(500)],
    ['network failure', async () => { throw new TypeError('offline'); }],
  ])('treats a %s ping failure as fail, not browser-only', async (_label, ping) => {
    const disk = await loadDisk(async () => ping());
    expect(await disk.setState(state(20, 'offline'))).toBe('fail');
  });

  it('returns browser-only when a static host serves the app without a local store', async () => {
    const disk = await loadDisk(async () => new Response('<!doctype html><html></html>', {
      status: 404,
      headers: { 'Content-Type': 'text/html' },
    }));

    expect(await disk.setState(state(20, 'browser copy'))).toBe('browser-only');
  });

  it('returns fail when a blob write receives HTTP 500', async () => {
    const disk = await loadDisk(async (_url, init) => {
      if (String(_url).endsWith('/ping')) return ok();
      return method(init) === 'PUT' ? failed(500) : ok();
    });

    expect(await disk.setBlob('raster:layer-a', new Blob(['pixels']))).toBe('fail');
  });

  it('coalesces pending writes, resolves every receipt, and advances baseAt in order', async () => {
    const writes: string[] = [];
    const disk = await loadDisk(async (_url, init) => {
      if (String(_url).endsWith('/ping')) return ok();
      if (method(init) === 'GET') return ok(state(10, 'base'));
      writes.push(String(init?.body));
      return ok();
    });
    await disk.getState();

    const first = disk.setState(state(20, 'superseded'));
    const second = disk.setState(state(30, 'latest queued'));
    expect(await Promise.all([first, second])).toEqual(['ok', 'ok']);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('"savedAt":30,"baseAt":10');

    expect(await disk.setState(state(40, 'next'))).toBe('ok');
    expect(writes).toHaveLength(2);
    expect(writes[1]).toContain('"savedAt":40,"baseAt":30');
  });
});
