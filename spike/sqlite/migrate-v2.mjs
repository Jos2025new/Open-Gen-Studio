// SPIKE round 4, part 3: migration importer from format 2 (store-v2/) to SQLite (store-ba).
// Steps:
// 1. Copies `store-v2/` (HEAD.json, globals.json, sessions/*.json) to `backups/v2-pre-sqlite/` atomically via a tmp dir.
// 2. Reads the format-2 state via `createStoreV2(dir).read()` and computes its sha256 (`v2Sha`).
// 3. Builds the full initial delta and commits it into `createStoreBA(dir)` in ONE SQLite transaction (`BEGIN IMMEDIATE ... COMMIT`).
// 4. Verifies `stateSha(store.read()) === stateSha(v2Text)` (both from SQLite tables and, after `idle()`, from `state-cache.txt`).
// 5. Leaves `store-v2/` completely untouched so rolling back is just pointing the server back to `createStoreV2(dir)`.
//    A SQLite file that already exists and does not match is left in place: the import stops and deletes nothing.
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { assembleText, createStoreV2, splitText } from '../../server/store-v2.js';
import { sha256 } from '../../server/save-guard.js';
import { createStoreBA } from './store-ba.js';
import { createDeltaClient } from './delta-client.mjs';

const COLL_KEYS = new Set(['generations', 'assets', 'library', 'spendLog']);
const json = (v) => JSON.stringify(v);

/**
 * Canonicalizes the top-level member order of `globals` (scalars first, then `generations`, `assets`, `library`,
 * `spendLog`, matching how SQLite stores and reassembles `globals`) while keeping every record, session, and value
 * byte-for-byte identical, then returns its sha256. If `globals.json` already has scalars first and collections in
 * that order, the canonical text is identical to the raw `v2.read()` text (`sha256(text)`).
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
  const v2Root = join(dir, 'store-v2');
  const headFile = join(v2Root, 'HEAD.json');
  const globalsFile = join(v2Root, 'globals.json');
  const sessionsDir = join(v2Root, 'sessions');

  if (!existsSync(headFile)) {
    throw new Error(`store-v2/HEAD.json not found in ${dir}`);
  }

  // 1. Read v2 state and compute reference sha256 before anything else.
  const v2 = createStoreV2(dir);
  const v2Text = await v2.read();
  if (v2Text == null) throw new Error('store-v2 read() returned null');
  const v2RawSha = sha256(v2Text);
  const v2Sha = stateSha(v2Text);

  // 2. Copy the entire store-v2 folder to backups/v2-pre-sqlite first (atomic swap of tmp folder).
  const backupsDir = join(dir, 'backups');
  const backupTarget = join(backupsDir, 'v2-pre-sqlite');
  const backupTmp = join(backupsDir, `v2-pre-sqlite.${process.pid}.tmp`);
  mkdirSync(backupsDir, { recursive: true });
  rmSync(backupTmp, { recursive: true, force: true });
  cpSync(v2Root, backupTmp, { recursive: true });
  opts.fault?.('after-copy-tmp');
  rmSync(backupTarget, { recursive: true, force: true });
  renameSync(backupTmp, backupTarget);
  opts.fault?.('after-copy');

  // 3. Parse v2 files to build the one-transaction SQLite commit body.
  const head = JSON.parse(readFileSync(headFile, 'utf8'));
  const globalsText = readFileSync(globalsFile, 'utf8');
  const globalsObj = JSON.parse(globalsText);
  const sessions = {};
  for (const id of head.order) {
    sessions[id] = readFileSync(join(sessionsDir, `${id}.json`), 'utf8');
  }

  let store = createStoreBA(dir, { synchronous: opts.synchronous ?? 'FULL', fault: opts.fault });
  try {
    const existingText = store.read();
    if (existingText != null && stateSha(existingText) !== v2Sha) {
      throw new Error('sqlite already exists and differs from store-v2; left intact');
    }
    if (existingText == null) {
      const client = createDeltaClient();
      const delta = client.diff(globalsObj);
      const r = store.commit({
        savedAt: head.savedAt,
        baseAt: 0,
        version: head.version,
        order: head.order,
        sessions,
        delta,
      });
      if (r.status !== 204) {
        throw new Error(`SQLite import commit failed: ${r.status} ${r.reason}`);
      }
      client.ack();
    }

    opts.fault?.('before-verify');

    // 4. Verify imported state from SQLite tables equals v2 read() state (sha256).
    const tableText = store.read();
    const tableSha = tableText ? stateSha(tableText) : null;
    if (tableSha !== v2Sha) {
      throw new Error(`imported SQLite table state sha (${tableSha}) !== v2 sha (${v2Sha})`);
    }

    // Write state-cache.txt via idle() and verify copy read also equals v2Sha.
    store.idle();
    const copyText = store.read();
    const copySha = copyText ? stateSha(copyText) : null;
    const copySource = store.lastReadSource();
    if (copySha !== v2Sha || copySource !== 'copy') {
      throw new Error(`imported SQLite copy state sha (${copySha}, source=${copySource}) !== v2 sha (${v2Sha})`);
    }

    // 5. Verify v2 is untouched (rollback is just pointing back to createStoreV2(dir)).
    const v2AfterText = await v2.read();
    if (!v2AfterText || sha256(v2AfterText) !== v2RawSha) {
      throw new Error('store-v2 was modified during migration');
    }

    return {
      ok: true,
      savedAt: head.savedAt,
      sessions: head.order.length,
      bytes: copyText.length,
      sha: v2Sha,
      rawShaMatch: sha256(copyText) === v2RawSha,
      backupDir: backupTarget,
      readSource: copySource,
    };
  } finally {
    store.close();
  }
}

// CLI entry point for the kill -9 interrupted-import test child:
//   node spike/sqlite/migrate-v2.mjs --child <dir> [killAtFaultPoint]
if (process.argv[2] === '--child') {
  const dir = process.argv[3];
  const killPoint = process.argv[4] || 'globals';
  await migrateFromV2(dir, {
    fault: (point) => {
      if (point === killPoint) {
        process.stdout.write(`fault ${point}\n`);
        process.kill(process.pid, 'SIGKILL');
      }
    },
  });
}
