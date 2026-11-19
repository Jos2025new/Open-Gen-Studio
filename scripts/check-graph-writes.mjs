/**
 * ADR 0031 point 5: the graph is written in one place. Anything outside `src/engine/nodecore/edit.ts` (and the store's own
 * definition) that calls `setGraph`, `writeGraph`, `editGraph`, or writes `graph:` into the session by hand is a second path
 * that skips the revisions, the cable rules and the trace. Static; fails with file:line and a fix hint.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseSync } from 'rolldown/utils';

// dropResults is the one held exception: a reducer inside the store's own atomic asset deletion (generations and indices change
// in one `set`), it only rewrites result indices of nodes and cables. Moving it into the layer needs the layer to join that transaction.
const ALLOWED = new Set(['src/engine/nodecore/edit.ts', 'src/store/store.ts', 'src/engine/flow/dropResults.ts']);
const CALLS = new Set(['setGraph', 'writeGraph', 'editGraph']);
const MUTATORS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin']);
const HINT = 'write the graph through `applyEdit` (src/engine/nodecore/edit.ts): `connect`/`disconnect`/`set`/`delete`/`add` for a cable or a parameter, `editCompound` for a composed change, `editPresentation` for position, size or groups.';

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** Problems under `root`, as `file:line: message` strings. */
export function check(root = '.') {
  const errors = [];
  for (const file of walk(join(root, 'src'))) {
    const rel = relative(root, file).split('\\').join('/');
    if (ALLOWED.has(rel)) continue;
    const text = readFileSync(file, 'utf8');
    const { program, errors: broken } = parseSync(file, text);
    if (broken.length) { errors.push(`${rel}:1: could not be parsed, so its graph writes could not be checked (${broken[0].message}).`); continue; }
    const flag = (node) => errors.push(`${rel}:${text.slice(0, node.start).split('\n').length}: writes the graph outside the editing layer. ${HINT}`);
    const keyName = (p) => p.key?.type === 'Identifier' ? p.key.name : p.key?.value;
    // Import aliases (`import { setGraph as sg }`) are the same function under another name.
    const calls = new Set(CALLS);
    for (const d of program.body) if (d.type === 'ImportDeclaration') for (const sp of d.specifiers) if (sp.type === 'ImportSpecifier' && CALLS.has(sp.imported?.name ?? sp.imported?.value)) calls.add(sp.local.name);
    // `x.graph…` in a member chain: a direct mutation of a session's graph.
    const throughGraph = (n) => { for (let o = n; o?.type === 'MemberExpression'; o = o.object) if ((o.property?.name ?? o.property?.value) === 'graph') return true; return false; };
    const hasGraphKey = (o) => o.type === 'ObjectExpression' && o.properties.some((p) => p.type === 'Property' && keyName(p) === 'graph');
    // The syntax tree, not lines: a call or an object split over several lines is the same write.
    const visit = (node) => {
      if (!node || typeof node.type !== 'string') return;
      if (node.type === 'CallExpression') {
        const fn = node.callee;
        const name = fn.type === 'Identifier' ? fn.name : fn.type === 'MemberExpression' ? fn.property?.name : '';
        if (calls.has(name)) flag(node);
        // `Object.assign(session, { graph })`, `Object.assign(session.graph, …)`, `session.graph.nodes.push(n)`: writes with no assignment sign.
        const isAssign = fn.type === 'MemberExpression' && fn.object?.name === 'Object' && fn.property?.name === 'assign';
        if (isAssign && (node.arguments.some(hasGraphKey) || throughGraph(node.arguments[0]))) flag(node);
        if (fn.type === 'MemberExpression' && MUTATORS.has(fn.property?.name) && throughGraph(fn.object)) flag(node);
      }
      if ((node.type === 'AssignmentExpression' && throughGraph(node.left)) || (node.type === 'UpdateExpression' && throughGraph(node.argument)) || (node.type === 'UnaryExpression' && node.operator === 'delete' && throughGraph(node.argument))) flag(node);
      // `{ ...session, graph: … }`: a session object rebuilt by hand with a new graph (any nesting, any line breaks).
      if (node.type === 'ObjectExpression' && node.properties.some((p) => p.type === 'SpreadElement')
        && node.properties.some((p) => p.type === 'Property' && keyName(p) === 'graph')) flag(node);
      for (const key of Object.keys(node)) {
        const child = node[key];
        if (Array.isArray(child)) child.forEach(visit); else if (child && typeof child === 'object') visit(child);
      }
    };
    visit(program);
  }
  return errors;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const errors = check('.');
  if (errors.length) { console.error(`check-graph-writes: ${errors.length} write(s) outside the editing layer\n${errors.map((e) => `  ${e}`).join('\n')}`); process.exit(1); }
  console.log('check-graph-writes: the graph is written only through the editing layer.');
}
