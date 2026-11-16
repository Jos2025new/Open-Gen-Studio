// Provider API keys (docs/seguridad.md). The page never holds a key: it sends a key once (PUT /keys/<provider>) and
// afterwards only knows that one exists and its last 4 characters. Keys live in the system keyring (libsecret, through
// `secret-tool`, the key on stdin, never in an argument: arguments show in the process list). Without `secret-tool`
// (or if it fails) they stay in <data>/keys.json (mode 600) and the app says so: a key is never lost silently.
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';

export const PROVIDERS = ['openrouter', 'fal', 'nanogpt', 'atlas'];
/** What the page keeps instead of a key: ASCII (it can travel in a header), never a secret. */
export const KEY_MARKER = 'ogs:';
export const maskOf = (key) => `${KEY_MARKER}****${String(key).slice(-4)}`;
export const isMarker = (v) => typeof v === 'string' && v.startsWith(KEY_MARKER);

/** Strips real (non-marker) API keys from a parsed object's `settings.keys` in place. */
export function sanitizeSettingsKeys(obj) {
  const keys = obj?.settings?.keys;
  if (!keys || typeof keys !== 'object' || Array.isArray(keys)) return false;
  let changed = false;
  for (const [k, v] of Object.entries(keys)) {
    if (typeof v === 'string') {
      if (v.trim() && !isMarker(v)) { keys[k] = ''; changed = true; }
    } else if (v != null && v !== '') {
      keys[k] = ''; changed = true;
    }
  }
  return changed;
}

/** Strips real API keys from JSON text (`nestedState: true` for format-1 `{ state: { settings: { keys } } }`). */
export function sanitizeKeysInText(text, nestedState = false) {
  if (typeof text !== 'string' || (!text.includes('"keys"') && !text.includes('\\u'))) return text;
  let obj;
  try { obj = JSON.parse(text); } catch { return text; }
  return sanitizeSettingsKeys(nestedState ? obj?.state : obj) ? JSON.stringify(obj) : text;
}

/** Runs `secret-tool` with `args`; `input` goes to stdin. Resolves { ok, out }; never throws and never echoes the input. */
function secretTool(bin, args, input) {
  return new Promise((resolve) => {
    let child;
    try {
      child = execFile(bin, args, { timeout: 8000, maxBuffer: 1 << 16 }, (err, stdout) => resolve({ ok: !err, out: String(stdout ?? ''), missing: err?.code === 'ENOENT' }));
    } catch {
      return resolve({ ok: false, out: '', missing: true });
    }
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(input ?? '');
  });
}

/**
 * @param {string} dir data folder (the sandbox and the real data get different keyring entries)
 * @param {{ tool?: string, serialState?: (fn: () => Promise<unknown>) => Promise<unknown> }} [opts] tool: the secret-tool binary
 */
export function createKeyStore(dir, opts = {}) {
  const tool = opts.tool ?? process.env.OGS_SECRET_TOOL ?? 'secret-tool';
  const scope = createHash('sha256').update(dir).digest('hex').slice(0, 16);
  const fileKeys = join(dir, 'keys.json');
  const cache = new Map();
  /** Set when the keyring could not be used: the text the app shows. */
  let warning = '';
  const attrs = (p) => ['service', 'open-gen-studio', 'provider', p, 'store', scope];

  async function keyringPut(p, key) {
    const r = await secretTool(tool, ['store', '--label', `Open Gen Studio — ${p}`, ...attrs(p)], key);
    if (!r.ok) return false;
    return (await keyringGet(p)) === key;
  }
  async function keyringGet(p) {
    const r = await secretTool(tool, ['lookup', ...attrs(p)]);
    return r.ok && r.out ? r.out : null;
  }
  const keyringClear = (p) => secretTool(tool, ['clear', ...attrs(p)]);

  async function readFileKeys() {
    try { return JSON.parse(await readFile(fileKeys, 'utf8')); } catch { return {}; }
  }
  async function writeFileKeys(obj) {
    await mkdir(dir, { recursive: true });
    const tmp = `${fileKeys}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(obj), { mode: 0o600 });
    await rename(tmp, fileKeys);
    await chmod(fileKeys, 0o600);
  }

  /** Where a key is held, or null. Keyring first, then keys.json. */
  async function locate(p) {
    if (await keyringGet(p)) return 'keyring';
    return (await readFileKeys())[p] ? 'file' : null;
  }

  /** The key (server side only). */
  async function get(p) {
    if (!PROVIDERS.includes(p)) return null;
    if (cache.has(p)) return cache.get(p);
    const key = (await keyringGet(p)) || (await readFileKeys())[p] || null;
    if (key) cache.set(p, key);
    return key;
  }

  /** Stores a key: keyring, else keys.json with a warning. Returns where it went; never loses it. */
  async function set(p, key) {
    if (!PROVIDERS.includes(p) || typeof key !== 'string' || !key.trim()) return null;
    key = key.trim();
    cache.delete(p);
    let where = 'keyring';
    if (await keyringPut(p, key)) {
      const f = await readFileKeys();
      if (f[p]) { delete f[p]; await writeFileKeys(f); }
    } else {
      where = 'file';
      warning = `The system keyring is not available (secret-tool): API keys are kept in ${fileKeys} (only your user can read it).`;
      await writeFileKeys({ ...(await readFileKeys()), [p]: key });
    }
    cache.set(p, key);
    return where;
  }

  async function remove(p) {
    cache.delete(p);
    await keyringClear(p);
    const f = await readFileKeys();
    if (f[p]) { delete f[p]; await writeFileKeys(f); }
  }

  /** { provider: { set, last4, where } } and the warning to show (non-empty when a key sits in a file). */
  async function status() {
    const providers = {};
    let inFile = false;
    for (const p of PROVIDERS) {
      const where = await locate(p);
      const key = where ? await get(p) : null;
      providers[p] = key ? { set: true, last4: key.slice(-4), where } : { set: false };
      if (where === 'file') inFile = true;
    }
    return { providers, warning: inFile ? warning || `API keys are kept in ${fileKeys} (only your user can read it); the system keyring is not in use.` : '' };
  }

  /** Real (non-marker) keys found in a parsed state-like object's settings.keys. */
  const realKeys = (settingsKeys) => Object.entries(settingsKeys ?? {}).filter(([p, v]) => PROVIDERS.includes(p) && typeof v === 'string' && v.trim() && !isMarker(v));

  /**
   * One-time migration at start: keys still inside state.json / store-v2/globals.json go to the keyring (or keys.json),
   * and leave the file only after the copy is read back. Before touching a file, a dated copy (mode 600) is made next
   * to it. If a key cannot be stored anywhere, the file keeps it.
   * @returns {Promise<{ migrated: string[], backups: string[], failed: string[] }>}
   */
  async function migrate() {
    const out = { migrated: [], backups: [], failed: [] };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    for (const file of [join(dir, 'state.json'), join(dir, 'store-v2', 'globals.json')]) {
      const text = await readFile(file, 'utf8').catch(() => null);
      if (!text) continue;
      let obj;
      try { obj = JSON.parse(text); } catch { continue; }
      const holder = file.endsWith('globals.json') ? obj : obj?.state;
      const found = realKeys(holder?.settings?.keys);
      if (!found.length) continue;
      const backup = `${file}.bak-keys-${stamp}`;
      await copyFile(file, backup);
      await chmod(backup, 0o600);
      out.backups.push(backup);
      for (const [p, v] of found) {
        const known = await get(p);
        if (known === v.trim()) { holder.settings.keys[p] = maskOf(v.trim()); out.migrated.push(p); continue; }
        if (known) { holder.settings.keys[p] = maskOf(known); out.migrated.push(p); continue; } // a newer key already stored: it wins
        const where = await set(p, v).catch(() => null);
        if (where && (await get(p)) === v.trim()) { holder.settings.keys[p] = maskOf(v.trim()); out.migrated.push(p); } else out.failed.push(p);
      }
      const tmp = `${file}.${randomUUID()}.tmp`;
      await writeFile(tmp, JSON.stringify(obj), { mode: 0o600 });
      await rename(tmp, file);
      await chmod(file, 0o600);
    }
    const sqliteFile = join(dir, 'ogs.sqlite');
    if (existsSync(sqliteFile)) {
      let holder = null;
      try {
        const db = new DatabaseSync(sqliteFile, { readOnly: true });
        try {
          const row = db.prepare('SELECT json FROM small WHERE id = 1').get();
          if (row?.json) holder = JSON.parse(row.json);
        } finally { db.close(); }
      } catch { holder = null; }
      const found = realKeys(holder?.settings?.keys);
      if (found.length) {
        const backup = `${sqliteFile}.bak-keys-${stamp}`;
        await copyFile(sqliteFile, backup);
        await chmod(backup, 0o600);
        out.backups.push(backup);
        for (const [p, v] of found) {
          const known = await get(p);
          if (known === v.trim()) { holder.settings.keys[p] = maskOf(v.trim()); out.migrated.push(p); continue; }
          if (known) { holder.settings.keys[p] = maskOf(known); out.migrated.push(p); continue; }
          const where = await set(p, v).catch(() => null);
          if (where && (await get(p)) === v.trim()) { holder.settings.keys[p] = maskOf(v.trim()); out.migrated.push(p); } else out.failed.push(p);
        }
        const db = new DatabaseSync(sqliteFile);
        try {
          db.prepare('UPDATE small SET json = ? WHERE id = 1').run(JSON.stringify(holder));
          db.exec('VACUUM');
        } finally { db.close(); }
        await chmod(sqliteFile, 0o600);
        await rm(join(dir, 'state-cache.txt'), { force: true }).catch(() => undefined);
      }
    }
    return out;
  }

  return { get, set, remove, status, migrate, realKeys, scope };
}
