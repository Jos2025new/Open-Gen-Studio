import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The browser refuses a keepalive request whose BYTES pass 64 KiB. disk.ts decided with the string length (UTF-16 units),
// so a body under 60 000 characters of 3-byte text went out as keepalive and the save failed ("Disk copy pending").
describe('disk writes: keepalive is decided by bytes', () => {
  let inits: Array<{ method?: string; keepalive?: boolean }> = [];
  beforeEach(() => {
    vi.resetModules();
    inits = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; keepalive?: boolean }) => {
      if (String(url).endsWith('/ping')) return new Response('ok', { status: 200 });
      inits.push(init ?? {});
      return new Response(null, { status: 204 });
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('a state body with 25 000 three-byte characters (75 KB) is not sent as keepalive', async () => {
    const { disk } = await import('../src/lib/disk');
    const text = '{"savedAt":5,"x":"' + '€'.repeat(25_000) + '"}';
    expect(text.length).toBeLessThan(60_000);
    await disk.setState(text);
    const put = inits.find((i) => i.method === 'PUT');
    expect(put?.keepalive).toBe(false);
  });

  it('a small ASCII body still goes as keepalive', async () => {
    const { disk } = await import('../src/lib/disk');
    await disk.setState('{"savedAt":5,"x":"ok"}');
    expect(inits.find((i) => i.method === 'PUT')?.keepalive).toBe(true);
  });
});
