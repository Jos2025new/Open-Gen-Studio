// Local disk copy of the app's saved state and media, served by the Vite dev/preview server at /x/store.
// The app has no backend: this only exists while `npm run dev` / `npm run preview` runs. Files live in
// <project>/data (git-ignored): state.json (contains API keys, mode 600) and <ns>/<id>.<ext> media files.
import { execFile } from 'node:child_process';
import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile, appendFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
/** data/logs/app.log rotates here: the previous file is kept as app.log.1 and then overwritten. */
const LOG_MAX_BYTES = 5 * 1024 * 1024;

/**
 * ffmpeg arguments that join clips in order into one MP4 (join_clips). Every clip is scaled and padded to the
 * first clip's size at 30 fps; a clip without sound gets silence of its length, so the audio stays in sync.
 * Music (O4, OpenMontage sound guide: music 18–20 dB under the voice): looped and cut to the video, faded out;
 * when the clips have sound, it ducks under it (sidechain compression keyed by the clips' audio). All in one pass.
 * @param {Array<{ path: string, audio: boolean, duration: number }>} clips
 * @param {{ width: number, height: number }} size
 * @param {string} out
 * @param {string} [music]
 * @param {{ loudnorm?: boolean }} [opts] loudnorm: the final mix at −14 LUFS (social platforms).
 */
export function joinArgs(clips, size, out, music, opts = {}) {
  const w = size.width + (size.width % 2);
  const h = size.height + (size.height % 2);
  const inputs = [];
  const filters = [];
  clips.forEach((c, i) => {
    inputs.push('-i', c.path);
    filters.push(`[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${i}]`);
    filters.push(
      c.audio
        ? `[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}]`
        : `anullsrc=r=48000:cl=stereo,atrim=0:${Math.max(0.1, c.duration).toFixed(3)}[a${i}]`,
    );
  });
  const pairs = clips.map((_, i) => `[v${i}][a${i}]`).join('');
  const n = clips.length;
  const last = opts.loudnorm ? 'mix' : 'a';
  if (music) {
    const total = clips.reduce((t, c) => t + Math.max(0.1, c.duration), 0);
    const speech = clips.some((c) => c.audio);
    inputs.push('-stream_loop', '-1', '-i', music);
    filters.push(`${pairs}concat=n=${n}:v=1:a=1[v][ca]`);
    // Alone, the music is the soundtrack (≈ −2 dB); under the clips' sound it starts at ≈ −9 dB and ducks further.
    filters.push(`[${n}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${total.toFixed(3)},volume=${speech ? 0.35 : 0.8},afade=t=out:st=${Math.max(0, total - 2).toFixed(3)}:d=2[m]`);
    if (speech) {
      filters.push('[ca]asplit=2[cm][key]');
      filters.push('[m][key]sidechaincompress=threshold=0.02:ratio=10:attack=20:release=400[md]');
      filters.push(`[cm][md]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[${last}]`);
    } else filters.push(`[ca][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[${last}]`);
  } else filters.push(`${pairs}concat=n=${n}:v=1:a=1[v][${last}]`);
  if (opts.loudnorm) filters.push('[mix]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[a]');
  return [
    '-y', '-loglevel', 'error', ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart',
    out,
  ];
}

/** Size, length and whether the clip has sound, from ffprobe. */
async function probe(path) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', path]);
  const j = JSON.parse(stdout);
  const v = j.streams?.find((s) => s.codec_type === 'video');
  return { width: v?.width ?? 0, height: v?.height ?? 0, audio: Boolean(j.streams?.some((s) => s.codec_type === 'audio')), duration: Number(j.format?.duration) || 0 };
}

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

  // State writes run one at a time, check and write together: two tabs can never both pass the baseAt check
  // before either writes. A failed write does not stop the queue.
  let stateQueue = Promise.resolve();
  function serialState(fn) {
    const run = stateQueue.then(fn);
    stateQueue = run.catch(() => undefined);
    return run;
  }

  /** Write via a temp file + rename, so an interrupted write never leaves a broken file. */
  async function atomic(path, data, mode) {
    await mkdir(dirname(path), { recursive: true });
    // Each write has its own temp file: two writes at once never share (or rename away) each other's.
    const tmp = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, data, { mode });
      await rename(tmp, path);
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
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
        // A tab says which saved state it worked from (baseAt). If the file has moved on since (another tab saved),
        // the write is refused instead of overwriting newer work with an older copy. No baseAt: accepted (older app).
        const next = await body(req);
        const base = /^\{"savedAt":\d+,"baseAt":(\d+)/.exec(next.toString('utf8', 0, 80))?.[1];
        const conflict = await serialState(async () => {
          if (base != null) {
            const head = await readFile(stateFile).then((b) => b.toString('utf8', 0, 40)).catch(() => '');
            const current = /^\{"savedAt":(\d+)/.exec(head)?.[1];
            if (current && current !== base) return Number(current);
          }
          await atomic(stateFile, next, 0o600);
          return null;
        });
        if (conflict != null) return send(409, JSON.stringify({ savedAt: conflict }), 'application/json');
        return send(204);
      }
    }

    if (path === '/blobs' && req.method === 'GET') {      const keys = [];
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

    // join_clips: the clips are already in data/ (the app writes them first); the joined MP4 is returned, not kept.
    if (path === '/join' && req.method === 'POST') {
      const { keys, music, loudnorm } = JSON.parse(String(await body(req)) || '{}');
      if (!Array.isArray(keys) || keys.length < 2 || keys.length > 20) return send(400, 'join needs 2 to 20 clips');
      const clips = [];
      for (const k of keys) {
        const key = parseKey(String(k));
        const file = key && (await findBlob(key.ns, key.id));
        if (!file) return send(404, `clip ${k} is not on disk`);
        clips.push({ path: file, ...(await probe(file).catch(() => null)) });
      }
      if (clips.some((c) => !c.width)) return send(422, 'a clip has no video stream');
      let musicFile = null;
      if (music) {
        const key = parseKey(String(music));
        musicFile = key && (await findBlob(key.ns, key.id));
        if (!musicFile) return send(404, `music ${music} is not on disk`);
      }
      const out = join(dir, 'tmp', `join-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`);
      await mkdir(dirname(out), { recursive: true });
      try {
        await run('ffmpeg', joinArgs(clips, clips[0], out, musicFile, { loudnorm: loudnorm === true }), { maxBuffer: 1 << 24 });
        return send(200, await readFile(out), 'video/mp4');
      } catch (err) {
        if (err?.code === 'ENOENT') return send(501, 'ffmpeg is not installed on this computer');
        return send(500, `ffmpeg failed: ${String(err?.stderr || err?.message || err).slice(0, 400)}`);
      } finally {
        await rm(out, { force: true });
      }
    }

    // One JSON line per event that matters (T5). Rotated at 5 MB: app.log becomes app.log.1 and a fresh one starts.
    if (path === '/log' && req.method === 'POST') {
      const text = (await body(req)).toString('utf8').slice(0, 4000).replace(/[\r\n]+/g, ' ');
      const logDir = join(dir, 'logs');
      const logFile = join(logDir, 'app.log');
      await mkdir(logDir, { recursive: true });
      const size = await stat(logFile).then((s) => s.size).catch(() => 0);
      if (size > LOG_MAX_BYTES) await rename(logFile, join(logDir, 'app.log.1')).catch(() => undefined);
      await appendFile(logFile, `${text}\n`, { mode: 0o600 });
      return send(204);
    }

    // What is on disk: the folder and the size of each part (Settings → Data).
    if (path === '/info' && req.method === 'GET') {
      const parts = {};
      for (const ns of await readdir(dir).catch(() => [])) {
        if (ns === 'tmp') continue;
        const full = join(dir, ns);
        const st = await stat(full).catch(() => null);
        if (!st) continue;
        if (st.isFile()) { parts[ns] = { files: 1, bytes: st.size }; continue; }
        let files = 0, bytes = 0;
        for (const f of await readdir(full).catch(() => [])) {
          const fs = await stat(join(full, f)).catch(() => null);
          if (fs?.isFile()) { files++; bytes += fs.size; }
        }
        parts[ns] = { files, bytes };
      }
      return send(200, JSON.stringify({ path: dir, parts }), 'application/json');
    }

    // Everything as a ZIP (media folders + state.json without the API keys). Built in data/tmp and removed after.
    if (path === '/export' && req.method === 'GET') {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const work = join(dir, 'tmp', `export-${stamp}`);
      const out = join(dir, 'tmp', `export-${stamp}.zip`);
      await mkdir(work, { recursive: true });
      try {
        const raw = await readFile(join(dir, 'state.json'), 'utf8').catch(() => '');
        if (raw) {
          const saved = JSON.parse(raw);
          const keys = saved?.state?.settings?.keys;
          if (keys) for (const k of Object.keys(keys)) keys[k] = '';
          await writeFile(join(work, 'state.json'), JSON.stringify(saved, null, 1));
        }
        const folders = [];
        for (const ns of await readdir(dir).catch(() => [])) {
          if (ns !== 'tmp' && SAFE.test(ns) && (await stat(join(dir, ns))).isDirectory()) folders.push(ns);
        }
        if (folders.length) await run('zip', ['-rq', out, ...folders, '-x', '*.tmp'], { cwd: dir, maxBuffer: 1 << 24 });
        if (raw) await run('zip', ['-jq', out, join(work, 'state.json')]);
        res.setHeader('Content-Disposition', `attachment; filename="open-gen-studio-${stamp.slice(0, 10)}.zip"`);
        return send(200, await readFile(out), 'application/zip');
      } catch (err) {
        if (err?.code === 'ENOENT') return send(501, 'zip is not installed on this computer');
        throw err;
      } finally {
        await rm(work, { recursive: true, force: true });
        await rm(out, { force: true });
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
