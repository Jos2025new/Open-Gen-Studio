/**
 * Permanent drag-perf guard:
 * 1. In-progress drag handlers (`onNodeDrag`, `onSelectionDrag`, and the `dragging: true` path of `onNodesChange` or
 *    unconditional position handlers) must never reach `editPresentation`, `setGraph`, `patchSession`, `applyEdit`,
 *    `moveGroup`, `recordGraph`, `travelGraph`, or serialization (`persistState`, `JSON.stringify`).
 * 2. Card components must not mount `<NodeToolbar` unconditionally (each mounted `NodeToolbar` filters all nodes).
 */
import { pathToFileURL } from 'node:url';
import { scan } from './ast-scan.mjs';

const FORBIDDEN_CALLS = new Set([
  'editPresentation',
  'setGraph',
  'patchSession',
  'applyEdit',
  'moveGroup',
  'recordGraph',
  'travelGraph',
  'persistState',
]);

const DRAG_HINT = 'No escribas el grafo, historial ni serialices durante el arrastre en curso; usa estado local y aplica editPresentation al soltar (dragging: false).';
const TOOLBAR_HINT = 'NodeToolbar montado incondicionalmente; móntalo solo cuando la tarjeta esté seleccionada.';

function calleeName(callee) {
  if (!callee) return '';
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression') {
    const obj = callee.object?.type === 'Identifier' ? callee.object.name : '';
    const prop = callee.property?.type === 'Identifier' ? callee.property.name : callee.property?.value ?? '';
    return obj && prop ? `${obj}.${prop}` : prop;
  }
  return '';
}

function walkSubtree(node, fn) {
  if (!node || typeof node.type !== 'string') return;
  if (fn(node) === false) return;
  for (const k of Object.keys(node)) {
    const child = node[k];
    if (Array.isArray(child)) child.forEach((c) => walkSubtree(c, fn));
    else if (child && typeof child === 'object') walkSubtree(child, fn);
  }
}

function isDraggingMember(node) {
  return node?.type === 'MemberExpression' && node.property?.name === 'dragging';
}

function isDraggingTrueTest(test) {
  if (!test) return false;
  if (test.type === 'LogicalExpression' && test.operator === '&&') {
    return isDraggingTrueTest(test.left) || isDraggingTrueTest(test.right);
  }
  if (isDraggingMember(test)) return true;
  if (test.type === 'BinaryExpression') {
    const { left, right, operator } = test;
    if ((operator === '===' || operator === '==') &&
        ((isDraggingMember(left) && right?.type === 'Literal' && right.value === true) ||
         (isDraggingMember(right) && left?.type === 'Literal' && left.value === true))) return true;
    if ((operator === '!==' || operator === '!=') &&
        ((isDraggingMember(left) && right?.type === 'Literal' && right.value === false) ||
         (isDraggingMember(right) && left?.type === 'Literal' && left.value === false))) return true;
  }
  return false;
}

function isDraggingFalseTest(test) {
  if (!test) return false;
  if (test.type === 'LogicalExpression' && test.operator === '&&') {
    return isDraggingFalseTest(test.left) || isDraggingFalseTest(test.right);
  }
  if (test.type === 'UnaryExpression' && test.operator === '!') {
    return isDraggingMember(test.argument) || isDraggingTrueTest(test.argument);
  }
  if (test.type === 'BinaryExpression') {
    const { left, right, operator } = test;
    if ((operator === '===' || operator === '==') &&
        ((isDraggingMember(left) && right?.type === 'Literal' && right.value === false) ||
         (isDraggingMember(right) && left?.type === 'Literal' && left.value === false))) return true;
    if ((operator === '!==' || operator === '!=') &&
        ((isDraggingMember(left) && right?.type === 'Literal' && right.value === true) ||
         (isDraggingMember(right) && left?.type === 'Literal' && left.value === true))) return true;
  }
  return false;
}

function alwaysExits(stmt) {
  if (!stmt) return false;
  if (stmt.type === 'ReturnStatement' || stmt.type === 'ContinueStatement' || stmt.type === 'ThrowStatement' || stmt.type === 'BreakStatement') return true;
  if (stmt.type === 'BlockStatement' && stmt.body.length) return alwaysExits(stmt.body.at(-1));
  return false;
}

function checksDraggingAnywhere(fnNode) {
  let checks = false;
  walkSubtree(fnNode, (n) => {
    if (n.type === 'MemberExpression' && n.property?.name === 'dragging') checks = true;
  });
  return checks;
}

function hasEarlyReturnNull(fnBody) {
  const stmts = fnBody?.body ?? [];
  return stmts.some((s) => {
    if (s.type !== 'IfStatement') return false;
    let returnsNull = false;
    walkSubtree(s.consequent, (n) => {
      if (n.type === 'ReturnStatement' && n.argument?.type === 'Literal' && n.argument.value === null) returnsNull = true;
    });
    return returnsNull;
  });
}

function isNodeToolbarJsx(node) {
  return node.type === 'JSXElement' && node.openingElement?.name?.name === 'NodeToolbar';
}

/** Problems under `root`, as `file:line — message` strings. */
export function check(root = '.') {
  const raw = scan(root, {
    allowed: new Set(),
    what: 'node drag performance guards',
    rules: ({ rel, program }) => {
      // Collect imported and local aliases to forbidden calls + top-level/local helper functions.
      const importAliases = new Map();
      const resolveAlias = (name) => importAliases.get(name) ?? name;
      for (const stmt of program.body) {
        if (stmt.type === 'ImportDeclaration') {
          for (const spec of stmt.specifiers ?? []) {
            if (spec.type === 'ImportSpecifier') {
              const imported = spec.imported?.type === 'Identifier' ? spec.imported.name : spec.imported?.value;
              if (FORBIDDEN_CALLS.has(imported)) importAliases.set(spec.local.name, imported);
            }
          }
        }
      }
      walkSubtree(program, (n) => {
        if (n.type === 'VariableDeclarator' && n.id?.type === 'Identifier' && n.init) {
          if (n.init.type === 'Identifier') {
            const resolved = resolveAlias(n.init.name);
            if (FORBIDDEN_CALLS.has(resolved)) importAliases.set(n.id.name, resolved);
          } else if (n.init.type === 'MemberExpression') {
            const prop = n.init.property?.type === 'Identifier' ? n.init.property.name : n.init.property?.value;
            if (prop && FORBIDDEN_CALLS.has(prop)) importAliases.set(n.id.name, prop);
          }
        }
      });

      const isForbidden = (node) => {
        if (node.type !== 'CallExpression') return null;
        const full = calleeName(node.callee);
        const short = full.includes('.') ? full.split('.').pop() : full;
        const resolved = resolveAlias(short);
        if (FORBIDDEN_CALLS.has(resolved) || full === 'JSON.stringify') {
          return resolved !== short ? `${full} -> ${resolved}` : full;
        }
        return null;
      };

      const localBodies = new Map();
      for (const stmt of program.body) {
        if (stmt.type === 'FunctionDeclaration' && stmt.id) localBodies.set(stmt.id.name, stmt.body);
        if (stmt.type === 'VariableDeclaration') {
          for (const d of stmt.declarations) {
            if (d.id?.type === 'Identifier' && d.init && (d.init.type === 'ArrowFunctionExpression' || d.init.type === 'FunctionExpression')) {
              localBodies.set(d.id.name, d.init.body);
            }
          }
        }
      }
      const reachesForbidden = (fnName, seen = new Set()) => {
        const resolved = resolveAlias(fnName);
        if (FORBIDDEN_CALLS.has(resolved)) return resolved !== fnName ? `${fnName} -> ${resolved}` : fnName;
        if (seen.has(fnName) || !localBodies.has(fnName)) return null;
        seen.add(fnName);
        let hit = null;
        walkSubtree(localBodies.get(fnName), (n) => {
          if (hit) return false;
          const direct = isForbidden(n);
          if (direct) { hit = direct; return false; }
          if (n.type === 'CallExpression' && n.callee?.type === 'Identifier') {
            const sub = reachesForbidden(n.callee.name, seen);
            if (sub) { hit = `${n.callee.name} -> ${sub}`; return false; }
          }
        });
        return hit;
      };

      const flagCallsInSubtree = (rootNode, report) => {
        walkSubtree(rootNode, (n) => {
          const direct = isForbidden(n);
          if (direct) { report(n, `Escritura/serialización durante el arrastre (${direct}). ${DRAG_HINT}`); return; }
          if (n.type === 'CallExpression' && n.callee?.type === 'Identifier') {
            const via = reachesForbidden(n.callee.name);
            if (via) report(n, `Escritura/serialización durante el arrastre vía ${via}. ${DRAG_HINT}`);
          }
        });
      };

      const checkDragHandler = (fnNode, name, report) => {
        if (name === 'onNodeDrag' || name === 'onSelectionDrag') {
          flagCallsInSubtree(fnNode.body, report);
          return;
        }
        // `onNodesChange` / `applyDragChanges`: flag any forbidden call in any dragging-true path, OR an unguarded position commit.
        const walkDraggingPaths = (node) => {
          if (!node || typeof node.type !== 'string') return;
          if (node.type === 'BlockStatement' && Array.isArray(node.body)) {
            for (let i = 0; i < node.body.length; i++) {
              const stmt = node.body[i];
              if (stmt.type === 'IfStatement') {
                if (isDraggingTrueTest(stmt.test)) {
                  flagCallsInSubtree(stmt.consequent, report);
                  if (stmt.alternate) walkDraggingPaths(stmt.alternate);
                  continue;
                }
                if (isDraggingFalseTest(stmt.test)) {
                  walkDraggingPaths(stmt.consequent);
                  if (stmt.alternate) flagCallsInSubtree(stmt.alternate, report);
                  if (alwaysExits(stmt.consequent)) {
                    for (const rest of node.body.slice(i + 1)) flagCallsInSubtree(rest, report);
                    break;
                  }
                  continue;
                }
              }
              walkDraggingPaths(stmt);
            }
            return;
          }
          if (node.type === 'IfStatement') {
            if (isDraggingTrueTest(node.test)) {
              flagCallsInSubtree(node.consequent, report);
              if (node.alternate) walkDraggingPaths(node.alternate);
              return;
            }
            if (isDraggingFalseTest(node.test)) {
              walkDraggingPaths(node.consequent);
              if (node.alternate) flagCallsInSubtree(node.alternate, report);
              return;
            }
          }
          if (node.type === 'ConditionalExpression') {
            if (isDraggingTrueTest(node.test)) { flagCallsInSubtree(node.consequent, report); return; }
            if (isDraggingFalseTest(node.test)) { flagCallsInSubtree(node.alternate, report); return; }
          }
          if (node.type === 'LogicalExpression') {
            if (node.operator === '&&' && isDraggingTrueTest(node.left)) { flagCallsInSubtree(node.right, report); return; }
            if (node.operator === '||' && isDraggingFalseTest(node.left)) { flagCallsInSubtree(node.right, report); return; }
          }
          for (const k of Object.keys(node)) {
            const child = node[k];
            if (Array.isArray(child)) child.forEach(walkDraggingPaths);
            else if (child && typeof child === 'object') walkDraggingPaths(child);
          }
        };
        walkDraggingPaths(fnNode.body);
        if (!checksDraggingAnywhere(fnNode.body)) {
          // If `onNodesChange` touches `position` changes AND commits without checking `dragging`, flag the commit.
          let mentionsPosition = false;
          walkSubtree(fnNode.body, (n) => {
            if (n.type === 'Literal' && n.value === 'position') mentionsPosition = true;
          });
          if (mentionsPosition) {
            walkSubtree(fnNode.body, (n) => {
              const direct = isForbidden(n);
              if (direct && direct !== 'ungroup' && direct !== 'deleteNodes') {
                report(n, `Commit de posición en onNodesChange sin distinguir \`dragging: false\` (${direct}). ${DRAG_HINT}`);
                return;
              }
              if (n.type === 'CallExpression' && n.callee?.type === 'Identifier') {
                const via = reachesForbidden(n.callee.name);
                if (via) report(n, `Commit de posición en onNodesChange sin distinguir \`dragging: false\` (${via}). ${DRAG_HINT}`);
              }
            });
          }
        }
      };

      const fnStack = [];
      const condStack = [];
      return {
        enter: (node, report) => {
          if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
            fnStack.push(node);
          }
          if (node.type === 'ConditionalExpression' || node.type === 'LogicalExpression') {
            condStack.push(node);
          }
          // Rule 1: Drag handlers (`onNodesChange`, `onNodeDrag`, `onSelectionDrag`, `applyDragChanges`).
          if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' &&
              ['onNodesChange', 'onNodeDrag', 'onSelectionDrag', 'applyDragChanges'].includes(node.id.name) && node.init) {
            let fn = node.init;
            if (fn.type === 'CallExpression' && fn.callee?.name === 'useCallback') fn = fn.arguments[0];
            if (fn && (fn.type === 'ArrowFunctionExpression' || fn.type === 'FunctionExpression')) {
              checkDragHandler(fn, node.id.name, report);
            }
          }
          if (node.type === 'JSXAttribute' && ['onNodeDrag', 'onSelectionDrag'].includes(node.name?.name) &&
              node.value?.type === 'JSXExpressionContainer') {
            const expr = node.value.expression;
            if (expr.type === 'ArrowFunctionExpression' || expr.type === 'FunctionExpression') {
              checkDragHandler(expr, node.name.name, report);
            }
          }
          // Rule 2: `<NodeToolbar` must be conditionally mounted (not always mounted with `isVisible={...}`).
          if (isNodeToolbarJsx(node) && !rel.endsWith('Operations.tsx')) {
            const enclosingFn = fnStack.at(-1);
            const guardedByCond = condStack.length > 0;
            const guardedByReturn = enclosingFn && hasEarlyReturnNull(enclosingFn.body);
            if (!guardedByCond && !guardedByReturn) {
              report(node, TOOLBAR_HINT);
            }
          }
        },
        leave: (node) => {
          if (node.type === 'ConditionalExpression' || node.type === 'LogicalExpression') condStack.pop();
          if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
            fnStack.pop();
          }
        },
      };
    },
  });
  return raw.map((e) => e.replace(/^([^:]+:\d+): /, '$1 — '));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const errors = check('.');
  if (errors.length) {
    console.error(`check-node-drag: ${errors.length} problem(s)\n${errors.map((e) => `  ${e}`).join('\n')}`);
    process.exit(1);
  }
  console.log('check-node-drag: drag handlers stay local and NodeToolbar mounts only when visible.');
}
