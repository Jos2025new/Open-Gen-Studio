// Local-only brand folder export for Inkscape: writes <DATA_DIR>/brand-exports/<kit>/assets-<ver>/, tokens.json,
// and atomically points <kit>/vigente -> assets-<ver> so external SVGs referencing vigente/<logo>.png update in one step.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const SAFE_SLUG = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
const SAFE_FILE = /^[a-z0-9][a-z0-9._-]{0,120}\.(png|svg|jpg|jpeg|webp)$/i;
const MAX_BODY_BYTES = 40 * 1024 * 1024;

/** 127.0.0.0/8 and ::1, also as IPv4-mapped IPv6 (::ffff:127.x.x.x). */
const isLoopback = (addr) => typeof addr === 'string' && (addr === '::1' || /^(::ffff:)?127\.\d+\.\d+\.\d+$/.test(addr));

function decodeDataUrl(dataUrl) {
  const m = /^data:[^;]+;base64,(.+)$/s.exec(String(dataUrl || ''));
  if (!m) throw new Error('Invalid asset data URL');
  return Buffer.from(m[1], 'base64');
}

export async function syncBrandExportOnDisk(rootDir, payload) {
  const kitSlug = String(payload?.kitSlug || '').trim();
  const versionId = String(payload?.versionId || '').trim();
  if (!SAFE_SLUG.test(kitSlug)) throw new Error('Invalid kitSlug');
  if (!SAFE_SLUG.test(versionId)) throw new Error('Invalid versionId');
  const assets = Array.isArray(payload?.assets) ? payload.assets : [];
  const baseDir = path.resolve(rootDir, 'brand-exports');
  const kitDir = path.resolve(baseDir, kitSlug);
  if (!kitDir.startsWith(baseDir + path.sep)) throw new Error('Invalid kit path');
  const verName = `assets-${versionId}`;
  const versionDir = path.resolve(kitDir, verName);
  if (!versionDir.startsWith(kitDir + path.sep)) throw new Error('Invalid version path');

  await fs.mkdir(versionDir, { recursive: true });
  const files = [];
  for (const a of assets) {
    const filename = String(a?.filename || '').trim();
    if (!SAFE_FILE.test(filename)) throw new Error(`Invalid filename: ${filename}`);
    const dest = path.resolve(versionDir, filename);
    if (!dest.startsWith(versionDir + path.sep)) throw new Error('Invalid asset path');
    await fs.writeFile(dest, decodeDataUrl(a.dataUrl));
    files.push(filename);
  }
  if (typeof payload?.tokensJson === 'string') {
    await fs.writeFile(path.join(kitDir, 'tokens.json'), payload.tokensJson, 'utf8');
  }
  const vigentePath = path.join(kitDir, 'vigente');
  const existing = await fs.lstat(vigentePath).catch((e) => (e?.code === 'ENOENT' ? null : Promise.reject(e)));
  if (existing && !existing.isSymbolicLink()) {
    const err = new Error('vigente exists and is not a symlink');
    err.statusCode = 409;
    throw err;
  }
  const tmpLink = path.join(kitDir, `.vigente.tmp-${crypto.randomUUID()}`);
  await fs.symlink(verName, tmpLink, 'dir');
  try {
    await fs.rename(tmpLink, vigentePath);
  } catch (err) {
    await fs.rm(tmpLink, { force: true }).catch(() => undefined);
    throw err;
  }
  return { dir: kitDir, vigentePath, versionDir, files };
}

async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new Error('Payload too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function brandExport(dataDir = path.resolve(process.cwd(), 'data')) {
  const root = path.resolve(dataDir);
  const handler = async (req, res, next) => {
    if (req.method !== 'POST' || req.url !== '/x/brand-export/sync') return next();
    const send = (status, data, type = 'text/plain') => {
      res.statusCode = status;
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'no-store');
      res.end(data);
    };
    if (!isLoopback(req.socket?.remoteAddress)) return send(403, 'Local requests only');
    const origin = req.headers?.origin;
    if (req.headers?.['x-ogs'] !== '1' || (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`)) {
      return send(403, 'Writes only from the app');
    }
    try {
      const payload = JSON.parse(await readBody(req));
      const result = await syncBrandExportOnDisk(root, payload);
      send(200, JSON.stringify(result), 'application/json');
    } catch (err) {
      const status = typeof err?.statusCode === 'number' ? err.statusCode : 400;
      send(status, err instanceof Error ? err.message : 'Brand export failed');
    }
  };
  return {
    name: 'brand-export',
    configureServer: (s) => void s.middlewares.use(handler),
    configurePreviewServer: (s) => void s.middlewares.use(handler),
  };
}
