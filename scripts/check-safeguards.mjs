import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sandboxDirectory } from './dev-sandbox.mjs';

const PLACEHOLDER = /^(?:\$|<|\{|\[|your[-_ ]|example|placeholder|redacted|dummy|test|fake|changeme|xxx|\.\.\.|tu[-_ ]|mi[-_ ])/i;
export function containsSecret(text) {
  if (/\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|hf_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{30,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/.test(text)) return true;
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) return true;
  const assignments = /["']?\b(?:[A-Z_]*API[_-]?KEY|apiKey|[A-Z_]*SECRET|[A-Z_]*TOKEN|authorization)["']?\s*[:=]\s*["'`]?([^\s"'`,;}]+)/gi;
  for (const match of text.matchAll(assignments)) {
    const value = match[1];
    if (value.length >= 12 && !PLACEHOLDER.test(value) && !/^(?:process\.env|import\.meta|undefined|null)/.test(value)) return true;
  }
  return /\bBearer\s+[A-Za-z0-9_+/.-]{20,}/i.test(text);
}

export async function checkDocs(directory) {
  const findings = [];
  async function scan(path) {
    const info = await lstat(path).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (!info) return;
    if (info.isSymbolicLink()) throw new Error(`docs contains a symbolic link: ${path}`);
    if (info.isDirectory()) {
      for (const entry of await readdir(path)) await scan(join(path, entry));
    } else if (info.isFile() && containsSecret(await readFile(path, 'utf8'))) findings.push(path);
  }
  await scan(directory);
  if (findings.length) throw new Error(`Possible keys in docs (values withheld): ${findings.join(', ')}`);
}

export async function checkSafeguards(root) {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const command = pkg.scripts['dev:sandbox'] ?? '';
  const dataDir = /^DATA_DIR=([^\s]+) node scripts\/dev-sandbox\.mjs$/.exec(command)?.[1];
  sandboxDirectory(root, dataDir);
  if (process.env.DATA_DIR) sandboxDirectory(root, process.env.DATA_DIR);
  const vite = await readFile(join(root, 'vite.config.ts'), 'utf8');
  if (!vite.includes('localStore(undefined, process.env.DATA_DIR)')) throw new Error('Vite must pass DATA_DIR to the store');
  console.log('Sandbox isolation: PASS');
  await checkDocs(join(root, 'docs'));
  console.log('Keys in docs: none detected (PASS)');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkSafeguards(process.cwd()).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
