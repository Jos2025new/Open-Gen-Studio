// Local-only brand folder export for Inkscape: writes <DATA_DIR>/brand-exports/<kit>/assets-<ver>/, tokens.json,
// and atomically points <kit>/vigente -> assets-<ver> so external SVGs referencing vigente/<logo>.png update in one step.
import fs from 'node:fs/promises';
import path from 'node:path';

const SAFE_SLUG = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
const SAFE_FILE = /^[a-z0-9][a-z0-9._-]{0,120}\.(png|svg|jpg|jpeg|webp)$/i;
const MAX_BODY_BYTES = 40 * 1024 * 1024;

function isLoopback(addr) {
  return !addr || addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

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
  const tmpLink = path.join(kitDir, `.vigente.tmp-${Date.now()}`);
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
    if (!isLoopback(req.socket?.remoteAddress)) {
      res.statusCode = 403;
      return res.end('Local requests only');
    }
    try {
      const payload = JSON.parse(await readBody(req));
      const result = await syncBrandExportOnDisk(root, payload);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
    } catch (err) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'text/plain');
      res.end(err instanceof Error ? err.message : 'Brand export failed');
    }
  };
  return {
    name: 'brand-export',
    configureServer: (s) => void s.middlewares.use(handler),
    configurePreviewServer: (s) => void s.middlewares.use(handler),
  };
}
