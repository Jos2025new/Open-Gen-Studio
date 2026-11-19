/** ADR 0031 point 1: every node type has one descriptor file with the whole contract. Static; fails with file:line and a fix hint. */
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const types = readFileSync('src/engine/graphTypes.ts', 'utf8');
const union = /export type NodeKind = ([^;]+);/.exec(types);
const errors = [];
const kinds = union ? [...union[1].matchAll(/'([a-z0-9]+)'/g)].map((m) => m[1]) : [];
if (!kinds.length) errors.push('src/engine/graphTypes.ts:1: cannot read `NodeKind`; keep it a union of string literals so this check can list the node types.');
const dir = 'src/engine/nodecore/types';
const NEEDED = ['version', 'params', 'inputs', 'output', 'required', 'affects', 'evaluate', 'actions'];
const lineOf = (text, at) => text.slice(0, at).split('\n').length;

for (const kind of kinds) {
  const file = `${dir}/${kind}.node.ts`;
  if (!existsSync(file)) { errors.push(`${file}:1: node type "${kind}" has no descriptor. Add this file: \`export default defineNode({ kind: '${kind}', … })\` (copy text.node.ts).`); continue; }
  const text = readFileSync(file, 'utf8');
  if (!/export default /.test(text)) { errors.push(`${file}:1: no \`export default\`; the registry reads the default export.`); continue; }
  const factory = /export default generationNode\('([a-z0-9]+)'\)/.exec(text);
  if (factory) { if (factory[1] !== kind) errors.push(`${file}:${lineOf(text, factory.index)}: generationNode('${factory[1]}') in the file of "${kind}".`); continue; }
  const define = text.indexOf('defineNode(');
  if (define < 0) { errors.push(`${file}:1: export a descriptor made with defineNode(...) or generationNode('${kind}').`); continue; }
  const at = lineOf(text, define);
  if (!new RegExp(`kind: '${kind}'`).test(text)) errors.push(`${file}:${at}: the descriptor must say \`kind: '${kind}'\`.`);
  for (const key of NEEDED) if (!new RegExp(`\\b${key}\\b\\s*[:(,]`).test(text.slice(define))) errors.push(`${file}:${at}: missing \`${key}\`. A descriptor declares ${NEEDED.join(', ')}.`);
}
if (existsSync(dir)) for (const f of readdirSync(dir)) {
  if (!f.endsWith('.node.ts')) { errors.push(`${dir}/${f}:1: files in types/ are descriptors named <kind>.node.ts.`); continue; }
  if (!kinds.includes(f.replace('.node.ts', ''))) errors.push(`${dir}/${f}:1: no node type "${f.replace('.node.ts', '')}" in NodeKind (graphTypes.ts). Add the kind there or remove the file.`);
}
if (errors.length) { console.error(`check-node-descriptors: ${errors.length} problem(s)\n${errors.map((e) => `  ${e}`).join('\n')}`); process.exit(1); }
console.log(`check-node-descriptors: ${kinds.length} node types, one descriptor each.`);
