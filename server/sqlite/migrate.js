// Phase 2: migration importer from format 1 (state.json) or format 2 (store-v2/) to SQLite (store-ba).
// Steps:
// 1. Refuses to run on protected `data/` or `.sandbox/` folders.
// 2. Reads the format-2 (`store-v2/`) or format-1 (`state.json`) state and computes its sha256 (`sourceSha`).
// 3. If `ogs.sqlite` already exists and differs from the source, stops immediately and leaves everything intact.
// 4. Copies the source (`store-v2/` to `backups/v2-pre-sqlite/` or `state.json` to `backups/v1-pre-sqlite/`) atomically via a tmp dir.
// 5. Builds the full initial delta and commits it into `createStoreBA(dir)` in ONE SQLite transaction (`BEGIN IMMEDIATE ... COMMIT`).
// 6. Verifies `stateSha(store.read()) === sourceSha` (both from SQLite tables and, after `idle()`, from `state-cache.txt`).
// 7. Leaves `store-v2/` and `state.json` completely untouched so rolling back is just pointing back to the files.
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleText, createStoreV2, splitText } from '../store-v2.js';
import { sha256 } from '../save-guard.js';
import { createStoreBA } from './store-ba.js';
import { createDeltaClient } from './delta-client.mjs';

const COLL_KEYS = new Set(['generations', 'assets', 'library', 'spendLog']);
const json = (v) => JSON.stringify(v);
const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function assertMigratableDir(dir) {
  const abs = resolve(dir);
  const realData = resolve(REPO_ROOT, 'data');
  const sandbox = resolve(REPO_ROOT, '.sandbox');
  if (abs === realData || abs.startsWith(`${realData}/`) || abs === sandbox || abs.startsWith(`${sandbox}/`)) {
    throw new Error(`refusing to migrate protected folder ${abs}`);
  }
}

/**
 * Canonicalizes the top-level member order of `globals` (scalars first, then `generations`, `assets`, `library`,
 * `spendLog`, matching how SQLite stores and reassembles `globals`) while keeping every record, session, and value
 * byte-for-byte identical, then returns its sha256.
 */
export function canonicalStateText(text) {
  const parts = splitText(text);
  const g = JSON.parse(parts.globals);
  const smallEntries = Object.entries(g).filter(([k]) => !COLL_KEYS.has(k));
  const canonicalGlobals = json({
    ...Object.fromEntries(smallEntries),
    generations: g.generations ?? {},
    assets: g.assets ?? {},
    library: g.library ?? [],
    spendLog: g.spendLog ?? [],
  });
  return assembleText({
    savedAt: parts.savedAt,
    version: parts.version,
    globals: canonicalGlobals,
    order: parts.order,
    sessions: parts.sessions,
  });
}

export const stateSha = (text) => sha256(canonicalStateText(text));

export async function migrateFromV2(dir, opts = {}) {
  assertMigratableDir(dir);
  const v2Root = join(dir, 'store-v2');
  const headFile = join(v2Root, 'HEAD.json');
  const globalsFile = join(v2Root, 'globals.json');
  const sessionsDir = join(v2Root, 'sessions');
  const stateFile = join(dir, 'state.json');

  const hasV2 = existsSync(headFile);
  const hasV1 = !hasV2 && existsSync(stateFile);
  if (!hasV2 && !hasV1) {
    throw new Error(`store-v2/HEAD.json not found in ${dir}`);
  }

  // 1. Read source state and compute reference sha256 before anything else.
  const v2 = hasV2 ? createStoreV2(dir) : null;
  const sourceText = hasV2 ? await v2.read() : readFileSync(stateFile, 'utf8');
  if (!sourceText) throw new Error('source store read() returned empty');
  const sourceRawSha = sha256(sourceText);
  const sourceSha = stateSha(sourceText);

  // 2. Copy the source files to backups/ first (atomic swap of tmp folder).
  const backupsDir = join(dir, 'backups');
  const backupName = hasV2 ? 'v2-pre-sqlite' : 'v1-pre-sqlite';
  const backupTarget = join(backupsDir, backupName);
  const backupTmp = join(backupsDir, `${backupName}.${process.pid}.tmp`);
  mkdirSync(backupsDir, { recursive: true });
  rmSync(backupTmp, { recursive: true, force: true });
  if (hasV2) {
    cpSync(v2Root, backupTmp, { recursive: true });
  } else {
    mkdirSync(backupTmp, { recursive: true });
    writeFileSync(join(backupTmp, 'state.json'), sourceText, { mode: 0o600 });
  }
  opts.fault?.('after-copy-tmp');
  rmSync(backupTarget, { recursive: true, force: true });
  renameSync(backupTmp, backupTarget);
  opts.fault?.('after-copy');

  // 3. Parse source files to build the one-transaction SQLite commit body.
  let savedAt, version, order, globalsObj, sessions;
  if (hasV2) {
    const head = JSON.parse(readFileSync(headFile, 'utf8'));
    savedAt = head.savedAt;
    version = head.version;
    order = head.order;
    globalsObj = JSON.parse(readFileSync(globalsFile, 'utf8'));
    sessions = {};
    for (const id of order) {
      sessions[id] = readFileSync(join(sessionsDir, `${id}.json`), 'utf8');
    }
  } else {
    const parts = splitText(sourceText);
    savedAt = parts.savedAt;
    version = parts.version;
    order = parts.order;
    globalsObj = JSON.parse(parts.globals);
    sessions = parts.sessions;
  }

  const store = createStoreBA(dir, { synchronous: opts.synchronous ?? 'FULL', fault: opts.fault });
  try {
    const existingText = store.read();
    if (existingText != null && stateSha(existingText) !== sourceSha) {
      throw new Error('sqlite already exists and differs from store-v2; left intact');
    }
    if (existingText == null) {
      const client = createDeltaClient();
      const delta = client.diff(globalsObj);
      const r = store.commit({
        savedAt,
        baseAt: 0,
        version,
        order,
        sessions,
        delta,
      });
      if (r.status !== 204) {
        throw new Error(`SQLite import commit failed: ${r.status} ${r.reason}`);
      }
      client.ack();
    }

    opts.fault?.('before-verify');

    // 4. Verify imported state from SQLite tables equals source state (sha256).
    const tableText = store.read();
    const tableSha = tableText ? stateSha(tableText) : null;
    if (tableSha !== sourceSha) {
      throw new Error(`imported SQLite table state sha (${tableSha}) !== source sha (${sourceSha})`);
    }

    // Write state-cache.txt via idle() and verify copy read also equals sourceSha.
    store.idle();
    const copyText = store.read();
    const copySha = copyText ? stateSha(copyText) : null;
    const copySource = store.lastReadSource();
    if (copySha !== sourceSha || copySource !== 'copy') {
      throw new Error(`imported SQLite copy state sha (${copySha}, source=${copySource}) !== source sha (${sourceSha})`);
    }

    // 5. Verify source is untouched (rollback is just pointing back to store-v2 or state.json).
    const afterText = hasV2 ? await v2.read() : readFileSync(stateFile, 'utf8');
    if (!afterText || sha256(afterText) !== sourceRawSha) {
      throw new Error('source store was modified during migration');
    }

    return {
      ok: true,
      format: hasV2 ? 2 : 1,
      savedAt,
      sessions: order.length,
      bytes: copyText.length,
      sha: sourceSha,
      rawShaMatch: sha256(copyText) === sourceRawSha,
      backupDir: backupTarget,
      readSource: copySource,
    };
  } finally {
    store.close();
  }
}

export const migrateToSqlite = migrateFromV2;
