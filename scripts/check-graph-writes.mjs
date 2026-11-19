/**
 * ADR 0031 point 5: the graph is written in one place. Anything outside `src/engine/nodecore/edit.ts` (and the store's own
 * definition) that calls `setGraph`, `writeGraph`, `editGraph`, or writes `graph:` into the session by hand is a second path
 * that skips the revisions, the cable rules and the trace. Static; fails with file:line and a fix hint.
 */
import { pathToFileURL } from 'node:url';
import { scan } from './ast-scan.mjs';

// dropResults is the one held exception: a reducer inside the store's own atomic asset deletion (generations and indices change
// in one `set`), it only rewrites result indices of nodes and cables. Moving it into the layer needs the layer to join that transaction.
const ALLOWED = new Set(['src/engine/nodecore/edit.ts', 'src/store/store.ts', 'src/engine/flow/dropResults.ts']);
const CALLS = new Set(['setGraph', 'writeGraph', 'editGraph']);
const MUTATORS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin']);
const HINT = 'write the graph through `applyEdit` (src/engine/nodecore/edit.ts): `connect`/`disconnect`/`set`/`delete`/`add` for a cable or a parameter, `editCompound` for a composed change, `editPresentation` for position, size or groups.';

/** Problems under `root`, as `file:line: message` strings. */
export function check(root = '.') {
  return scan(root, {
    allowed: ALLOWED,
    what: 'graph writes',
    rules: ({ program }) => {
      const keyName = (p) => p.key?.type === 'Identifier' ? p.key.name : p.key?.value;
      // Import aliases (`import { setGraph as sg }`) are the same function under another name.
      const calls = new Set(CALLS);
      for (const d of program.body) if (d.type === 'ImportDeclaration') for (const sp of d.specifiers) if (sp.type === 'ImportSpecifier' && CALLS.has(sp.imported?.name ?? sp.imported?.value)) calls.add(sp.local.name);
      // `x.graph…` in a member chain: a direct mutation of a session's graph.
      // A name that holds a session's graph (`const { graph } = s`, `const g = s.graph`) or an object carrying one (`const patch = { graph }`), from where it is declared on.
      const aliases = new Set(), carriers = new Set();
      const throughGraph = (n) => { let o = n; for (; o?.type === 'MemberExpression'; o = o.object) if ((o.property?.name ?? o.property?.value) === 'graph') return true; return o?.type === 'Identifier' && aliases.has(o.name) && n !== o; };
      const hasGraphKey = (o) => o.type === 'ObjectExpression' && o.properties.some((p) => p.type === 'Property' && keyName(p) === 'graph');
      // The syntax tree, not lines: a call or an object split over several lines is the same write.
      const flag = (node, report) => report(node, `writes the graph outside the editing layer. ${HINT}`);
      return {
        enter: (node, report) => {
          if (node.type === 'VariableDeclarator') {
            if (node.id?.type === 'ObjectPattern') for (const p of node.id.properties) if (p.type === 'Property' && keyName(p) === 'graph' && p.value?.type === 'Identifier') aliases.add(p.value.name);
            if (node.id?.type === 'Identifier' && node.init && throughGraph(node.init)) aliases.add(node.id.name);
            if (node.id?.type === 'Identifier' && node.init && hasGraphKey(node.init)) carriers.add(node.id.name);
          }
          const carrier = (a) => a?.type === 'Identifier' && carriers.has(a.name);
          if (node.type === 'ObjectExpression' && node.properties.some((p) => p.type === 'SpreadElement' && carrier(p.argument))) flag(node, report);
          if (node.type === 'CallExpression') {
            const fn = node.callee;
            const name = fn.type === 'Identifier' ? fn.name : fn.type === 'MemberExpression' ? fn.property?.name : '';
            if (calls.has(name)) flag(node, report);
            // `Object.assign(session, { graph })`, `Object.assign(session.graph, …)`, `session.graph.nodes.push(n)`: writes with no assignment sign.
            const isAssign = fn.type === 'MemberExpression' && fn.object?.name === 'Object' && fn.property?.name === 'assign';
            if (isAssign && (node.arguments.some((a) => hasGraphKey(a) || carrier(a)) || throughGraph(node.arguments[0]))) flag(node, report);
            if (fn.type === 'MemberExpression' && MUTATORS.has(fn.property?.name) && throughGraph(fn.object)) flag(node, report);
          }
          if ((node.type === 'AssignmentExpression' && throughGraph(node.left)) || (node.type === 'UpdateExpression' && throughGraph(node.argument)) || (node.type === 'UnaryExpression' && node.operator === 'delete' && throughGraph(node.argument))) flag(node, report);
          // `{ ...session, graph: … }`: a session object rebuilt by hand with a new graph (any nesting, any line breaks).
          if (node.type === 'ObjectExpression' && node.properties.some((p) => p.type === 'SpreadElement')
            && node.properties.some((p) => p.type === 'Property' && keyName(p) === 'graph')) flag(node, report);
        },
      };
    },
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const errors = check('.');
  if (errors.length) { console.error(`check-graph-writes: ${errors.length} write(s) outside the editing layer\n${errors.map((e) => `  ${e}`).join('\n')}`); process.exit(1); }
  console.log('check-graph-writes: the graph is written only through the editing layer.');
}
