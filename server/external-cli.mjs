import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmodSync, lstatSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PREFIX = '/x/ext/';
const DISCONNECTED = 'Link an Open Gen Studio sandbox tab first.';
const MAX_BODY_BYTES = 256 * 1024;

function send(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(value === undefined ? undefined : JSON.stringify(value));
}

const fail = (res, status, code, message) => send(res, status, { ok: false, error: { code, message } });

async function readJSON(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      req.resume();
      throw new Error('JSON payload exceeds 256 KiB.');
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function event(tab, value) {
  tab.stream.write(`data: ${JSON.stringify(value)}\n\n`);
}

export function createExternalCliBridge({ port, timeoutMs = 60_000 }) {
  const host = `127.0.0.1:${port}`;
  const origin = `http://${host}`;
  const token = randomBytes(32).toString('hex');
  const authorization = Buffer.from(`Bearer ${token}`);
  let file;
  let tab;
  let pending;
  let closed = false;

  function publish(root) {
    const path = resolve(root, '.sandbox/external-cli.json');
    const temp = `${path}.${randomUUID()}`;
    try {
      writeFileSync(temp, JSON.stringify({ url: origin, port, token, pid: process.pid }) + '\n', { mode: 0o600, flag: 'wx' });
      chmodSync(temp, 0o600);
      renameSync(temp, path);
      file = { path, inode: lstatSync(path).ino };
    } finally {
      rmSync(temp, { force: true });
    }
  }

  function complete() {
    const call = pending;
    pending = undefined;
    if (call) {
      clearTimeout(call.timer);
      call.client.off('close', call.clientClosed);
    }
    return call?.client;
  }

  function unlink(bound) {
    if (tab !== bound) return;
    tab = undefined;
    clearInterval(bound.heartbeat);
    const client = complete();
    if (client && !client.destroyed && !client.writableEnded) fail(client, 503, 'disconnected', DISCONNECTED);
    bound.stream.end();
  }

  function close() {
    closed = true;
    if (tab) unlink(tab);
    if (!file) return;
    const { path, inode } = file;
    file = undefined;
    try {
      if (lstatSync(path).ino === inode) rmSync(path);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  function link(res) {
    if (tab) return fail(res, 409, 'already_linked', 'Another sandbox tab is already linked.');
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
    const bound = { binding: randomUUID(), stream: res, heartbeat: setInterval(() => res.write(': heartbeat\n\n'), 5000) };
    tab = bound;
    res.on('close', () => unlink(bound));
    event(bound, { type: 'ready', binding: bound.binding });
  }

  function dispatch(res, operation, input, bound = tab) {
    if (!bound || tab !== bound) return fail(res, 503, 'disconnected', DISCONNECTED);
    if (pending) return fail(res, 409, 'busy', 'The linked tab is handling another request.');
    const id = randomUUID();
    const deadline = Date.now() + timeoutMs;
    const cancel = () => event(bound, { type: 'cancel', id });
    const timer = setTimeout(() => {
      if (!res.destroyed) {
        fail(res, 504, 'timeout', 'The linked tab did not finish in time.');
        cancel();
      }
    }, timeoutMs);
    const clientClosed = () => { if (!res.writableEnded) cancel(); };
    pending = { id, client: res, timer, deadline, clientClosed };
    // Keep the slot until the tab finishes or disconnects, even after the HTTP client leaves.
    res.on('close', clientClosed);
    event(bound, { type: 'request', id, operation, input, deadline });
  }

  async function result(req, res) {
    const body = await readJSON(req);
    if (!tab || body?.binding !== tab.binding) return fail(res, 403, 'forbidden', 'Invalid tab binding.');
    if (!pending || body.id !== pending.id) return fail(res, 409, 'stale', 'This request is no longer pending.');
    if (typeof body.result?.ok !== 'boolean') return fail(res, 400, 'invalid', 'Expected a command result.');
    const expired = Date.now() >= pending.deadline;
    const client = complete();
    if (!client.destroyed && !client.writableEnded) {
      if (expired) fail(client, 504, 'timeout', 'The linked tab did not finish in time.');
      else send(client, 200, body.result);
    }
    send(res, 204);
  }

  async function middleware(req, res, next) {
    if (!req.url?.startsWith(PREFIX)) return next();
    if (req.headersDistinct.host?.length !== 1 || req.headers.host !== host ||
        (req.headers.origin !== undefined && req.headers.origin !== origin)) {
      return fail(res, 403, 'forbidden', 'Expected the sandbox loopback Host and same Origin.');
    }
    if (closed) return fail(res, 503, 'disconnected', DISCONNECTED);
    const url = new URL(req.url, origin);
    const operation = url.pathname.slice(PREFIX.length);
    try {
      if (operation === 'tab' || operation === 'result') {
        if (req.headers.origin !== origin || req.headers['x-ogs-external-tab'] !== '1') {
          return fail(res, 403, 'forbidden', 'Expected a request from the sandbox page.');
        }
        if (req.method !== 'POST') return fail(res, 405, 'method', 'Expected POST.');
        return operation === 'tab' ? link(res) : await result(req, res);
      }
      const supplied = Buffer.from(req.headers.authorization ?? '');
      if (req.headersDistinct.authorization?.length !== 1 || supplied.length !== authorization.length || !timingSafeEqual(supplied, authorization)) {
        return fail(res, 401, 'unauthorized', 'The sandbox Bearer token is required.');
      }
      if (operation === 'find' || operation === 'status') {
        if (req.method !== 'GET') return fail(res, 405, 'method', 'Expected GET.');
        if (operation === 'status') {
          return tab ? send(res, 200, { ok: true, connected: true, busy: Boolean(pending) }) :
            fail(res, 503, 'disconnected', DISCONNECTED);
        }
        return dispatch(res, 'find', Object.fromEntries(url.searchParams));
      }
      if (operation === 'run') {
        if (req.method !== 'POST') return fail(res, 405, 'method', 'Expected POST.');
        const bound = tab;
        if (!bound) {
          req.resume();
          return fail(res, 503, 'disconnected', DISCONNECTED);
        }
        const input = await readJSON(req);
        if (!res.destroyed) return dispatch(res, 'run', input, bound);
        return;
      }
      fail(res, 404, 'unknown', 'Unknown external CLI route.');
    } catch {
      if (!res.destroyed && !res.headersSent) fail(res, 400, 'invalid', 'Expected valid JSON no larger than 256 KiB.');
    }
  }

  return { middleware, publish, close };
}
