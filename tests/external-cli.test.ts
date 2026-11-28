import { execFile } from 'node:child_process';
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execPath, pid } from 'node:process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExternalCliBridge } from '../server/external-cli.mjs';
import { connectExternalCliTab } from '../src/lib/externalCliTab';

let root: string;
let origin: string;
let bearer: string;
let bridge: ReturnType<typeof createExternalCliBridge>;
let server: ReturnType<typeof createServer>;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(async () => {
  await mkdir('.sandbox', { recursive: true });
  root = await mkdtemp(join(process.cwd(), '.sandbox', 'external-cli-test-'));
  await mkdir(join(root, '.sandbox'));
  server = createServer((req: IncomingMessage, res: ServerResponse) => bridge.middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
  origin = `http://127.0.0.1:${address.port}`;
  bridge = createExternalCliBridge({ port: address.port, timeoutMs: 1000 });
  bridge.publish(root);
  const session = JSON.parse(await readFile(join(root, '.sandbox/external-cli.json'), 'utf8'));
  bearer = `Bearer ${session.token}`;
});

afterEach(async () => {
  bridge?.close();
  server?.closeAllConnections();
  await new Promise<void>((done) => server ? server.close(() => done()) : done());
  if (root) await rm(root, { recursive: true, force: true });
});

const url = (path: string) => `${origin}/x/ext/${path}`;
const cliRequest = (path: string, body?: unknown, signal?: AbortSignal) => fetch(url(path), {
  headers: { Authorization: bearer, 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
  signal,
});
const tabRequest = (path: string, body?: unknown, signal?: AbortSignal) => fetch(url(path), {
  method: 'POST', headers: { Origin: origin, 'X-OGS-External-Tab': '1', 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal,
});

async function linkTab() {
  const controller = new AbortController();
  const response = await tabRequest('tab', undefined, controller.signal);
  expect(response.status).toBe(200);
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  async function next() {
    while (!buffer.includes('\n\n')) {
      const { done, value } = await reader.read();
      if (done) throw new Error('SSE ended');
      buffer += value;
    }
    const end = buffer.indexOf('\n\n');
    const frame = buffer.slice(0, end);
    buffer = buffer.slice(end + 2);
    if (frame.startsWith(':')) throw new Error('Heartbeat before expected event');
    return JSON.parse(frame.slice('data: '.length));
  }
  const { binding } = await next();
  return {
    next,
    reply: (id: string, result: unknown) => tabRequest('result', { binding, id, result }),
    close: () => controller.abort(),
  };
}

function cli(args: string[], stdin?: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((done) => {
    const child = execFile(execPath, ['scripts/ogs-cli.mjs', '--url', origin, '--token', bearer.slice(7), ...args], { timeout: 5000 },
      (error, stdout, stderr) => done({ code: error ? (error.code ?? -1) : 0, stdout, stderr }));
    child.stdin?.end(stdin);
  });
}
describe('sandbox external bridge', () => {
  it('requires the token, checks Host and Origin and protects the session file', async () => {
    expect((await fetch(url('status'))).status).toBe(401);
    expect((await fetch(url('status'), { headers: { Authorization: 'Bearer invalid' } })).status).toBe(401);
    expect((await fetch(url('status'), { headers: { Authorization: bearer, Origin: 'https://external.invalid' } })).status).toBe(403);
    expect((await fetch(url('tab'), { method: 'POST', headers: { Origin: origin } })).status).toBe(403);
    expect(await new Promise((done, reject) => {
      const req = request(url('status'), { headers: { Host: 'external.invalid', Authorization: bearer } }, (res) => { res.resume(); done(res.statusCode); });
      req.on('error', reject);
      req.end();
    })).toBe(403);
    const file = join(root, '.sandbox/external-cli.json');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ url: origin, pid });
    bridge.close();
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('routes once to one binding and fails pending and new requests when the tab closes', async () => {
    const before = await cliRequest('find');
    expect(before.status).toBe(503);
    expect(await before.json()).toMatchObject({ ok: false, error: { code: 'disconnected' } });
    const tab = await linkTab();
    expect(await (await cliRequest('status')).json()).toMatchObject({ ok: true, connected: true });
    expect((await tabRequest('tab')).status).toBe(409);
    const call = cliRequest('run', { cmd: 'sessions.list' });
    const event = await tab.next();
    expect(event).toMatchObject({ operation: 'run', input: { cmd: 'sessions.list' } });
    expect((await cliRequest('run', {})).status).toBe(409);
    expect((await tabRequest('result', { binding: 'wrong', id: event.id, result: { ok: true } })).status).toBe(403);
    expect((await tab.reply(event.id, { ok: true, results: [1] })).status).toBe(204);
    expect(await (await call).json()).toEqual({ ok: true, results: [1] });
    expect((await tab.reply(event.id, { ok: true })).status).toBe(409);
    const pending = cliRequest('find');
    expect(await tab.next()).toMatchObject({ operation: 'find' });
    tab.close();
    expect((await pending).status).toBe(503);
    expect((await cliRequest('find')).status).toBe(503);
    const nextTab = await linkTab();
    nextTab.close();
  });

  it('times out and cancels the tab request before accepting another', async () => {
    const tab = await linkTab();
    const call = cliRequest('run', {});
    const { id } = await tab.next();
    const response = await call;
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'timeout' } });
    expect(await tab.next()).toEqual({ type: 'cancel', id });
    expect((await cliRequest('find')).status).toBe(409);
    expect((await tab.reply(id, { ok: false })).status).toBe(204);
    tab.close();
  });

  it('cancels the real tab transport when the CLI stops waiting', async () => {
    const nativeFetch = fetch;
    vi.stubGlobal('fetch', (path: string | URL, init?: RequestInit) =>
      String(path).startsWith('/') ? nativeFetch(new URL(path, origin), {
        ...init, headers: { ...init?.headers, Origin: origin },
      }) : nativeFetch(path, init));
    const linked = new AbortController();
    const ready = deferred();
    const started = deferred();
    const cancelled = deferred();
    const connection = connectExternalCliTab({
      signal: linked.signal,
      onReady: ready.resolve,
      execute: (_operation, _input, signal) => {
        started.resolve();
        return new Promise((done) => signal.addEventListener('abort', () => {
          cancelled.resolve();
          done({ ok: false });
        }, { once: true }));
      },
    });
    try {
      await ready.promise;
      const controller = new AbortController();
      const call = cliRequest('run', { cmd: 'designer.doc.rename' }, controller.signal);
      await started.promise;
      controller.abort();
      await expect(call).rejects.toMatchObject({ name: 'AbortError' });
      await cancelled.promise;
      await vi.waitFor(async () => expect(await (await cliRequest('status')).json()).toMatchObject({ ok: true, busy: false }));
    } finally {
      linked.abort();
      await connection.catch(() => undefined);
      vi.unstubAllGlobals();
    }
  });

});

describe('ogs executable', () => {
  it('prints help and forwards discovery filters as clean JSON', async () => {
    const help = await cli(['--help']);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('ogs find --schema designer.doc.new');
    const tab = await linkTab();
    const call = cli(['find', '--area', 'designer', '--text', 'document', '--schema', 'designer.doc.new']);
    const event = await tab.next();
    expect(event.input).toEqual({ area: 'designer', text: 'document', schema: 'designer.doc.new' });
    const result = { ok: true, commands: [{ id: 'designer.doc.new', args: { type: 'object' } }] };
    await tab.reply(event.id, result);
    const output = await call;
    expect(output).toMatchObject({ code: 0, stderr: '' });
    expect(JSON.parse(output.stdout)).toEqual(result);
    tab.close();
  });

  it('reads inline, stdin and file JSON and preserves success and failure exit codes', async () => {
    const tab = await linkTab();
    const payload = { cmd: 'designer.doc.read' };
    const json = JSON.stringify(payload);
    const file = join(root, 'request.json');
    await writeFile(file, json);
    for (const [args, stdin] of [[['run', json]], [['run'], json], [['run', '--file', file]]] as const) {
      const call = cli([...args], stdin);
      const event = await tab.next();
      expect(event.input).toEqual(payload);
      const result = stdin ? { ok: false, error: { code: 'denied' } } : { ok: true, results: [] };
      await tab.reply(event.id, result);
      const output = await call;
      expect(output).toMatchObject({ code: result.ok ? 0 : 1, stderr: '' });
      expect(JSON.parse(output.stdout)).toEqual(result);
    }
    tab.close();
    const invalid = await cli(['run', '{']);
    expect(invalid.code).toBe(1);
    expect(JSON.parse(invalid.stdout)).toMatchObject({ ok: false });
  });
});
