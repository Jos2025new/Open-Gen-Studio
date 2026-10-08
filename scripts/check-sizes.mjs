import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// AGENTS.md: no file over 30 KB. Files already over it when the check arrived are listed in size-baseline.json
// with their size then: they may shrink, never grow. Any other file must stay at or under the limit.
export const MAX_BYTES = 30_000;
// Generated or binary: the project regenerates them (lockfile, provider snapshots, bench runs), so a size limit
// would only block a legitimate refresh.
const EXEMPT = [/^package-lock\.json$/, /^tests\/fixtures\//, /^bench\//];

export function sizeViolations(files, baseline) {
  const errors = [];
  for (const { path, bytes } of files) {
    if (bytes <= MAX_BYTES || EXEMPT.some((pattern) => pattern.test(path))) continue;
    const allowed = baseline[path];
    if (allowed === undefined) errors.push(`${path}: ${bytes} bytes exceeds ${MAX_BYTES}`);
    else if (bytes > allowed) errors.push(`${path}: ${bytes} bytes, grew from ${allowed} (over ${MAX_BYTES}: may shrink, never grow)`);
  }
  return errors;
}

export function checkSizes(root) {
  const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
  const files = [];
  for (const path of new Set(listed.split('\0').filter(Boolean))) {
    const info = statSync(join(root, path), { throwIfNoEntry: false });
    if (info?.isFile()) files.push({ path, bytes: info.size });
  }
  const baseline = JSON.parse(readFileSync(join(root, 'scripts/size-baseline.json'), 'utf8'));
  const errors = sizeViolations(files, baseline);
  if (errors.length) throw new Error(`check-sizes: FAIL\n${errors.join('\n')}`);
  const over = files.filter(({ path, bytes }) => bytes > MAX_BYTES && !EXEMPT.some((pattern) => pattern.test(path)));
  console.log(`check-sizes: PASS (${files.length} files; ${over.length} over ${MAX_BYTES} bytes held at their baseline)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { checkSizes(process.cwd()); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
