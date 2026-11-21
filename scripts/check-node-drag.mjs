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

function isForbiddenCall(node) {
  if (node.type !== 'CallExpression') return null;
  const full = calleeName(node.callee);
  const short = full.includes('.') ? full.split('.').pop() : full;
  if (FORBIDDEN_CALLS.has(short) || full === 'JSON.stringify') return full;
  return null;
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

function isDraggingTrueTest(test) {
  let found = false;
  walkSubtree(test, (n) => {
    if (n.type === 'BinaryExpression' && n.left?.type === 'MemberExpression' && n.left.property?.name === 'dragging') {
      if ((n.operator === '===' || n.operator === '==') && n.right?.type === 'Literal' && n.right.value === true) found = true;
      if ((n.operator === '!==' || n.operator === '!=') && n.right?.type === 'Literal' && n.right.value === false) found = true;
    }
    if (n.type === 'MemberExpression' && n.property?.name === 'dragging') {
      // Positive truthiness check like `if (c.dragging)` when not negated.
      found = true;
    }
    if (n.type === 'UnaryExpression' && n.operator === '!' && n.argument?.type === 'MemberExpression' && n.argument.property?.name === 'dragging') {
      return false;
    }
    if (n.type === 'BinaryExpression' && n.left?.type === 'MemberExpression' && n.left.property?.name === 'dragging' &&
        (n.operator === '===' || n.operator === '==') && n.right?.type === 'Literal' && n.right.value === false) {
      return false;
    }
  });
  return found;
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
      // Collect top-level / local helper functions that reach forbidden calls.
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
        if (FORBIDDEN_CALLS.has(fnName)) return fnName;
        if (seen.has(fnName) || !localBodies.has(fnName)) return null;
        seen.add(fnName);
        let hit = null;
        walkSubtree(localBodies.get(fnName), (n) => {
          if (hit) return false;
          const direct = isForbiddenCall(n);
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
          const direct = isForbiddenCall(n);
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
        // `onNodesChange`: flag any forbidden call inside a `dragging === true` branch, OR an unguarded position commit.
        walkSubtree(fnNode.body, (n) => {
          if (n.type === 'IfStatement' && isDraggingTrueTest(n.test)) {
            flagCallsInSubtree(n.consequent, report);
            return false;
          }
        });
        if (!checksDraggingAnywhere(fnNode.body)) {
          // If `onNodesChange` touches `position` changes AND commits without checking `dragging`, flag the commit.
          let mentionsPosition = false;
          walkSubtree(fnNode.body, (n) => {
            if (n.type === 'Literal' && n.value === 'position') mentionsPosition = true;
          });
          if (mentionsPosition) {
            walkSubtree(fnNode.body, (n) => {
              const direct = isForbiddenCall(n);
              if (direct && direct !== 'ungroup' && direct !== 'deleteNodes') {
                report(n, `Commit de posición en onNodesChange sin distinguir \`dragging: false\` (${direct}). ${DRAG_HINT}`);
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
