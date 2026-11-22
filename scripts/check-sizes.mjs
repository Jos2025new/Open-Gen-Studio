import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// AGENTS.md: no file over 30 KB. Files already over it when the check arrived are listed in size-baseline.json
// with their size then: they may shrink, never grow, and the baseline only goes down.
// Files past 90% (27 000 B) emit a non-failing warning so splits happen before hitting the wall.
export const MAX_BYTES = 30_000;
export const WARN_BYTES = 27_000;
// Generated or binary: the project regenerates them (lockfile, provider snapshots, bench runs), so a size limit
// would only block a legitimate refresh.
const EXEMPT = [/^package-lock\.json$/, /^tests\/fixtures\//, /^bench\//];

export function sizeViolations(files, baseline) {
  const errors = [];
  for (const { path, bytes } of files) {
    if (EXEMPT.some((pattern) => pattern.test(path))) continue;
    const allowed = baseline[path];
    if (allowed !== undefined && bytes > allowed) {
      errors.push(`${path}:1: ${bytes} bytes, grew from ${allowed} (over ${MAX_BYTES}: may shrink, never grow). Split or extract code so it stays <= ${allowed} bytes.`);
      continue;
    }
    if (bytes <= MAX_BYTES) continue;
    if (allowed === undefined) errors.push(`${path}:1: ${bytes} bytes exceeds ${MAX_BYTES}. Split the file into smaller modules under ${MAX_BYTES} bytes.`);
  }
  return errors;
}

/** Files in `size-baseline.json` that shrank, dropped to <= MAX_BYTES, or were removed: the baseline must ratchet down. */
export function staleBaselines(files, baseline) {
  const byPath = new Map(files.map((f) => [f.path, f.bytes]));
  const errors = [];
  for (const [path, allowed] of Object.entries(baseline)) {
    const bytes = byPath.get(path);
    if (bytes === undefined) {
      errors.push(`scripts/size-baseline.json:1: ${path} no longer exists (was ${allowed} bytes). Run \`npm run sizes:baseline\` to remove it (baselines only go down).`);
    } else if (bytes <= MAX_BYTES) {
      errors.push(`scripts/size-baseline.json:1: ${path} is now ${bytes} bytes (<= ${MAX_BYTES}, down from ${allowed}). Run \`npm run sizes:baseline\` to remove it from the baseline (baselines only go down).`);
    } else if (bytes < allowed) {
      errors.push(`scripts/size-baseline.json:1: ${path} shrank from ${allowed} to ${bytes} bytes. Run \`npm run sizes:baseline\` to lower its baseline (baselines only go down).`);
    }
  }
  return errors;
}

/** Entries in `baseline` that raised their limit or appeared new compared to `committedBaseline` (`HEAD`). */
export function baselineRegressions(baseline, committedBaseline) {
  const errors = [];
  for (const [path, allowed] of Object.entries(baseline)) {
    const prev = committedBaseline[path];
    if (prev === undefined) {
      errors.push(`scripts/size-baseline.json:1: ${path} (${allowed} bytes) is a new entry not in HEAD (baselines may only shrink or be removed).`);
    } else if (allowed > prev) {
      errors.push(`scripts/size-baseline.json:1: ${path} baseline raised from ${prev} to ${allowed} bytes (baselines may only go down).`);
    }
  }
  return errors;
}

function readCommittedBaseline(root) {
  try {
    const raw = execFileSync('git', ['show', 'HEAD:scripts/size-baseline.json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Non-failing warnings for non-exempt files over 90% of MAX_BYTES (27 000 B) and up to MAX_BYTES. */
export function sizeWarnings(files) {
  const warnings = [];
  for (const { path, bytes } of files) {
    if (bytes <= WARN_BYTES || bytes > MAX_BYTES || EXEMPT.some((pattern) => pattern.test(path))) continue;
    const pct = Math.round((bytes / MAX_BYTES) * 100);
    warnings.push(`${path}:1: warning: ${bytes} bytes (${pct}% of ${MAX_BYTES} B limit; over ${WARN_BYTES} B). Plan to split before editing further.`);
  }
  return warnings;
}

/** Compute the ratcheted baseline: only lowers or removes entries, never raises a limit or adds new files. */
export function ratchetBaseline(files, baseline) {
  const byPath = new Map(files.map((f) => [f.path, f.bytes]));
  const next = {};
  for (const path of Object.keys(baseline).sort()) {
    const allowed = baseline[path];
    const bytes = byPath.get(path);
    if (bytes === undefined || bytes <= MAX_BYTES) continue;
    next[path] = Math.min(allowed, bytes);
  }
  return next;
}

function listTrackedFiles(root) {
  const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
  const files = [];
  for (const path of new Set(listed.split('\0').filter(Boolean))) {
    const info = statSync(join(root, path), { throwIfNoEntry: false });
    if (info?.isFile()) files.push({ path, bytes: info.size });
  }
  return files;
}

export function updateSizeBaseline(root) {
  const files = listTrackedFiles(root);
  const baselinePath = join(root, 'scripts/size-baseline.json');
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const next = ratchetBaseline(files, baseline);
  writeFileSync(baselinePath, JSON.stringify(next, null, 2) + '\n');
  const removed = Object.keys(baseline).filter((p) => !(p in next));
  const lowered = Object.keys(next).filter((p) => next[p] < baseline[p]);
  console.log(`check-sizes: baseline ratcheted down (${lowered.length} lowered, ${removed.length} removed, ${Object.keys(next).length} remaining).`);
  const errors = sizeViolations(files, next);
  if (errors.length) throw new Error(`check-sizes: FAIL (baseline never goes up)\n${errors.join('\n')}`);
}

export function checkSizes(root) {
  const files = listTrackedFiles(root);
  const baseline = JSON.parse(readFileSync(join(root, 'scripts/size-baseline.json'), 'utf8'));
  const committedBaseline = readCommittedBaseline(root);
  if (!committedBaseline) {
    console.warn('check-sizes: note: git HEAD:scripts/size-baseline.json unavailable (e.g. CI without git); skipping committed baseline check.');
  }
  const warnings = sizeWarnings(files);
  for (const w of warnings) console.warn(w);
  const errors = [
    ...sizeViolations(files, baseline),
    ...staleBaselines(files, baseline),
    ...(committedBaseline ? baselineRegressions(baseline, committedBaseline) : []),
  ];
  if (errors.length) throw new Error(`check-sizes: FAIL\n${errors.join('\n')}`);
  const over = files.filter(({ path, bytes }) => bytes > MAX_BYTES && !EXEMPT.some((pattern) => pattern.test(path)));
  console.log(`check-sizes: PASS (${files.length} files; ${over.length} over ${MAX_BYTES} bytes held at their baseline; ${warnings.length} over ${WARN_BYTES} bytes warning)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--update')) updateSizeBaseline(process.cwd());
    else checkSizes(process.cwd());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
