// @ts-nocheck -- drives the Node server with fake streams; the project has no Node typings for tests
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localStore } from '../server/local-store.js';
import { KEYED_HOSTS as SERVER_HOSTS } from '../server/provider-proxy.js';
import { KEYED_HOSTS, providerFetch } from '../src/lib/providerFetch';

const SECRET = 'sk-test-0123456789abcd';
type Mw = (req: unknown, res: unknown, next: () => void) => void;

/** A fake secret-tool: `store` reads the secret from stdin, `lookup` prints it, `clear` removes it (one file per call). */
function fakeTool(root: string): string {
  const bin = join(root, 'secret-tool');
  writeFileSync(bin, `#!/bin/sh\nstore=${JSON.stringify(join(root, 'ring'))}\nmkdir -p "$store"\ncmd=$1; shift\nwhile [ $# -gt 0 ]; do case $1 in provider) p=$2; shift;; esac; shift; done\ncase $cmd in store) cat > "$store/$p";; lookup) [ -s "$store/$p" ] && cat "$store/$p" || exit 1;; clear) rm -f "$store/$p";; esac\n`);
  chmodSync(bin, 0o755);
  return bin;
}

function setup(tool?: string) {
  const root = mkdtempSync(join(tmpdir(), 'ogs-keys-'));
  mkdirSync(join(root, 'data'));
  if (tool) process.env.OGS_SECRET_TOOL = tool; else process.env.OGS_SECRET_TOOL = join(root, 'no-such-tool');
  let mw: Mw = () => undefined;
  (localStore(root).configureServer as unknown as (s: unknown) => void)({ middlewares: { use: (fn: Mw) => (mw = fn) } });
  return { root, mw: () => mw };
}

/** Drives the middleware; resolves with status and the body text. `body` makes the request a stream (an upload). */
function call(mw: Mw, method: string, url: string, headers: Record<string, string> = {}, body?: string): Promise<{ status: number; text: string; headers: Record<string, string> }> {
  return new Promise((resolve) => {
    const req = Object.assign(Readable.from(body ? [Buffer.from(body)] : []), { method, url, headers: { host: 'localhost:5173', 'x-ogs': '1', ...headers }, socket: { remoteAddress: '127.0.0.1' } });
    const out = new PassThrough();
    const chunks: Buffer[] = [];
    out.on('data', (c) => chunks.push(c));
    const res = Object.assign(out, { statusCode: 0, hdrs: {} as Record<string, string>, setHeader(k: string, v: string) { res.hdrs[k.toLowerCase()] = v; } });
    out.on('finish', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString(), headers: res.hdrs }));
    mw(req, res, () => resolve({ status: 404, text: '', headers: {} }));
  });
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => { delete process.env.OGS_SECRET_TOOL; vi.unstubAllGlobals(); });

describe('provider proxy (the page never holds an API key)', () => {
  it('the host lists of the page and the server are the same', () => {
    expect(SERVER_HOSTS).toEqual(KEYED_HOSTS);
  });

  it('refuses a host outside the closed list, a non-https URL and another port; nothing is contacted', async () => {
    const { mw } = setup(fakeTool(mkdtempSync(join(tmpdir(), 'ogs-t-'))));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const target of ['https://evil.example/steal', 'https://api.fal.ai.evil.example/x', 'http://api.fal.ai/x', 'https://api.fal.ai:8443/x', 'https://user:pw@api.fal.ai/x', 'http://169.254.169.254/latest']) {
      const r = await call(mw(), 'POST', '/x/store/proxy', { 'x-ogs-target': target, 'x-ogs-method': 'GET', 'x-ogs-auth': '1' });
      expect(r.status, target).toBe(403);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('only from this computer and only from the app', async () => {
    const { mw } = setup(fakeTool(mkdtempSync(join(tmpdir(), 'ogs-t-'))));
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const headers = { 'x-ogs-target': 'https://api.fal.ai/v1/models', 'x-ogs-method': 'GET' };
    expect((await call(mw(), 'POST', '/x/store/proxy', { ...headers, 'x-ogs': '0' })).status).toBe(403);
    expect((await call(mw(), 'POST', '/x/store/proxy', { ...headers, origin: 'https://evil.example' })).status).toBe(403);
    expect(f).not.toHaveBeenCalled();
  });

  it('adds the stored key server-side, drops the page’s own auth, relays status and error text; the key is never in the answer', async () => {
    const { mw } = setup(fakeTool(mkdtempSync(join(tmpdir(), 'ogs-t-'))));
    expect((await call(mw(), 'PUT', '/x/store/keys/fal', { 'content-type': 'application/json' }, JSON.stringify({ key: SECRET }))).status).toBe(200);
    const seen: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
      seen.push({ url: String(url), init });
      return new Response(JSON.stringify({ detail: 'Insufficient credits' }), { status: 402, headers: { 'content-type': 'application/json', 'set-cookie': 'a=b' } });
    }));
    const r = await call(mw(), 'POST', '/x/store/proxy', { 'x-ogs-target': 'https://queue.fal.run/fal-ai/flux', 'x-ogs-method': 'POST', 'x-ogs-auth': '1', authorization: 'Bearer ogs:****abcd', 'content-type': 'application/json' }, '{"prompt":"hi"}');
    expect(r.status).toBe(402);
    expect(r.text).toBe('{"detail":"Insufficient credits"}');
    expect(r.headers['set-cookie']).toBeUndefined();
    expect(`${r.text}${JSON.stringify(r.headers)}`).not.toContain(SECRET);
    const sent = new Headers(seen[0].init.headers as Record<string, string>);
    expect(sent.get('authorization')).toBe(`Key ${SECRET}`);
    expect(sent.get('x-ogs')).toBeNull();
    expect(seen[0].url).toBe('https://queue.fal.run/fal-ai/flux');
  });

  it('a call without the auth marker gets no key; a missing key is a 401 the page can read', async () => {
    const { mw } = setup(fakeTool(mkdtempSync(join(tmpdir(), 'ogs-t-'))));
    const f = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', f);
    await call(mw(), 'POST', '/x/store/proxy', { 'x-ogs-target': 'https://api.fal.ai/v1/models', 'x-ogs-method': 'GET' });
    expect(new Headers((f.mock.calls[0] as unknown as [URL, RequestInit])[1].headers as Record<string, string>).get('authorization')).toBeNull();
    const r = await call(mw(), 'POST', '/x/store/proxy', { 'x-ogs-target': 'https://openrouter.ai/api/v1/models', 'x-ogs-method': 'GET', 'x-ogs-auth': '1' });
    expect(r.status).toBe(401);
    expect(JSON.parse(r.text).error).toContain('openrouter');
  });

  it('GET /keys says only whether a key exists and its last 4 characters', async () => {
    const { mw } = setup(fakeTool(mkdtempSync(join(tmpdir(), 'ogs-t-'))));
    await call(mw(), 'PUT', '/x/store/keys/atlas', { 'content-type': 'application/json' }, JSON.stringify({ key: SECRET }));
    const r = await call(mw(), 'GET', '/x/store/keys');
    expect(r.text).not.toContain(SECRET);
    expect(JSON.parse(r.text).providers.atlas).toEqual({ set: true, last4: SECRET.slice(-4), where: 'keyring' });
    expect(JSON.parse(r.text).providers.fal).toEqual({ set: false });
  });
});

describe('providerFetch (page side)', () => {
  it('a marked request goes to the proxy with the real target and no auth header; unmarked and other hosts stay direct', async () => {
    const f = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', f);
    await providerFetch('https://api.atlascloud.ai/public/v1/balance', { headers: { Authorization: 'Bearer ogs:****abcd' } });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    const h = init.headers as Headers;
    expect(url).toBe('/x/store/proxy');
    expect(h.get('x-ogs-target')).toBe('https://api.atlascloud.ai/public/v1/balance');
    expect(h.get('authorization')).toBeNull();
    await providerFetch('https://api.fal.ai/v1/models');
    expect(f.mock.calls[1][0]).toBe('https://api.fal.ai/v1/models');
    await providerFetch('https://elsewhere.example/x', { headers: { Authorization: 'Bearer ogs:****abcd' } });
    expect(f.mock.calls[2][0]).toBe('https://elsewhere.example/x');
  });
});

describe('keys: keyring, migration, fallback', () => {
  const stateWith = (keys: Record<string, string>) => `{"savedAt":100,"state":{"settings":{"keys":${JSON.stringify(keys)},"x":1},"sessions":{}},"version":1}`;

  it('migrates a state.json key into the keyring: dated copy (600) beside the file, key out of the file, still usable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ogs-mig-'));
    mkdirSync(join(root, 'data'));
    writeFileSync(join(root, 'data', 'state.json'), stateWith({ fal: SECRET, atlas: '' }));
    process.env.OGS_SECRET_TOOL = fakeTool(root);
    let mw: Mw = () => undefined;
    (localStore(root).configureServer as unknown as (s: unknown) => void)({ middlewares: { use: (fn: Mw) => (mw = fn) } });
    const st = await call(mw, 'GET', '/x/store/state');
    expect(st.text).not.toContain(SECRET);
    expect(JSON.parse(st.text).state.settings.keys.fal).toBe('ogs:****abcd');
    expect(readFileSync(join(root, 'data', 'state.json'), 'utf8')).not.toContain(SECRET);
    const copies = require('node:fs').readdirSync(join(root, 'data')).filter((f: string) => f.startsWith('state.json.bak-keys-'));
    expect(copies).toHaveLength(1);
    expect(require('node:fs').statSync(join(root, 'data', copies[0])).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(root, 'data', copies[0]), 'utf8')).toContain(SECRET); // the copy is the way back
    expect(readFileSync(join(root, 'ring', 'fal'), 'utf8')).toBe(SECRET);
    expect(require('node:fs').existsSync(join(root, 'data', 'keys.json'))).toBe(false);
  });

  it('without secret-tool the key is not lost: it moves to keys.json (600) with a visible warning', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ogs-mig-'));
    mkdirSync(join(root, 'data'));
    writeFileSync(join(root, 'data', 'state.json'), stateWith({ fal: SECRET }));
    process.env.OGS_SECRET_TOOL = join(root, 'missing-tool');
    let mw: Mw = () => undefined;
    (localStore(root).configureServer as unknown as (s: unknown) => void)({ middlewares: { use: (fn: Mw) => (mw = fn) } });
    const r = JSON.parse((await call(mw, 'GET', '/x/store/keys')).text);
    expect(r.providers.fal).toMatchObject({ set: true, where: 'file' });
    expect(r.warning).toMatch(/keyring/i);
    const file = join(root, 'data', 'keys.json');
    expect(JSON.parse(readFileSync(file, 'utf8')).fal).toBe(SECRET);
    expect(require('node:fs').statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(root, 'data', 'state.json'), 'utf8')).not.toContain(SECRET);
  });

  it('a failing secret-tool that also cannot write keys.json leaves the key in the file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ogs-mig-'));
    mkdirSync(join(root, 'data'));
    writeFileSync(join(root, 'data', 'state.json'), stateWith({ fal: SECRET }));
    mkdirSync(join(root, 'data', 'keys.json')); // a directory where the file should go: the write fails
    process.env.OGS_SECRET_TOOL = join(root, 'missing-tool');
    let mw: Mw = () => undefined;
    (localStore(root).configureServer as unknown as (s: unknown) => void)({ middlewares: { use: (fn: Mw) => (mw = fn) } });
    await call(mw, 'GET', '/x/store/keys');
    expect(readFileSync(join(root, 'data', 'state.json'), 'utf8')).toContain(SECRET);
  });

  it('the secret reaches secret-tool on stdin, never as an argument', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ogs-mig-'));
    mkdirSync(join(root, 'data'));
    const argsLog = join(root, 'args.log');
    const bin = join(root, 'secret-tool');
    writeFileSync(bin, `#!/bin/sh\necho "$@" >> ${JSON.stringify(argsLog)}\ncase $1 in store) cat > ${JSON.stringify(join(root, 'stored'))};; lookup) cat ${JSON.stringify(join(root, 'stored'))} 2>/dev/null || exit 1;; esac\n`);
    chmodSync(bin, 0o755);
    process.env.OGS_SECRET_TOOL = bin;
    let mw: Mw = () => undefined;
    (localStore(root).configureServer as unknown as (s: unknown) => void)({ middlewares: { use: (fn: Mw) => (mw = fn) } });
    await call(mw, 'PUT', '/x/store/keys/nanogpt', { 'content-type': 'application/json' }, JSON.stringify({ key: SECRET }));
    expect(readFileSync(argsLog, 'utf8')).not.toContain(SECRET);
    expect(readFileSync(join(root, 'stored'), 'utf8')).toBe(SECRET);
  });
});
