// @ts-nocheck -- Node fs and a Node server in a test; the project has no @types/node (see tests/bench/node.d.ts).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error plain JS server module without types
import { localStore } from '../server/local-store.js';

/*
 * T5: when a provider refuses ("Upstream access denied") there has to be a way to see what was actually sent,
 * without ever writing a key or the media itself, and a line in data/logs/app.log for the events that matter.
 */

describe('what a request debug record may contain', () => {
  it('keeps the endpoint and the mapped parameters, but no key and no media', async () => {
    const { describeRequest } = await import('../src/lib/debug');
    const sent = describeRequest({
      url: 'https://api.atlascloud.ai/api/v1/model/text-to-image',
      attempt: 2,
      body: {
        model: 'google/nano-banana-2-lite/text-to-image-developer',
        prompt: 'a woman holding a speaker',
        n: 1,
        image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        Authorization: 'Bearer sk-live-abcdefghijklmnop',
        api_key: 'nanogpt-xyz',
        nested: { token: 'secret-token-value', size: '1024x1024' },
      },
      media: [{ mime: 'image/png', width: 1024, height: 1024 }],
    });
    const text = JSON.stringify(sent);
    expect(sent.url).toContain('atlascloud.ai');
    expect(sent.attempt).toBe(2);
    expect(sent.params).toMatchObject({ model: 'google/nano-banana-2-lite/text-to-image-developer', n: 1, nested: { size: '1024x1024' } });
    // No key, whatever it is called.
    expect(text).not.toMatch(/sk-live-abcdefghijklmnop/);
    expect(text).not.toMatch(/nanogpt-xyz/);
    expect(text).not.toMatch(/secret-token-value/);
    // No media: a data URL never reaches the file.
    expect(text).not.toMatch(/base64/);
    // Named for what was sent (this PNG is 1×1), not for the first input's size.
    expect(text).toMatch(/<image 1×1, 1 KB>/);
    expect(text.length).toBeLessThan(2000);
  });

  it('a log line is a single short line, and never carries a key', async () => {
    const { logEvent, logSettled } = await import('../src/lib/log');
    const sent: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      sent.push(String(init?.body));
      return new Response('', { status: 204 });
    });
    logEvent('provider-error', { message: 'Upstream access denied', apiKey: 'sk-live-zzz', auth: 'Bearer yyy' });
    await logSettled();
    vi.unstubAllGlobals();
    const line = sent.join('');
    expect(line).not.toMatch(/sk-live-zzz/);
    expect(line).not.toMatch(/Bearer yyy/);
    expect(line).toMatch(/Upstream access denied/);
    expect(line.split('\n')).toHaveLength(1);
  });
});

describe('the disk log', () => {
  let root = '';
  let server: Server;
  let base = '';

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'ogs-log-'));
    let mw: (req: unknown, res: unknown, next: () => void) => void = () => undefined;
    localStore(root).configureServer({ middlewares: { use: (fn: typeof mw) => (mw = fn) } });
    server = createServer((req, res) => mw(req, res, () => res.writeHead(404).end()));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => {
    server.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('appends one JSON line per event to data/logs/app.log', async () => {
    const post = async (payload: unknown) => {
      const res = await fetch(`${base}/x/store/log`, { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json', 'X-OGS': '1' } });
      expect(res.status).toBe(204);
    };
    await post({ at: '2026-10-03T10:00:00.000Z', kind: 'provider-error', data: { message: 'Upstream access denied' } });
    await post({ at: '2026-10-03T10:00:01.000Z', kind: 'harness', data: { step: 's1', problem: 'needs refs' } });
    const lines = readFileSync(join(root, 'data', 'logs', 'app.log'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1])).toMatchObject({ kind: 'harness', data: { step: 's1' } });
  });

  it('rotates when the log grows past its size', async () => {
    const logFile = join(root, 'data', 'logs', 'app.log');
    writeFileSync(logFile, 'x'.repeat(6 * 1024 * 1024));
    const res = await fetch(`${base}/x/store/log`, { method: 'POST', body: JSON.stringify({ kind: 'agent', data: { note: 'after rotation' } }), headers: { 'Content-Type': 'application/json', 'X-OGS': '1' } });
    expect(res.status).toBe(204);
    expect(readFileSync(logFile, 'utf8')).toMatch(/after rotation/);
    expect(readFileSync(join(root, 'data', 'logs', 'app.log.1'), 'utf8').length).toBe(6 * 1024 * 1024);
  });

  it('without the local server the log is ignored and nothing throws', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('no server'); });
    const { logEvent } = await import('../src/lib/log');
    expect(() => logEvent('provider-error', { message: 'x' })).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
    vi.unstubAllGlobals();
  });
});

// The generation must end up carrying what was sent, and a refused request must leave a line behind.
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined, adoptDisk: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => new Blob([new Uint8Array(1)], { type: 'image/png' }),
  putAssetBlob: async () => undefined,
}));
vi.mock('../src/lib/media', async (orig) => ({
  ...(await orig<typeof import('../src/lib/media')>()),
  blobToCanvas: async () => ({ width: 768, height: 768 }),
  createCanvas: (w: number, h: number) => ({ width: w, height: h }),
  ctx2d: () => ({ drawImage: () => undefined }),
  canvasToBlob: async () => new Blob(['x'], { type: 'image/png' }),
}));
vi.mock('../src/engine/providers/registry', async (orig) => {
  const real = await orig<typeof import('../src/engine/providers/registry')>();
  return {
    ...real,
    ADAPTERS: {
      ...real.ADAPTERS,
      atlas: {
        ...real.ADAPTERS.atlas,
        generate: async (req: { onRequest?: (i: { url: string; body: unknown }) => void; onRemoteJob: (j: unknown) => void }) => {
          req.onRequest?.({ url: 'https://api.atlascloud.ai/api/v1/model/generateImage', body: { model: 'google/nano-banana-2-lite/text-to-image', prompt: 'chica', api_key: 'sk-live-never-logged' } });
          req.onRemoteJob({ provider: 'atlas', id: 'job-42' });
          return { outputs: [{ blob: new Blob(['x'], { type: 'image/png' }), mime: 'image/png' }] };
        },
      },
    },
  };
});

import { createGeneration, runGeneration } from '../src/engine/jobs';
import { debugText } from '../src/components/assets/GenerationInfo';
import { useStore } from '../src/store/store';

describe('what a generation remembers of its request (T5)', () => {
  beforeEach(() => {
    // No network: the exact-price quote and the log line have nowhere to go.
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 503 }));
    const st = useStore.getState();
    useStore.setState({
      settings: { ...st.settings, keys: { ...st.settings.keys, atlas: 'k' } },
      catalog: {
        ...st.catalog,
        models: { [REF]: { id: REF, name: 'Nano Banana 2 Lite', provider: 'atlas', kind: 'image', acceptsImage: false, tags: [] } },
        schemas: { [REF]: { ref: REF, params: [], slots: {}, source: 'catalog' } },
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('the last request to the provider is on the card, with its job id and without the key', async () => {
    const g = createGeneration({ sessionId: useStore.getState().activeSessionId, kind: 'image', prompt: 'chica', modelRef: REF, settings: { count: 1, advanced: {} }, inputs: { refs: [] }, origin: 'agent' });
    await runGeneration(g.id);
    const done = useStore.getState().generations[g.id];
    expect(done.status).toBe('done');
    expect(done.sent).toMatchObject({ attempt: 1, jobId: 'job-42', params: { prompt: 'chica' } });
    expect(done.sent!.url).toContain('atlascloud.ai');
    // What "Copy debug info" puts on the clipboard.
    const text = debugText(done);
    expect(text).toContain('job-42');
    expect(text).not.toContain('sk-live-never-logged');
  });
});

const REF = 'atlas::google/nano-banana-2-lite/text-to-image';

describe('each image of a request is named for what it is', () => {
  const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));
  const png = (w: number, h: number) => [0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, w >>> 24, (w >> 16) & 255, (w >> 8) & 255, w & 255, h >>> 24, (h >> 16) & 255, (h >> 8) & 255, h & 255, 8, 6, 0, 0, 0];
  // SOI, an APP0 segment to skip, then SOF0 with height before width.
  const jpeg = (w: number, h: number) => [0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 0, 0, 0];

  it('three references of different sizes keep their own sizes (the house was logged as the girl)', async () => {
    const { describeRequest } = await import('../src/lib/debug');
    const sent = describeRequest({
      url: 'https://nano-gpt.com/api/generate-video',
      attempt: 1,
      body: { referenceImages: [`data:image/png;base64,${b64(png(896, 1200))}`, `data:image/jpeg;base64,${b64(jpeg(1376, 768))}`] },
      media: [{ mime: 'image/png', width: 896, height: 1200 }],
    });
    expect(sent.params.referenceImages).toEqual(['<image 896×1200, 1 KB>', '<image 1376×768, 1 KB>']);
  });

  it('reads WebP and GIF headers, and says only the kind when it cannot read one', async () => {
    const { imageSize, redact } = await import('../src/lib/debug');
    const vp8x = [...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBPVP8X'].map((c) => c.charCodeAt(0)), [0, 0, 0, 0, 0, 0, 0, 0], [639 & 255, 639 >> 8, 0, 479 & 255, 479 >> 8, 0]);
    expect(imageSize(Uint8Array.from(vp8x))).toEqual({ width: 640, height: 480 });
    expect(imageSize(Uint8Array.from([...'GIF89a'].map((c) => c.charCodeAt(0)).concat([32, 0, 16, 0])))).toEqual({ width: 32, height: 16 });
    expect(redact('A'.repeat(200), { mime: 'image/png', width: 896, height: 1200 })).toBe('<image>');
  });
});
