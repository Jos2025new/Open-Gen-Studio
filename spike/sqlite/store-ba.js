// SPIKE round 4, variant BA (B + A):
// - B on commit: the client sends changes by record id (`delta`), and the server keeps NO in-memory mirror of records
//   (only a 11-char md5 fingerprint `fp` per row in SQLite), avoiding the ~24.5 MB/commit slice retention leak of base/A.
// - A on idle and startup: `idle()` writes an assembled state copy (`state-cache.txt` with header
//   `OGSCACHE1 <savedAt> <version> <utf8 bytes>`) and checkpoints the WAL; `read()` validates the copy header and size
//   against `head` (`saved_at`, `version`) and falls back to assembling from SQLite tables if missing, stale or torn.
import { DatabaseSync } from 'node:sqlite';
import { closeSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createStoreB, SCHEMA_VERSION } from './store-b.js';

export { SCHEMA_VERSION };
const MAGIC = 'OGSCACHE1';

export function createStoreBA(dir, opts = {}) {
  const inner = createStoreB(dir, opts);
  const cacheFile = join(dir, 'state-cache.txt');
  const headDb = new DatabaseSync(inner.file, { readOnly: true });
  const headGet = headDb.prepare('SELECT saved_at, version FROM head WHERE id = 1');
  const verGet = headDb.prepare('PRAGMA user_version');
  let dirty = true;
  let lastReadSource = null;

  /** Header of `state-cache.txt`, or null when absent or malformed. */
  function header() {
    let fd;
    try {
      fd = openSync(cacheFile, 'r');
      const buf = Buffer.alloc(80);
      const n = readSync(fd, buf, 0, 80, 0);
      const line = buf.toString('utf8', 0, n).split('\n', 1)[0];
      const [magic, savedAt, version, bytes] = line.split(' ');
      if (magic !== MAGIC) return null;
      return {
        savedAt: Number(savedAt),
        version: Number(version),
        bytes: Number(bytes),
        skip: Buffer.byteLength(line) + 1,
      };
    } catch {
      return null;
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }

  function read() {
    const h = headGet.get();
    if (!h) {
      lastReadSource = 'empty';
      return null;
    }
    const c = header();
    if (c && c.savedAt === h.saved_at && c.version === h.version) {
      let fileSize = 0;
      try { fileSize = statSync(cacheFile).size; } catch { fileSize = 0; }
      if (fileSize === c.skip + c.bytes) {
        const raw = readFileSync(cacheFile);
        const text = raw.toString('utf8', c.skip);
        if (text.startsWith(`{"savedAt":${h.saved_at},`) && text.endsWith('}')) {
          lastReadSource = 'copy';
          return text;
        }
      }
    }
    lastReadSource = 'tables';
    return inner.read();
  }

  function commit(body) {
    const r = inner.commit(body);
    if (r.status === 204) dirty = true;
    return r;
  }

  /** Idle maintenance: refreshes `state-cache.txt` if HEAD moved, then checkpoints the WAL. Returns bytes written. */
  function idle() {
    let wrote = 0;
    if (dirty) {
      const h = headGet.get();
      const text = inner.read();
      if (text != null && h) {
        const bytes = Buffer.byteLength(text);
        const tmp = `${cacheFile}.tmp`;
        writeFileSync(tmp, `${MAGIC} ${h.saved_at} ${h.version} ${bytes}\n${text}`, { mode: 0o600 });
        renameSync(tmp, cacheFile);
        wrote = bytes;
      }
      dirty = false;
    }
    inner.checkpoint();
    return wrote;
  }

  function sizes() {
    const base = inner.sizes();
    let cache = 0;
    try { cache = statSync(cacheFile).size; } catch { cache = 0; }
    return { ...base, cache };
  }

  return {
    ...inner,
    read,
    commit,
    idle,
    sizes,
    cacheFile,
    lastReadSource: () => lastReadSource,
    schemaVersion: () => verGet.get().user_version,
    close: () => {
      headDb.close();
      inner.close();
    },
  };
}
