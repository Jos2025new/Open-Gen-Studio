/**
 * Runs only the tests that reach the files changed since the last commit (staged, unstaged and new), through
 * `vitest related`. Extra arguments are passed as files instead: `npm run test:related -- src/engine/plan.ts`.
 * A quick check while working; `npm test` stays the full gate before work is called done.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean);
const given = process.argv.slice(2);
const changed = given.length ? given : [...new Set([...git('diff', '--name-only', 'HEAD'), ...git('ls-files', '--others', '--exclude-standard')])];
const files = changed.filter((f) => /^(src|tests|server)\/.*\.(ts|tsx|js|mjs)$/.test(f) && existsSync(f));

if (!files.length) {
  console.log('test:related: no changed source or test files');
  process.exit(0);
}
console.log(`test:related: ${files.length} changed file(s)\n  ${files.join('\n  ')}`);
const run = spawnSync('npx', ['vitest', 'related', '--run', '--maxWorkers=2', ...files], { stdio: 'inherit' });
process.exit(run.status ?? 1);
