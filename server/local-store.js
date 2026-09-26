// Local disk copy of the app's saved state and media, served by the Vite dev/preview server at /x/store.
// The app has no backend: this only exists while `npm run dev` / `npm run preview` runs. Files live in
// <project>/data (git-ignored): state.json (contains API keys, mode 600) and <ns>/<id>.<ext> media files.
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const MIME_EXT = {
  'model/gltf-binary': 'glb',
  'application/zip': 'zip',
  'application/vnd.autodesk.fbx': 'fbx',
  'model/obj': 'obj',
  'model/vnd.usdz+zip': 'usdz',
  'model/vnd.usd': 'usd',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  // Audio: the x- aliases first, so the reverse table maps each extension to the standard type.
  'audio/x-wav': 'wav',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/x-m4a': 'm4a',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/webm': 'weba',
};
const EXT_MIME = Object.fromEntries(Object.entries(MIME_EXT).map(([m, e]) => [e, m]));
const SAFE = /^[A-Za-z0-9_-]+$/;

/** @param {string} [root] project folder (default: where Vite runs, i.e. the project root) */
export function localStore(root = process.cwd()) {
  const dir = join(root, 'data');
  const stateFile = join(dir, 'state.json');

  /** Write via a temp file + rename, so an interrupted write never leaves a broken file. */
  async function atomic(path, data, mode) {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    await writeFile(tmp, data, { mode });
    await rename(tmp, path);
    if (mode) await chmod(path, mode);
  }

  /** "asset:ast_1" → { ns: "asset", id: "ast_1" }; anything else is rejected (no path traversal). */
  function parseKey(key) {
    const [ns, id, extra] = key.split(':');
    return ns && id && extra === undefined && SAFE.test(ns) && SAFE.test(id) ? { ns, id } : null;
  }

  async function findBlob(ns, id) {
    const files = await readdir(join(dir, ns)).catch(() => []);
    const name = files.find((f) => f.startsWith(`${id}.`) && !f.endsWith('.tmp'));
    return name ? join(dir, ns, name) : null;
  }

  async function body(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return Buffer.concat(chunks);
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    const path = url.pathname.slice('/x/store'.length);
    const send = (status, data = '', type = 'text/plain') => {
      res.statusCode = status;
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'no-store');
      res.end(data);
    };

    if (path === '/ping') return send(200, 'ok');

    if (path === '/state') {
      if (req.method === 'GET') return send(200, await readFile(stateFile).catch(() => ''), 'application/json');
      if (req.method === 'PUT') {
        await atomic(stateFile, await body(req), 0o600);
        return send(204);
      }
    }

    if (path === '/blobs' && req.method === 'GET') {
      const keys = [];
      for (const ns of await readdir(dir).catch(() => [])) {
        if (!SAFE.test(ns)) continue;
        for (const f of await readdir(join(dir, ns)).catch(() => [])) {
          const id = f.slice(0, f.lastIndexOf('.'));
          if (SAFE.test(id) && !f.endsWith('.tmp')) keys.push(`${ns}:${id}`);
        }
      }
      return send(200, JSON.stringify(keys), 'application/json');
    }

    if (path.startsWith('/blob/')) {
      const key = parseKey(decodeURIComponent(path.slice('/blob/'.length)));
      if (!key) return send(400, 'bad key');
      const existing = await findBlob(key.ns, key.id);
      if (req.method === 'GET') {
        if (!existing) return send(404);
        return send(200, await readFile(existing), EXT_MIME[existing.split('.').pop()] ?? 'application/octet-stream');
      }
      if (req.method === 'PUT') {
        const ext = MIME_EXT[(req.headers['content-type'] ?? '').split(';')[0]] ?? 'bin';
        const target = join(dir, key.ns, `${key.id}.${ext}`);
        await atomic(target, await body(req));
        if (existing && existing !== target) await rm(existing, { force: true });
        return send(204);
      }
      if (req.method === 'DELETE') {
        if (existing) await rm(existing, { force: true });
        return send(204);
      }
    }

    // "Wipe all data": keep a dated backup instead of deleting, so nothing is lost for good.
    if (path === '/wipe' && req.method === 'POST') {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await rename(dir, join(root, `data.bak-${stamp}`)).catch(() => undefined);
      return send(204);
    }

    return send(404, 'not found');
  }

  const middleware = (req, res, next) => {
    if (!req.url?.startsWith('/x/store/')) return next();
    handle(req, res).catch((err) => {
      res.statusCode = 500;
      res.end(String(err?.message ?? err));
    });
  };

  return {
    name: 'local-store',
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  };
}
