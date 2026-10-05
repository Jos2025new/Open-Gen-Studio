import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { prepareSandbox, sandboxDirectory, SANDBOX_PORT } from '../scripts/dev-sandbox.mjs';
import { checkDocs, checkSafeguards } from '../scripts/check-safeguards.mjs';

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ogs-safeguards-'));
  roots.push(root);
  mkdirSync(join(root, 'data'));
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'data/state.json'), '{"original":true}');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { 'dev:sandbox': 'DATA_DIR=.sandbox/data node scripts/dev-sandbox.mjs' } }));
  writeFileSync(join(root, 'vite.config.ts'), 'localStore(undefined, process.env.DATA_DIR)');
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it('checks the real npm sandbox configuration and docs', async () => {
  await checkSafeguards(process.cwd());
});
it('fails when the npm sandbox command points at real data', async () => {
  const root = fixture();
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { 'dev:sandbox': 'DATA_DIR=data node scripts/dev-sandbox.mjs' } }));
  await expect(checkSafeguards(root)).rejects.toThrow('real data is forbidden');
  for (const path of ['data', './data', '.sandbox/../data', undefined]) expect(() => sandboxDirectory(root, path)).toThrow();
  expect(SANDBOX_PORT).toBe(5183);
});
it('copies data and refuses a sandbox linked to real data', async () => {
  const root = fixture();
  await prepareSandbox(root, '.sandbox/data');
  expect(readFileSync(join(root, '.sandbox/data/state.json'), 'utf8')).toBe('{"original":true}');
  rmSync(join(root, '.sandbox'), { recursive: true });
  symlinkSync(join(root, 'data'), join(root, '.sandbox'));
  await expect(prepareSandbox(root, '.sandbox/data')).rejects.toThrow('Unsafe sandbox');
  expect(readFileSync(join(root, 'data/state.json'), 'utf8')).toBe('{"original":true}');
});
it('starts an isolated sandbox without source data, retaining existing sandbox files', async () => {
  const root = fixture();
  rmSync(join(root, 'data'), { recursive: true });
  const destination = await prepareSandbox(root, '.sandbox/data');
  writeFileSync(join(destination, 'state.json'), '{"sandbox":true}');
  expect(await prepareSandbox(root, '.sandbox/data')).toBe(destination);
  expect(readFileSync(join(destination, 'state.json'), 'utf8')).toBe('{"sandbox":true}');
  rmSync(join(root, '.sandbox'), { recursive: true });
  symlinkSync(join(root, 'docs'), join(root, '.sandbox'));
  await expect(prepareSandbox(root, '.sandbox/data')).rejects.toThrow('Unsafe sandbox');
});
it('fails on nested docs keys without printing their values', async () => {
  const root = fixture();
  mkdirSync(join(root, 'docs/nested'));
  const token = 'sk-' + 'a'.repeat(32);
  writeFileSync(join(root, 'docs/nested/key.md'), token);
  await expect(checkDocs(join(root, 'docs'))).rejects.toThrow('Possible keys in docs');
  writeFileSync(join(root, 'docs/nested/key.md'), 'API_KEY=' + 'b'.repeat(32));
  await expect(checkDocs(join(root, 'docs'))).rejects.toThrow('Possible keys in docs');
  writeFileSync(join(root, 'docs/nested/key.md'), 'API_KEY=<your-key>');
  await expect(checkDocs(join(root, 'docs'))).resolves.toBeUndefined();
});
