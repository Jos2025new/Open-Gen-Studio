// Not part of `vitest run`: vite.config.ts includes only tests/**/*.test.ts, and this process
// kills children with SIGKILL, which the sandbox refuses. Run: node --no-warnings spike/sqlite/crash-test4.mjs ba 100
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));

describe('sqlite crash cuts', () => {
  it('100 kill -9 cuts lose no acknowledged commit and tear nothing', () => {
    const run = spawnSync(process.execPath, ['--no-warnings', 'spike/sqlite/crash-test4.mjs', 'ba', '100'], {
      cwd: root, encoding: 'utf8', timeout: 120_000,
    });
    expect(run.status, run.stderr).toBe(0);
    const report = JSON.parse(run.stdout.slice(run.stdout.indexOf('{')));
    expect(report.torn).toBe(0);
    expect(report.lostAcked).toBe(0);
    expect(report.guardFailures).toBe(0);
  }, 120_000);
});
