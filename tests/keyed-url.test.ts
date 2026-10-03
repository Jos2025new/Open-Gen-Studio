import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADAPTERS } from '../src/engine/providers/registry';
import type { RemoteJob } from '../src/engine/types';

afterEach(() => vi.unstubAllGlobals());

/** A saved job whose address was changed: the poll must fail without sending the key anywhere. */
async function pollWith(provider: 'fal' | 'atlas', meta: Record<string, string>) {
  const sent: Array<{ url: string; auth: boolean }> = [];
  vi.stubGlobal('fetch', async (u: string, init?: RequestInit) => {
    const h = new Headers(init?.headers);
    sent.push({ url: String(u), auth: Boolean(h.get('authorization') || h.get('x-api-key')) });
    return new Response(JSON.stringify({ status: 'IN_QUEUE' }), { status: 200 });
  });
  const job = { provider, id: 'j1', meta } as unknown as RemoteJob;
  const err = await ADAPTERS[provider].resume!(job, { kind: 'image', apiKey: 'sk-test', signal: new AbortController().signal, onStatus: () => undefined }).catch((e: Error) => e);
  return { sent, err };
}

describe('the API key only goes to the provider (keyedUrl)', () => {
  it('fal: a status_url on another host fails and no request carries the key', async () => {
    const { sent, err } = await pollWith('fal', { status_url: 'https://evil.example/status', response_url: 'https://evil.example/r' });
    expect(String(err)).toMatch(/unexpected address/);
    expect(sent.filter((s) => s.auth)).toEqual([]);
  });
  it('Atlas: a pollUrl on another host fails and no request carries the key', async () => {
    const { sent, err } = await pollWith('atlas', { pollUrl: 'http://api.atlascloud.ai.evil.example/x' });
    expect(String(err)).toMatch(/unexpected address/);
    expect(sent.filter((s) => s.auth)).toEqual([]);
  });
});
