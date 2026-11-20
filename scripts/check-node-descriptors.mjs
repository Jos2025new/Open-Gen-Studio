/** ADR 0031 point 1: every node type has one descriptor file with the whole contract. Static; fails with file:line and a fix hint. */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const NEEDED = ['version', 'params', 'inputs', 'output', 'required', 'affects', 'evaluate'];
const lineOf = (text, at) => text.slice(0, at).split('\n').length;

/** Problems of the tree under `root` (the repo by default), as `file:line: message` strings. */
export function check(root = '.') {
  const at = (p) => join(root, p);
  const types = readFileSync(at('src/engine/graphTypes.ts'), 'utf8');
  const union = /export type NodeKind = ([^;]+);/.exec(types);
  const errors = [];
  const base = /export type BaseNodeKind = ([^;]+);/.exec(types) ?? union;
  const dir = 'src/engine/nodecore/types';
  const kinds = base ? [...base[1].matchAll(/'([a-z0-9]+)'/g)].map((m) => m[1]) : [];
  if (!kinds.length) errors.push('src/engine/graphTypes.ts:1: cannot read `BaseNodeKind`; keep it a union of string literals so this check can list the node types.');
  // Open registry: a descriptor file outside the base union is a type of its own when it declares its data by merging `ExtraNodeKinds`.
  const extra = existsSync(at(dir)) ? readdirSync(at(dir)).filter((f) => f.endsWith('.node.ts')).map((f) => f.replace('.node.ts', '')).filter((k) => !kinds.includes(k) && new RegExp(`interface ExtraNodeKinds\\s*\\{[^}]*\\b${k}\\b`).test(readFileSync(at(`${dir}/${k}.node.ts`), 'utf8'))) : [];
  kinds.push(...extra);
  /** A descriptor that moves past version 1 must say how to migrate saved nodes. */
  const migrations = (file, text, from) => {
    const v = /\bversion:\s*(\d+)/.exec(text.slice(from));
    if (!v || Number(v[1]) <= 1) return;
    const m = /\bmigrate\b/.exec(text);
    const missing = [];
    for (let n = 1; n < Number(v[1]); n++) if (!m || !new RegExp(`\\b${n}\\s*:\\s*(\\(|[a-zA-Z_])`).test(text.slice(m.index))) missing.push(n);
    if (missing.length) errors.push(`${file}:${lineOf(text, from + v.index)}: version ${v[1]} needs \`migrate\` for ${missing.map((n) => `${n}→${n + 1}`).join(', ')}: one function per version bump (\`migrate: { 1: (data) => ... }\`) so saved nodes upgrade.`);
  };
  for (const kind of kinds) {
    const file = `${dir}/${kind}.node.ts`;
    if (!existsSync(at(file))) { errors.push(`${file}:1: node type "${kind}" has no descriptor. Add this file: \`export default defineNode({ kind: '${kind}', … })\` (copy text.node.ts).`); continue; }
    const text = readFileSync(at(file), 'utf8');
    if (!/export default /.test(text)) { errors.push(`${file}:1: no \`export default\`; the registry reads the default export.`); continue; }
    const factory = /export default generationNode\('([a-z0-9]+)'/.exec(text);
    if (factory) {
      if (factory[1] !== kind) errors.push(`${file}:${lineOf(text, factory.index)}: generationNode('${factory[1]}') in the file of "${kind}".`);
      const gen = 'src/engine/nodecore/generation.ts';
      if (existsSync(at(gen))) migrations(gen, readFileSync(at(gen), 'utf8'), 0);
      continue;
    }
    const define = text.indexOf('defineNode(');
    if (define < 0) { errors.push(`${file}:1: export a descriptor made with defineNode(...) or generationNode('${kind}').`); continue; }
    const line = lineOf(text, define);
    if (!new RegExp(`kind: '${kind}'`).test(text)) errors.push(`${file}:${line}: the descriptor must say \`kind: '${kind}'\`.`);
    for (const key of NEEDED) if (!new RegExp(`\\b${key}\\b\\s*[:(,]`).test(text.slice(define))) errors.push(`${file}:${line}: missing \`${key}\`. A descriptor declares ${NEEDED.join(', ')}.`);
    migrations(file, text, define);
  }
  if (existsSync(at(dir))) for (const f of readdirSync(at(dir))) {
    if (!f.endsWith('.node.ts')) { errors.push(`${dir}/${f}:1: files in types/ are descriptors named <kind>.node.ts.`); continue; }
    if (!kinds.includes(f.replace('.node.ts', ''))) errors.push(`${dir}/${f}:1: node type "${f.replace('.node.ts', '')}" is neither in BaseNodeKind nor declared in the file: add \`declare module '../../graphTypes' { interface ExtraNodeKinds { ${f.replace('.node.ts', '')}: YourData } }\` there, or remove it.`);
  }
  return { errors: [...new Set(errors)], kinds };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { errors, kinds } = check();
  if (errors.length) { console.error(`check-node-descriptors: ${errors.length} problem(s)\n${errors.map((e) => `  ${e}`).join('\n')}`); process.exit(1); }
  console.log(`check-node-descriptors: ${kinds.length} node types, one descriptor each.`);
}
