/**
 * Ensures every `it.fails` in `tests/` has an explicit `// reproduce: ...` comment within the 3 preceding lines
 * explaining what bug it reproduces, so undocumented expected-failures do not accumulate as silent noise.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseSync } from 'rolldown/utils';

const REPRODUCE_RE = /\/\/\s*reproduce:\s*\S/;

function walkTests(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'node_modules') walkTests(p, out);
    } else if (/\.(ts|tsx|js|mjs|mts|cts)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

function isItFailsMember(node) {
  return Boolean(
    node?.type === 'MemberExpression'
    && node.object?.type === 'Identifier'
    && node.object.name === 'it'
    && (node.property?.name === 'fails' || node.property?.value === 'fails'),
  );
}

function visit(node, fn) {
  if (!node || typeof node.type !== 'string') return;
  fn(node);
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (Array.isArray(child)) child.forEach((c) => visit(c, fn));
    else if (child && typeof child === 'object') visit(child, fn);
  }
}

/** Problems under `root`, as `file:line: message` strings. */
export function check(root = '.') {
  const errors = [];
  for (const file of walkTests(join(root, 'tests')).sort()) {
    const rel = relative(root, file).split('\\').join('/');
    const text = readFileSync(file, 'utf8');
    if (!text.includes('it.fails')) continue;
    const { program, errors: broken } = parseSync(file, text);
    if (broken.length) {
      errors.push(`${rel}:1: could not be parsed, so its it.fails comments could not be checked (${broken[0].message}).`);
      continue;
    }
    const lines = text.split(/\r?\n/);
    const seen = new Set();
    visit(program, (node) => {
      const target = node.type === 'CallExpression' ? node.callee : null;
      if (!isItFailsMember(target)) return;
      const line = text.slice(0, target.start).split('\n').length;
      if (seen.has(line)) return;
      seen.add(line);
      const prev = lines.slice(Math.max(0, line - 4), line - 1);
      if (!prev.some((l) => REPRODUCE_RE.test(l))) {
        errors.push(`${rel}:${line}: it.fails without \`// reproduce: ...\` in the 3 preceding lines.`);
      }
    });
  }
  return errors;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const errors = check('.');
  if (errors.length) {
    console.error(`check-it-fails: ${errors.length} undocumented it.fails\n${errors.map((e) => `  ${e}`).join('\n')}`);
    process.exit(1);
  }
  console.log('check-it-fails: all it.fails tests carry a `// reproduce:` comment.');
}
