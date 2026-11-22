/**
 * Every test/spec file in the repository (`** /*.{test,spec}.*`, skipping `node_modules`, `.git`, `dist`, `.sandbox`, `data`)
 * must be matched by vitest's `test.include` in `vite.config.ts`, unless explicitly listed in `EXCLUDED` with a reason.
 * Prevents silent dead tests (e.g. a `.test.tsx`, `.spec.ts`, or `src/*.test.ts` that never ran).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSync } from 'rolldown/utils';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.sandbox', 'data']);

const PLAYWRIGHT_E2E_SPECS = [
  'tests-e2e/brush-visual.spec.ts',
  'tests-e2e/designer-flows.spec.ts',
  'tests-e2e/designer-monkey.spec.ts',
  'tests-e2e/designer-tools.spec.ts',
  'tests-e2e/edit-marquee.spec.ts',
  'tests-e2e/fx-visual.spec.ts',
  'tests-e2e/lineart-scale.spec.ts',
  'tests-e2e/multi-select.spec.ts',
  'tests-e2e/node-selection.spec.ts',
  'tests-e2e/path-nodes-ux.spec.ts',
  'tests-e2e/path-nodes.spec.ts',
  'tests-e2e/raster-performance.spec.ts',
  'tests-e2e/shape-knots.spec.ts',
  'tests-e2e/snapping.spec.ts',
];

// Explicit exclusions: test/spec files intentionally kept outside root `vitest run`.
export const EXCLUDED = new Map([
  [
    'tests/store-sqlite-crash.test.mjs',
    'spawns spike/sqlite/crash-test4.mjs with SIGKILL (refused by sandbox, up to 120 s); run manually with `node --no-warnings spike/sqlite/crash-test4.mjs ba 100`',
  ],
  [
    'spike/sqlite/round4.test.ts',
    'SQLite spike test suite (run via `vitest run --config spike/sqlite/vitest.config.mts`, 60 s timeout; referenced in spike/sqlite/RESULTADO.md)',
  ],
  [
    'spike/sqlite/store-sqlite.contract.test.ts',
    'SQLite spike contract suite (run via `vitest run --config spike/sqlite/vitest.config.mts`, 60 s timeout)',
  ],
  ...PLAYWRIGHT_E2E_SPECS.map((file) => [file, 'Playwright E2E spec (run with `playwright test`, not vitest)']),
]);

const lineOf = (text, offset) => text.slice(0, offset).split('\n').length;
const keyName = (prop) => (prop?.key?.type === 'Identifier' ? prop.key.name : prop?.key?.value);

function walkTests(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkTests(join(dir, entry.name), out);
    } else if (/\.(?:test|spec)\.[^/]+$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/** Convert a vitest glob pattern (supports `**\/`, `**`, `*`, `?`, `{a,b}`) to a RegExp on POSIX relative paths. */
export function globToRegExp(glob) {
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') { re += '(?:.+/)?'; i += 2; }
      else { re += '.*'; i += 1; }
    } else if (ch === '*') {
      re += '[^/]*';
    } else if (ch === '?') {
      re += '[^/]';
    } else if (ch === '{') {
      const end = glob.indexOf('}', i + 1);
      if (end > i) {
        const alts = glob.slice(i + 1, end).split(',').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        re += `(?:${alts.join('|')})`;
        i = end;
      } else {
        re += '\\{';
      }
    } else if (/[.+^$()|[\]\\]/.test(ch)) {
      re += `\\${ch}`;
    } else {
      re += ch;
    }
  }
  return new RegExp(`${re}$`);
}

/** Extract `test.include` literal glob patterns and its line number from `vite.config.ts`. */
export function readVitestInclude(configPath) {
  const text = readFileSync(configPath, 'utf8');
  const { program, errors } = parseSync(configPath, text);
  if (errors.length) return { error: `vite.config.ts:1: could not parse config (${errors[0].message}). Fix syntax errors in vite.config.ts.` };
  let includeProp = null;
  const visit = (node) => {
    if (!node || typeof node.type !== 'string' || includeProp) return;
    if (node.type === 'Property' && keyName(node) === 'test' && node.value?.type === 'ObjectExpression') {
      const inc = node.value.properties.find((p) => p.type === 'Property' && keyName(p) === 'include');
      if (inc) { includeProp = inc; return; }
    }
    for (const k of Object.keys(node)) {
      const child = node[k];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  };
  visit(program);
  if (!includeProp) return { error: 'vite.config.ts:1: missing `test.include` array. Add `test: { include: [...] }` in vite.config.ts so test discovery is explicit.' };
  const line = lineOf(text, includeProp.start);
  if (includeProp.value?.type !== 'ArrayExpression') {
    return { error: `vite.config.ts:${line}: \`test.include\` must be a literal array of globs so check-test-discovery can verify every test runs.` };
  }
  const patterns = [];
  for (const el of includeProp.value.elements) {
    if (el?.type !== 'Literal' || typeof el.value !== 'string') {
      return { error: `vite.config.ts:${line}: non-literal entry in \`test.include\`. Use string literal globs in vite.config.ts:${line}.` };
    }
    patterns.push(el.value);
  }
  return { patterns, line };
}

/** Return `file:line: message` errors for every `*.{test,spec}.*` file in the repo left out of vitest's `test.include`. */
export function check(root = '.', { excluded = EXCLUDED } = {}) {
  const configPath = join(root, 'vite.config.ts');
  if (!existsSync(configPath)) return ['vite.config.ts:1: missing vite.config.ts. Ensure vitest config exists at the repo root.'];
  const parsed = readVitestInclude(configPath);
  if (parsed.error) return [parsed.error];
  const matchers = parsed.patterns.map((p) => globToRegExp(p));
  const files = walkTests(root).map((f) => relative(root, f).split('\\').join('/')).sort();
  const errors = [];
  for (const rel of files) {
    if (matchers.some((re) => re.test(rel))) continue;
    if (excluded.has(rel)) continue;
    errors.push(
      `${rel}:1: not matched by vitest test.include (${parsed.patterns.join(', ')} at vite.config.ts:${parsed.line}). Rename/move to match test.include (e.g. tests/*.test.ts), add its glob to vite.config.ts:${parsed.line}, or document a deliberate exclusion in scripts/check-test-discovery.mjs.`,
    );
  }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = check(process.cwd());
  if (errors.length) {
    console.error(`check-test-discovery: FAIL (${errors.length} test file(s) outside vitest include)\n${errors.map((e) => `  ${e}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`check-test-discovery: PASS (all repo *.{test,spec}.* match vite.config.ts test.include; ${EXCLUDED.size} documented exclusion(s))`);
}
