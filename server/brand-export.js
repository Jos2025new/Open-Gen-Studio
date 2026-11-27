// Local-only brand folder export for Inkscape: validates everything first, writes atomically to a staged version dir,
// verifies realpath containment (no symlink escapes), updates <kit>/vigente symlink, and writes tokens.json atomically.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const SAFE_SLUG = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
const SAFE_FILE = /^[a-z0-9][a-z0-9._-]{0,120}\.(png|svg|jpg|jpeg|webp)$/i;
const MAX_BODY_BYTES = 40 * 1024 * 1024;

/** 127.0.0.0/8 and ::1, also as IPv4-mapped IPv6 (::ffff:127.x.x.x). */
const isLoopback = (addr) => typeof addr === 'string' && (addr === '::1' || /^(::ffff:)?127\.\d+\.\d+\.\d+$/.test(addr));

function decodeDataUrl(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(String(dataUrl || ''));
  if (!m) throw new Error('Invalid asset data URL');
  return { mime: m[1].toLowerCase(), buf: Buffer.from(m[2], 'base64') };
}

function validMagicBytes(filename, buf) {
  if (!buf.length) return false;
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.png') return buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (ext === '.jpg' || ext === '.jpeg') return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (ext === '.webp') return buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP';
  if (ext === '.svg') {
    const head = buf.subarray(0, 512).toString('utf8').trimStart();
    return head.startsWith('<svg') || head.startsWith('<?xml');
  }
  return false;
}

async function assertNoSymlink(p) {
  const st = await fs.lstat(p).catch((e) => (e?.code === 'ENOENT' ? null : Promise.reject(e)));
  if (st?.isSymbolicLink()) {
    const err = new Error(`Refusing to write through symlink: ${path.basename(p)}`);
    err.statusCode = 403;
    throw err;
  }
  return st;
}

export async function syncBrandExportOnDisk(rootDir, payload) {
  // 1. Validate the entire payload BEFORE touching disk so failed requests never mutate visible state.
  const kitSlug = String(payload?.kitSlug || '').trim();
  const versionId = String(payload?.versionId || '').trim();
  if (!SAFE_SLUG.test(kitSlug)) throw new Error('Invalid kitSlug');
  if (!SAFE_SLUG.test(versionId)) throw new Error('Invalid versionId');
  const rawAssets = Array.isArray(payload?.assets) ? payload.assets : [];
  const prepared = [];
  const seenNames = new Set();
  for (const a of rawAssets) {
    const filename = String(a?.filename || '').trim();
    if (!SAFE_FILE.test(filename) || seenNames.has(filename.toLowerCase())) throw new Error(`Invalid filename: ${filename}`);
    seenNames.add(filename.toLowerCase());
    const { buf } = decodeDataUrl(a?.dataUrl);
    if (!validMagicBytes(filename, buf)) throw new Error(`Invalid file bytes for ${filename}`);
    prepared.push({ filename, buf });
  }
  let tokensJson = null;
  if (payload?.tokensJson !== undefined) {
    if (typeof payload.tokensJson !== 'string') throw new Error('Invalid tokensJson');
    try { JSON.parse(payload.tokensJson); } catch { throw new Error('Malformed tokensJson'); }
    tokensJson = payload.tokensJson;
  }

  // 2. Verify containment & existing symlink state BEFORE writing anything.
  const baseDir = path.resolve(rootDir, 'brand-exports');
  await assertNoSymlink(baseDir);
  await fs.mkdir(baseDir, { recursive: true });
  const realBase = await fs.realpath(baseDir);

  const kitDir = path.resolve(realBase, kitSlug);
  if (!kitDir.startsWith(realBase + path.sep)) throw new Error('Invalid kit path');
  await assertNoSymlink(kitDir);

  const vigentePath = path.join(kitDir, 'vigente');
  const existingVigente = await fs.lstat(vigentePath).catch((e) => (e?.code === 'ENOENT' ? null : Promise.reject(e)));
  if (existingVigente && !existingVigente.isSymbolicLink()) {
    const err = new Error('vigente exists and is not a symlink');
    err.statusCode = 409;
    throw err;
  }

  await fs.mkdir(kitDir, { recursive: true });
  const realKitDir = await fs.realpath(kitDir);
  if (!realKitDir.startsWith(realBase + path.sep)) {
    const err = new Error('Kit directory escapes brand-exports root');
    err.statusCode = 403;
    throw err;
  }

  // 3. Stage all files + tokens into a brand-new immutable version directory so live readers never see partial writes.
  const baseVerName = `assets-${versionId}`;
  const baseExists = await fs.lstat(path.join(realKitDir, baseVerName)).then(() => true, () => false);
  const verName = baseExists ? `${baseVerName}-${crypto.randomUUID().slice(0, 8)}` : baseVerName;
  const stageDir = path.join(realKitDir, `.staging-${crypto.randomUUID()}`);
  const versionDir = path.join(realKitDir, verName);

  await fs.mkdir(stageDir, { recursive: false });
  const files = [];
  try {
    for (const { filename, buf } of prepared) {
      const dest = path.resolve(stageDir, filename);
      if (!dest.startsWith(stageDir + path.sep)) throw new Error('Invalid asset path');
      await fs.writeFile(dest, buf);
      files.push(filename);
    }
    if (tokensJson !== null) {
      await fs.writeFile(path.join(stageDir, 'tokens.json'), tokensJson, 'utf8');
    }
    await fs.rename(stageDir, versionDir);
  } catch (err) {
    await fs.rm(stageDir, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }

  // 4. Atomically swap vigente symlink -> verName, then atomically update top-level tokens.json.
  const tmpLink = path.join(realKitDir, `.vigente.tmp-${crypto.randomUUID()}`);
  await fs.symlink(verName, tmpLink, 'dir');
  try {
    await fs.rename(tmpLink, path.join(realKitDir, 'vigente'));
  } catch (err) {
    await fs.rm(tmpLink, { force: true }).catch(() => undefined);
    throw err;
  }
  if (tokensJson !== null) {
    const tmpTok = path.join(realKitDir, `.tokens.tmp-${crypto.randomUUID()}`);
    await fs.writeFile(tmpTok, tokensJson, 'utf8');
    try {
      await fs.rename(tmpTok, path.join(realKitDir, 'tokens.json'));
    } catch (err) {
      await fs.rm(tmpTok, { force: true }).catch(() => undefined);
      throw err;
    }
  }
  return { dir: realKitDir, vigentePath: path.join(realKitDir, 'vigente'), versionDir, files };
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
