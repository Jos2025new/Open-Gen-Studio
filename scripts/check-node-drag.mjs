/**
 * Permanent drag-perf guard (single-scan AST check with lexical scope stack):
 * 1. In-progress drag handlers (`onNodeDrag`, `onSelectionDrag`, and `dragging: true` / unguarded `position` paths of
 *    `onNodesChange` / `applyDragChanges`) must never reach `editPresentation`, `setGraph`, `patchSession`, `applyEdit`,
 *    `moveGroup`, `recordGraph`, `travelGraph`, or serialization (`persistState`, `JSON.stringify`).
 * 2. Card components must not mount `<NodeToolbar` unconditionally.
 * 3. `useCutTool` pointermove handlers must not rescan the full trail (`trailCuts` or loop over `trail`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseSync } from 'rolldown/utils';
import { scan } from './ast-scan.mjs';

const FORBIDDEN = new Set(['editPresentation', 'setGraph', 'patchSession', 'applyEdit', 'moveGroup', 'recordGraph', 'travelGraph', 'persistState', 'JSON.stringify']);
const TRACKED = new Set([...FORBIDDEN, 'trailCuts', 'NodeToolbar']);
const HANDLERS = new Set(['onNodesChange', 'onNodeDrag', 'onSelectionDrag', 'applyDragChanges']);
const JSX_DRAG_ATTRS = new Set(['onNodesChange', 'onNodeDrag', 'onSelectionDrag']);
const RELEVANT_RE = /onNodesChange|onNodeDrag|onSelectionDrag|applyDragChanges|useCutTool|NodeToolbar/;
const TRAIL_NAMES = new Set(['trail', 'curTrail', 'next', 'trailRef']);
const ITER_METHODS = new Set(['forEach', 'map', 'filter', 'some', 'every', 'reduce', 'find']);

const DRAG_HINT = 'No escribas el grafo, historial ni serialices durante el arrastre en curso; usa estado local y aplica editPresentation al soltar (dragging: false).';
const CUT_HINT = 'No recorras todo el trazo de la tijera en cada pointermove; prueba solo el segmento [anterior, actual] y acumula los cortes.';
const TOOLBAR_HINT = 'NodeToolbar montado incondicionalmente; móntalo solo cuando la tarjeta esté seleccionada.';

function rawMemberName(n) {
  if (!n) return '';
  if (n.type === 'Identifier') return n.name;
  if (n.type === 'MemberExpression') {
    const obj = rawMemberName(n.object), prop = n.property?.name ?? n.property?.value ?? '';
    return obj && prop ? `${obj}.${prop}` : prop;
  }
  return '';
}

function calleeName(c) {
  if (c?.type === 'MemberExpression' && (c.property?.name === 'call' || c.property?.name === 'apply') && c.object) return calleeName(c.object);
  return rawMemberName(c);
}

function unwrapFn(n) {
  if (!n) return null;
  if (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression' || n.type === 'FunctionDeclaration') return n;
  if (n.type === 'CallExpression' && /^(?:.*\.)?(?:useCallback|useMemo)$/.test(calleeName(n.callee))) return unwrapFn(n.arguments?.[0]);
  return null;
}

function walkSubtree(node, fn) {
  if (!node || typeof node.type !== 'string' || fn(node) === false) return;
  for (const k of Object.keys(node)) {
    const child = node[k];
    if (Array.isArray(child)) child.forEach((c) => walkSubtree(c, fn));
    else if (child && typeof child === 'object') walkSubtree(child, fn);
  }
}

function isDraggingMember(node, trueVars) {
  return Boolean(node && ((node.type === 'MemberExpression' && node.property?.name === 'dragging') || (node.type === 'Identifier' && trueVars.has(node.name))));
}

function isDraggingTest(test, wantTrue, trueVars, falseVars) {
  if (!test) return false;
  if (test.type === 'LogicalExpression' && test.operator === '&&') {
    return isDraggingTest(test.left, wantTrue, trueVars, falseVars) || isDraggingTest(test.right, wantTrue, trueVars, falseVars);
  }
  if (wantTrue && isDraggingMember(test, trueVars)) return true;
  if (!wantTrue && test.type === 'Identifier' && falseVars.has(test.name)) return true;
  if (test.type === 'UnaryExpression' && test.operator === '!') return isDraggingTest(test.argument, !wantTrue, trueVars, falseVars);
  if (test.type === 'BinaryExpression') {
    const { left, right, operator } = test;
    const eq = operator === '===' || operator === '==';
    const neq = operator === '!==' || operator === '!=';
    if (eq || neq) {
      const target = eq ? wantTrue : !wantTrue;
      return (isDraggingMember(left, trueVars) && right?.value === target) || (isDraggingMember(right, trueVars) && left?.value === target);
    }
  }
  return false;
}

function collectDraggingAliases(fnNode) {
  const trueVars = new Set(), falseVars = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    walkSubtree(fnNode, (n) => {
      if (n.type === 'ObjectPattern') {
        for (const p of n.properties ?? []) {
          const val = (p.value?.type === 'AssignmentPattern' ? p.value.left : p.value)?.name;
          if ((p.key?.name ?? p.key?.value) === 'dragging' && val && !trueVars.has(val)) { trueVars.add(val); changed = true; }
        }
      } else if (n.type === 'VariableDeclarator' && n.id?.type === 'Identifier' && n.init) {
        const name = n.id.name;
        if (!trueVars.has(name) && isDraggingTest(n.init, true, trueVars, falseVars)) { trueVars.add(name); changed = true; }
        else if (!falseVars.has(name) && isDraggingTest(n.init, false, trueVars, falseVars)) { falseVars.add(name); changed = true; }
      }
    });
  }
  return { trueVars, falseVars };
}

function alwaysExits(stmt) {
  if (!stmt) return false;
  if (stmt.type === 'ReturnStatement' || stmt.type === 'ContinueStatement' || stmt.type === 'ThrowStatement' || stmt.type === 'BreakStatement') return true;
  return stmt.type === 'BlockStatement' && stmt.body.length > 0 && alwaysExits(stmt.body.at(-1));
}

function registerVarDecls(scope, decls, scopesSnap) {
  for (const d of decls ?? []) {
    if (!d.init) continue;
    if (d.id?.type === 'Identifier') {
      const idName = d.id.name, fn = unwrapFn(d.init);
      if (fn) scope.set(idName, { kind: 'fn', node: fn, scopes: scopesSnap });
      else if (d.init.type === 'Identifier' || d.init.type === 'MemberExpression') {
        const target = rawMemberName(d.init);
        if (target) scope.set(idName, { kind: 'alias', target, scopes: scopesSnap });
      } else if (d.init.type === 'ObjectExpression') {
        for (const p of d.init.properties ?? []) {
          const key = p.key?.name ?? p.key?.value, pFn = unwrapFn(p.value);
          if (!key || !p.value) continue;
          if (pFn) scope.set(`${idName}.${key}`, { kind: 'fn', node: pFn, scopes: scopesSnap });
          else if (rawMemberName(p.value)) scope.set(`${idName}.${key}`, { kind: 'alias', target: rawMemberName(p.value), scopes: scopesSnap });
        }
      }
    } else if (d.id?.type === 'ObjectPattern') {
      const initName = rawMemberName(d.init);
      for (const p of d.id.properties ?? []) {
        const key = p.key?.name ?? p.key?.value, val = (p.value?.type === 'AssignmentPattern' ? p.value.left : p.value)?.name;
        if (key && val) scope.set(val, { kind: 'alias', target: initName ? `${initName}.${key}` : key, scopes: scopesSnap });
      }
    }
  }
}

function populateScope(scope, stmts, scopesSnap) {
  for (const s of stmts ?? []) {
    if (s.type === 'ImportDeclaration' && s.source?.value) {
      for (const sp of s.specifiers ?? []) {
        if (sp.type === 'ImportSpecifier' && sp.local?.name) scope.set(sp.local.name, { kind: 'import', source: s.source.value, imported: sp.imported?.name ?? sp.imported?.value });
        else if (sp.type === 'ImportNamespaceSpecifier' && sp.local?.name) scope.set(sp.local.name, { kind: 'ns', source: s.source.value });
      }
    } else if (s.type === 'FunctionDeclaration' && s.id?.name) scope.set(s.id.name, { kind: 'fn', node: s, scopes: scopesSnap });
    else if (s.type === 'VariableDeclaration') registerVarDecls(scope, s.declarations, scopesSnap);
    else if (s.type === 'ExportNamedDeclaration') {
      if (s.declaration?.type === 'FunctionDeclaration' && s.declaration.id?.name) scope.set(s.declaration.id.name, { kind: 'fn', node: s.declaration, scopes: scopesSnap });
      else if (s.declaration?.type === 'VariableDeclaration') registerVarDecls(scope, s.declaration.declarations, scopesSnap);
      for (const sp of s.specifiers ?? []) {
        const local = sp.local?.name ?? sp.local?.value, exported = sp.exported?.name ?? sp.exported?.value;
        if (!local || !exported) continue;
        if (s.source?.value) scope.set(exported, { kind: 'import', source: s.source.value, imported: local });
        else if (local !== exported) scope.set(exported, { kind: 'alias', target: local, scopes: scopesSnap });
      }
    }
  }
}

function lookup(name, scopes) {
  for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i].has(name)) return scopes[i].get(name);
  return null;
}

/** Problems under `root`, as `file:line — message` strings. */
export function check(root = '.') {
  const extMods = new Map();

  function getModuleScope(fromRel, spec) {
    if (!spec?.startsWith('.')) return null;
    const base = posix.normalize(posix.join(posix.dirname(fromRel), spec.split('?')[0].replace(/\.(?:[cm]?[jt]sx?)$/, '')));
    for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
      if (extMods.has(cand)) return extMods.get(cand);
      const abs = join(root, cand);
      if (existsSync(abs)) {
        const { program } = parseSync(abs, readFileSync(abs, 'utf8'));
        const scope = new Map(), mod = { rel: cand, scopes: [scope] };
        populateScope(scope, program.body, mod.scopes);
        extMods.set(cand, mod);
        return mod;
      }
    }
    return null;
  }

  function resolveImport(fromRel, source, imported, seen) {
    const mod = getModuleScope(fromRel, source);
    return (mod && resolveSymbol(mod.rel, imported, mod.scopes, seen)) || (TRACKED.has(imported) ? { kind: 'tracked', name: imported } : null);
  }

  function resolveSymbol(rel, name, scopes, seen = new Set()) {
    if (!name || seen.has(`${rel}::${name}`)) return null;
    seen.add(`${rel}::${name}`);
    const b = lookup(name, scopes);
    if (b) {
      if (b.kind === 'param') return null;
      if (b.kind === 'alias') return resolveSymbol(rel, b.target, b.scopes, seen);
      if (b.kind === 'fn') return { kind: 'fn', rel, name, node: b.node, scopes: b.scopes };
      if (b.kind === 'import') return resolveImport(rel, b.source, b.imported, seen);
    }
    if (TRACKED.has(name)) return { kind: 'tracked', name };
    if (name.includes('.')) {
      const [obj, ...rest] = name.split('.'), prop = rest.join('.'), objB = lookup(obj, scopes);
      if (objB?.kind === 'ns') return resolveImport(rel, objB.source, prop, seen);
      if (objB?.kind === 'alias') return resolveSymbol(rel, `${objB.target}.${prop}`, objB.scopes, seen);
      const last = rest.at(-1);
      if (FORBIDDEN.has(last) && obj !== 'JSON') return { kind: 'tracked', name: last };
    }
    return null;
  }

  function bodyScopesForFn(fnB) {
    const fnScope = new Map(), nextScopes = [...fnB.scopes, fnScope];
    for (const p of fnB.node.params ?? []) if (p.type === 'Identifier') fnScope.set(p.name, { kind: 'param' });
    if (fnB.node.body?.type === 'BlockStatement') populateScope(fnScope, fnB.node.body.body, nextScopes);
    return nextScopes;
  }

  function callForbiddenTarget(rel, callNode, scopes, seen = new Set()) {
    const cname = callNode?.type === 'CallExpression' ? calleeName(callNode.callee) : '';
    const resolved = cname ? resolveSymbol(rel, cname, scopes) : null;
    if (!resolved) return null;
    if (resolved.kind === 'tracked' && FORBIDDEN.has(resolved.name)) return cname !== resolved.name ? `${cname} -> ${resolved.name}` : cname;
    if (resolved.kind === 'fn') {
      const fnKey = `${resolved.rel}::${resolved.name}::${resolved.node.start}`;
      if (seen.has(fnKey)) return null;
      seen.add(fnKey);
      const innerScopes = bodyScopesForFn(resolved);
      let hit = null;
      walkSubtree(resolved.node.body, (n) => {
        if (hit) return false;
        if (n.type === 'CallExpression') {
          const sub = callForbiddenTarget(resolved.rel, n, innerScopes, new Set(seen));
          if (sub) { hit = `${cname} -> ${sub}`; return false; }
        }
      });
      return hit;
    }
    return null;
  }

  function isNodeToolbarJsx(rel, node, scopes) {
    if (node.type !== 'JSXElement') return false;
    const n = node.openingElement?.name;
    const tag = n?.type === 'JSXIdentifier' ? n.name : n?.type === 'JSXMemberExpression' ? `${n.object?.name ?? ''}.${n.property?.name ?? ''}` : '';
    if (!tag) return false;
    return tag === 'NodeToolbar' || tag.endsWith('.NodeToolbar') || resolveSymbol(rel, tag, scopes)?.name === 'NodeToolbar';
  }

  const raw = scan(root, {
    allowed: new Set(),
    what: 'node drag performance guards',
    rules: ({ rel, text }) => {
      if (!RELEVANT_RE.test(text)) return { enter() {} };
      const scopes = [], condStack = [], cutToolNodes = new Set();

      const flagCalls = (rootNode, activeScopes, report, skipFalseVars) => {
        const walk = (n) => {
          if (!n || typeof n.type !== 'string') return;
          if (skipFalseVars && n.type === 'IfStatement' && isDraggingTest(n.test, false, skipFalseVars.trueVars, skipFalseVars.falseVars)) {
            if (n.alternate) walk(n.alternate);
            return;
          }
          if (n.type === 'CallExpression') {
            const hit = callForbiddenTarget(rel, n, activeScopes);
            if (hit) report(n, `Escritura/serialización durante el arrastre${hit.includes(' -> ') ? ` vía ${hit}` : ` (${hit})`}. ${DRAG_HINT}`);
          }
          for (const k of Object.keys(n)) {
            const child = n[k];
            if (Array.isArray(child)) child.forEach(walk);
            else if (child && typeof child === 'object') walk(child);
          }
        };
        walk(rootNode);
      };

      const checkDragHandler = (fnNode, name, activeScopes, report) => {
        if (!fnNode?.body) return;
        const handlerScopes = bodyScopesForFn({ node: fnNode, scopes: activeScopes });
        if (name === 'onNodeDrag' || name === 'onSelectionDrag') { flagCalls(fnNode.body, handlerScopes, report); return; }
        const { trueVars, falseVars } = collectDraggingAliases(fnNode);
        let guarded = false;
        const walkPaths = (node) => {
          if (!node || typeof node.type !== 'string') return;
          if (node.type === 'BlockStatement' && Array.isArray(node.body)) {
            for (let i = 0; i < node.body.length; i++) {
              const s = node.body[i];
              if (s.type === 'IfStatement') {
                if (isDraggingTest(s.test, true, trueVars, falseVars)) {
                  guarded = true;
                  flagCalls(s.consequent, handlerScopes, report);
                  if (s.alternate) walkPaths(s.alternate);
                  else if (!alwaysExits(s.consequent)) for (const r of node.body.slice(i + 1)) flagCalls(r, handlerScopes, report, { trueVars, falseVars });
                  continue;
                }
                if (isDraggingTest(s.test, false, trueVars, falseVars)) {
                  guarded = true;
                  walkPaths(s.consequent);
                  if (s.alternate) flagCalls(s.alternate, handlerScopes, report);
                  if (alwaysExits(s.consequent)) { for (const r of node.body.slice(i + 1)) flagCalls(r, handlerScopes, report); break; }
                  continue;
                }
              }
              walkPaths(s);
            }
            return;
          }
          if (node.type === 'ConditionalExpression') {
            if (isDraggingTest(node.test, true, trueVars, falseVars)) { guarded = true; flagCalls(node.consequent, handlerScopes, report); return; }
            if (isDraggingTest(node.test, false, trueVars, falseVars)) { guarded = true; flagCalls(node.alternate, handlerScopes, report); return; }
          }
          if (node.type === 'LogicalExpression') {
            if (node.operator === '&&' && isDraggingTest(node.left, true, trueVars, falseVars)) { guarded = true; flagCalls(node.right, handlerScopes, report); return; }
            if (node.operator === '||' && isDraggingTest(node.left, false, trueVars, falseVars)) { guarded = true; flagCalls(node.right, handlerScopes, report); return; }
          }
          for (const k of Object.keys(node)) {
            const child = node[k];
            if (Array.isArray(child)) child.forEach(walkPaths);
            else if (child && typeof child === 'object') walkPaths(child);
          }
        };
        walkPaths(fnNode.body);
        if (!guarded) {
          let mentionsPos = false;
          walkSubtree(fnNode.body, (n) => { if (n.type === 'Literal' && n.value === 'position') mentionsPos = true; });
          if (mentionsPos) {
            walkSubtree(fnNode.body, (n) => {
              const hit = callForbiddenTarget(rel, n, handlerScopes);
              if (hit && hit !== 'ungroup' && hit !== 'deleteNodes') report(n, `Commit de posición en onNodesChange sin distinguir \`dragging: false\` (${hit}). ${DRAG_HINT}`);
            });
          }
        }
      };

      const cutMoveRescansTrail = (fnNode, activeScopes, report) => {
        const refsTrail = (node) => { let hit = false; walkSubtree(node, (n) => { if (n.type === 'Identifier' && TRAIL_NAMES.has(n.name)) { hit = true; return false; } }); return hit; };
        const hasTrailScan = (curRel, node, curScopes, seen = new Set()) => {
          let hit = null;
          walkSubtree(node, (n) => {
            if (hit) return false;
            if (n.type === 'CallExpression') {
              const resolved = resolveSymbol(curRel, calleeName(n.callee), curScopes);
              if (resolved?.name === 'trailCuts') { hit = n; return false; }
              if (resolved?.kind === 'fn' && !seen.has(`${resolved.rel}::${resolved.name}::${resolved.node.start}`)) {
                seen.add(`${resolved.rel}::${resolved.name}::${resolved.node.start}`);
                if (hasTrailScan(resolved.rel, resolved.node.body, bodyScopesForFn(resolved), seen)) { hit = n; return false; }
              }
              if (n.callee?.type === 'MemberExpression' && ITER_METHODS.has(n.callee.property?.name) && refsTrail(n.callee.object)) { hit = n; return false; }
            }
            if ((n.type === 'ForStatement' || n.type === 'ForOfStatement' || n.type === 'WhileStatement' || n.type === 'DoWhileStatement') && refsTrail(n.test ?? n.right ?? n.init)) { hit = n; return false; }
          });
          return hit;
        };
        const bad = hasTrailScan(rel, fnNode.body, bodyScopesForFn({ node: fnNode, scopes: activeScopes }));
        if (bad) report(bad, `La tijera recorre todo el trazo en pointermove. ${CUT_HINT}`);
      };

      const isScope = (n) => n.type === 'Program' || n.type === 'BlockStatement' || n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression';

      return {
        enter: (node, report) => {
          if (isScope(node)) {
            const scope = new Map();
            scopes.push(scope);
            for (const p of node.params ?? []) if (p.type === 'Identifier') scope.set(p.name, { kind: 'param' });
            if (node.type === 'Program' || node.type === 'BlockStatement') populateScope(scope, node.body, [...scopes]);
          }
          if ((node.type === 'FunctionDeclaration' || node.type === 'VariableDeclarator') && node.id?.name === 'useCutTool') cutToolNodes.add(node);
          if (node.type === 'ConditionalExpression' || node.type === 'LogicalExpression') condStack.push(node);
          if (cutToolNodes.size > 0 && (node.id?.name === 'move' || node.id?.name === 'onPointerMove')) {
            const fn = node.type === 'FunctionDeclaration' ? node : unwrapFn(node.init);
            if (fn) cutMoveRescansTrail(fn, [...scopes], report);
          }
          if (node.type === 'VariableDeclarator' && HANDLERS.has(node.id?.name) && node.init) {
            const fn = unwrapFn(node.init);
            if (fn) checkDragHandler(fn, node.id.name, [...scopes], report);
          } else if (node.type === 'FunctionDeclaration' && HANDLERS.has(node.id?.name)) {
            checkDragHandler(node, node.id.name, [...scopes], report);
          } else if (node.type === 'JSXAttribute' && JSX_DRAG_ATTRS.has(node.name?.name) && node.value?.type === 'JSXExpressionContainer') {
            const expr = node.value.expression, fn = unwrapFn(expr);
            if (fn) checkDragHandler(fn, node.name.name, [...scopes], report);
            else if (expr?.type === 'Identifier' && !HANDLERS.has(expr.name)) {
              const resolved = resolveSymbol(rel, expr.name, scopes);
              if (resolved?.kind === 'fn') checkDragHandler(resolved.node, node.name.name, resolved.scopes, report);
            }
          }
          if (isNodeToolbarJsx(rel, node, scopes) && !rel.endsWith('Operations.tsx') && condStack.length === 0) report(node, TOOLBAR_HINT);
        },
        leave: (node) => {
          if (node.type === 'ConditionalExpression' || node.type === 'LogicalExpression') condStack.pop();
          cutToolNodes.delete(node);
          if (isScope(node)) scopes.pop();
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
