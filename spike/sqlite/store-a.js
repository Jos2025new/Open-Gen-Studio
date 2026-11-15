// SPIKE round 3, variant A: same contract and same store as store-sqlite.js, plus a copy of the assembled state text
// (the exact string read() returns) written when the store is idle and read at startup. Nothing else changes.
// The copy is derived data: a file `state-cache.txt` = one header line `OGSCACHE1 <savedAt> <version> <utf8 bytes>` + the text.
// It is used only when the header matches HEAD (savedAt and version) and the byte length matches the file; otherwise
// read() falls back to the table assembly. A kill -9 during the write leaves a tmp file (never renamed) or an old copy
// whose savedAt no longer matches HEAD: both fall back.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, renameSync, statSync, writeFileSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { createStoreSqlite } from './store-sqlite.js';

const MAGIC = 'OGSCACHE1';

export function createStoreA(dir, opts = {}) {
  const inner = createStoreSqlite(dir, opts);
  const cacheFile = join(dir, 'state-cache.txt');
  const headDb = new DatabaseSync(inner.file, { readOnly: true });
  const headGet = headDb.prepare('SELECT saved_at, version FROM head WHERE id = 1');
  let dirty = true;
  let lastReadSource = null;

  /** Header of the copy, or null when absent or malformed. */
  function header() {
    let fd;
    try {
      fd = openSync(cacheFile, 'r');
      const buf = Buffer.alloc(80);
      const n = readSync(fd, buf, 0, 80, 0);
      const line = buf.toString('utf8', 0, n).split('\n', 1)[0];
      const [magic, savedAt, version, bytes] = line.split(' ');
      if (magic !== MAGIC) return null;
      return { savedAt: Number(savedAt), version: Number(version), bytes: Number(bytes), skip: Buffer.byteLength(line) + 1 };
    } catch { return null; } finally { if (fd !== undefined) closeSync(fd); }
  }

  function read() {
    const h = headGet.get();
    if (!h) { lastReadSource = 'empty'; return null; }
    const c = header();
    if (c && c.savedAt === h.saved_at && c.version === h.version && statSync(cacheFile).size === c.skip + c.bytes) {
      const raw = readFileSync(cacheFile);
      const text = raw.toString('utf8', c.skip);
      // Cheap content check: the text carries its own savedAt first; it must be HEAD's.
      if (text.startsWith(`{"savedAt":${h.saved_at},`) && text.endsWith('}')) { lastReadSource = 'copy'; return text; }
    }
    lastReadSource = 'tables';
    return inner.read();
  }

  function commit(body) {
    const r = inner.commit(body);
    if (r.status === 204) dirty = true;
    return r;
  }

  /** Idle maintenance: refreshes the copy if HEAD moved, then checkpoints. Returns ms spent building and writing the copy. */
  function idle() {
    let wrote = 0;
    if (dirty) {
      const h = headGet.get();
      const text = inner.read();
      if (text != null) {
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

  return { ...inner, read, commit, idle, lastReadSource: () => lastReadSource, close: () => { headDb.close(); inner.close(); } };
}
