/**
 * Permanent drag-perf guard (single-scan AST check with lexical scope stack):
 * 1. In-progress drag paths (`onNodeDrag`, `onSelectionDrag`, their `*Start`, and the drag branches of `onNodesChange` /
 *    `applyDragChanges`: `dragging` true or an open `flightRef.current`) must not reach
 *    `editPresentation`, `setGraph`, `patchSession`, `applyEdit`, `moveGroup`, `recordGraph`, `travelGraph`, `persistState`, `JSON.stringify`.
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
const STRICT = new Set(['onNodeDrag', 'onSelectionDrag', 'onNodeDragStart', 'onSelectionDragStart']);
const HANDLERS = new Set([...STRICT, 'onNodesChange', 'applyDragChanges']);
const JSX_DRAG_ATTRS = new Set([...STRICT, 'onNodesChange']);
// The open drag flight in useNodeDrag: while it is set, a gesture is in progress.
const FLIGHT = 'flightRef.current';
const RELEVANT_RE = /onNodesChange|onNodeDrag|onSelectionDrag|applyDragChanges|useCutTool|NodeToolbar/;
const TRAIL_NAMES = new Set(['trail', 'curTrail', 'next', 'trailRef']);
const ITER_METHODS = new Set(['forEach', 'map', 'filter', 'some', 'every', 'reduce', 'find']);

const DRAG_HINT = 'No escribas el grafo, historial ni serialices durante el arrastre en curso; usa estado local y aplica editPresentation al soltar (onNodeDragStop; sin gesto, dragging: false directo).';
const CUT_HINT = 'No recorras todo el trazo de la tijera en cada pointermove; prueba solo el segmento [anterior, actual] y acumula los cortes.';
const TOOLBAR_HINT = 'NodeToolbar montado incondicionalmente; móntalo solo cuando la tarjeta esté seleccionada.';

function memberName(n) {
  if (!n) return '';
  if (n.type === 'Identifier') return n.name;
  if (n.type === 'MemberExpression') {
    const obj = memberName(n.object), prop = n.property?.name ?? n.property?.value ?? '';
    return obj && prop ? `${obj}.${prop}` : prop;
  }
  return '';
}
function calleeName(c) {
  return c?.type === 'MemberExpression' && (c.property?.name === 'call' || c.property?.name === 'apply') && c.object ? calleeName(c.object) : memberName(c);
}
function unwrapFn(n) {
  if (!n) return null;
  if (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression' || n.type === 'FunctionDeclaration') return n;
  return n.type === 'CallExpression' && /^(?:.*\.)?(?:useCallback|useMemo)$/.test(calleeName(n.callee)) ? unwrapFn(n.arguments?.[0]) : null;
}
function walkSubtree(node, fn) {
  if (!node || typeof node.type !== 'string' || fn(node) === false) return;
  for (const child of Object.values(node)) {
    if (Array.isArray(child)) child.forEach((c) => walkSubtree(c, fn));
    else if (child && typeof child === 'object') walkSubtree(child, fn);
  }
}
function isDragMem(node, trueVars) {
  return Boolean(node && ((node.type === 'MemberExpression' && (node.property?.name === 'dragging' || memberName(node) === FLIGHT)) || (node.type === 'Identifier' && trueVars.has(node.name))));
}
function isDragTest(test, wantTrue, trueVars, falseVars) {
  if (!test) return false;
  if (test.type === 'LogicalExpression') {
    if (test.operator === '&&') return isDragTest(test.left, wantTrue, trueVars, falseVars) || isDragTest(test.right, wantTrue, trueVars, falseVars);
    if (test.operator === '||') return isDragTest(test.left, wantTrue, trueVars, falseVars) && isDragTest(test.right, wantTrue, trueVars, falseVars);
  }
  if (wantTrue && isDragMem(test, trueVars)) return true;
  if (!wantTrue && test.type === 'Identifier' && falseVars.has(test.name)) return true;
  if (test.type === 'UnaryExpression' && test.operator === '!') return isDragTest(test.argument, !wantTrue, trueVars, falseVars);
  if (test.type === 'BinaryExpression') {
    const { left, right, operator } = test;
    const eq = operator === '===' || operator === '==', neq = operator === '!==' || operator === '!=';
    if (eq || neq) {
      const target = eq ? wantTrue : !wantTrue;
      return (isDragMem(left, trueVars) && right?.value === target) || (isDragMem(right, trueVars) && left?.value === target);
    }
  }
  return false;
}
function dragAliases(fnNode) {
  const trueVars = new Set(), falseVars = new Set();
  for (let changed = true; changed;) {
    changed = false;
    walkSubtree(fnNode, (n) => {
      if (n.type === 'ObjectPattern') {
        for (const p of n.properties ?? []) {
          const val = (p.value?.type === 'AssignmentPattern' ? p.value.left : p.value)?.name;
          if ((p.key?.name ?? p.key?.value) === 'dragging' && val && !trueVars.has(val)) { trueVars.add(val); changed = true; }
        }
      } else if (n.type === 'VariableDeclarator' && n.id?.type === 'Identifier' && n.init) {
        const name = n.id.name;
        if (!trueVars.has(name) && isDragTest(n.init, true, trueVars, falseVars)) { trueVars.add(name); changed = true; }
        else if (!falseVars.has(name) && isDragTest(n.init, false, trueVars, falseVars)) { falseVars.add(name); changed = true; }
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
const isFnDef = (n) => n.type === 'FunctionDeclaration' || (n.type === 'VariableDeclarator' && Boolean(unwrapFn(n.init)));
function bindIds(scope, list, kind) {
  for (const p of list ?? []) {
    if (!p) continue;
    if (p.type === 'Identifier') scope.set(p.name, { kind });
    else if (p.type === 'AssignmentPattern') bindIds(scope, [p.left], kind);
    else if (p.type === 'RestElement') bindIds(scope, [p.argument], kind);
    else if (p.type === 'ObjectPattern') bindIds(scope, (p.properties ?? []).map((pr) => pr.value ?? pr.argument), kind);
    else if (p.type === 'ArrayPattern') bindIds(scope, p.elements, kind);
  }
}
function regVars(scope, decls, snap) {
  for (const d of decls ?? []) {
    bindIds(scope, [d.id], 'local');
    if (!d.init) continue;
    if (d.id?.type === 'Identifier') {
      const idName = d.id.name, fn = unwrapFn(d.init);
      if (fn) scope.set(idName, { kind: 'fn', node: fn, scopes: snap });
      else if (d.init.type === 'Identifier' || d.init.type === 'MemberExpression') {
        const target = memberName(d.init);
        if (target) scope.set(idName, { kind: 'alias', target, scopes: snap });
      } else if (d.init.type === 'ObjectExpression') {
        for (const p of d.init.properties ?? []) {
          const key = p.key?.name ?? p.key?.value, pFn = unwrapFn(p.value);
          if (!key || !p.value) continue;
          if (pFn) scope.set(`${idName}.${key}`, { kind: 'fn', node: pFn, scopes: snap });
          else if (memberName(p.value)) scope.set(`${idName}.${key}`, { kind: 'alias', target: memberName(p.value), scopes: snap });
        }
      }
    } else if (d.id?.type === 'ObjectPattern') {
      const initName = memberName(d.init);
      for (const p of d.id.properties ?? []) {
        const key = p.key?.name ?? p.key?.value, val = (p.value?.type === 'AssignmentPattern' ? p.value.left : p.value)?.name;
        if (key && val) scope.set(val, { kind: 'alias', target: initName ? `${initName}.${key}` : key, scopes: snap });
      }
    }
  }
}
function populateScope(scope, stmts, snap) {
  for (const s of stmts ?? []) {
    if (s.type === 'ImportDeclaration' && s.source?.value) {
      for (const sp of s.specifiers ?? []) {
        if (sp.type === 'ImportSpecifier' && sp.local?.name) scope.set(sp.local.name, { kind: 'import', source: s.source.value, imported: sp.imported?.name ?? sp.imported?.value });
        else if (sp.type === 'ImportNamespaceSpecifier' && sp.local?.name) scope.set(sp.local.name, { kind: 'ns', source: s.source.value });
      }
    } else if (s.type === 'FunctionDeclaration' && s.id?.name) scope.set(s.id.name, { kind: 'fn', node: s, scopes: snap });
    else if (s.type === 'VariableDeclaration') regVars(scope, s.declarations, snap);
    else if (s.type === 'ExportNamedDeclaration') {
      if (s.declaration?.type === 'FunctionDeclaration' && s.declaration.id?.name) scope.set(s.declaration.id.name, { kind: 'fn', node: s.declaration, scopes: snap });
      else if (s.declaration?.type === 'VariableDeclaration') regVars(scope, s.declaration.declarations, snap);
      for (const sp of s.specifiers ?? []) {
        const local = sp.local?.name ?? sp.local?.value, exported = sp.exported?.name ?? sp.exported?.value;
        if (!local || !exported) continue;
        if (s.source?.value) scope.set(exported, { kind: 'import', source: s.source.value, imported: local });
        else if (local !== exported) scope.set(exported, { kind: 'alias', target: local, scopes: snap });
      }
    }
  }
}
function bindParams(fnNode, sc) {
  const scope = new Map(); bindIds(scope, fnNode.params, 'param'); return [...sc, scope];
}
function extendScope(node, sc) {
  if (node.type === 'Program' || node.type === 'BlockStatement') {
    const scope = new Map(), next = [...sc, scope]; populateScope(scope, node.body, next); return next;
  }
  if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') return bindParams(node, sc);
  if (node.type === 'ForStatement' || node.type === 'ForOfStatement' || node.type === 'ForInStatement') {
    const decl = node.init ?? node.left;
    if (decl?.type === 'VariableDeclaration') {
      const scope = new Map(), next = [...sc, scope]; regVars(scope, decl.declarations, next); return next;
    }
  }
  return sc;
}
function walkScopes(node, sc, fn) {
  if (!node || typeof node.type !== 'string') return;
  const next = extendScope(node, sc);
  if (fn(node, next) === false) return;
  for (const child of Object.values(node)) {
    if (Array.isArray(child)) child.forEach((c) => walkScopes(c, next, fn));
    else if (child && typeof child === 'object') walkScopes(child, next, fn);
  }
}
function lookup(name, scopes) {
  for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i].has(name)) return scopes[i].get(name);
  return null;
}

export function check(root = '.') {
  const extMods = new Map();
  function modScope(fromRel, spec) {
    if (!spec?.startsWith('.')) return null;
    const base = posix.normalize(posix.join(posix.dirname(fromRel), spec.split('?')[0].replace(/\.(?:[cm]?[jt]sx?)$/, '')));
    for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
      if (extMods.has(cand)) return extMods.get(cand);
      const abs = join(root, cand);
      if (existsSync(abs)) {
        const { program } = parseSync(abs, readFileSync(abs, 'utf8'));
        const scope = new Map(), mod = { rel: cand, scopes: [scope] };
        populateScope(scope, program.body, mod.scopes); extMods.set(cand, mod); return mod;
      }
    }
    return null;
  }
  function resolveImport(fromRel, source, imported, seen) {
    const mod = modScope(fromRel, source);
    return (mod && resolveSym(mod.rel, imported, mod.scopes, seen)) || (TRACKED.has(imported) ? { kind: 'tracked', name: imported } : null);
  }
  function resolveSym(rel, name, scopes, seen = new Set()) {
    if (!name || seen.has(`${rel}::${name}`)) return null;
    seen.add(`${rel}::${name}`);
    const b = lookup(name, scopes);
    if (b) {
      if (b.kind === 'param' || b.kind === 'local') return null;
      if (b.kind === 'alias') return resolveSym(rel, b.target, b.scopes, seen);
      if (b.kind === 'fn') return { kind: 'fn', rel, name, node: b.node, scopes: b.scopes };
      if (b.kind === 'import') return resolveImport(rel, b.source, b.imported, seen);
    }
    if (TRACKED.has(name)) return { kind: 'tracked', name };
    if (name.includes('.')) {
      const [obj, ...rest] = name.split('.'), prop = rest.join('.'), objB = lookup(obj, scopes);
      if (objB?.kind === 'ns') return resolveImport(rel, objB.source, prop, seen);
      if (objB?.kind === 'alias') return resolveSym(rel, `${objB.target}.${prop}`, objB.scopes, seen);
      const last = rest.at(-1);
      if (FORBIDDEN.has(last) && obj !== 'JSON') return { kind: 'tracked', name: last };
    }
    return null;
  }
  function badCall(rel, callNode, scopes, seen = new Set()) {
    const cname = callNode?.type === 'CallExpression' ? calleeName(callNode.callee) : '';
    const res = cname ? resolveSym(rel, cname, scopes) : null;
    if (!res) return null;
    if (res.kind === 'tracked' && FORBIDDEN.has(res.name)) return cname !== res.name ? `${cname} -> ${res.name}` : cname;
    if (res.kind === 'fn') {
      const fnKey = `${res.rel}::${res.name}::${res.node.start}`;
      if (seen.has(fnKey)) return null;
      seen.add(fnKey);
      let hit = null;
      walkScopes(res.node.body, bindParams(res.node, res.scopes), (n, sc) => {
        if (hit || isFnDef(n)) return false;
        if (n.type === 'CallExpression') {
          const sub = badCall(res.rel, n, sc, new Set(seen));
          if (sub) { hit = `${cname} -> ${sub}`; return false; }
        }
      });
      return hit;
    }
    return null;
  }
  function isToolbar(rel, node, scopes) {
    if (node.type !== 'JSXElement') return false;
    const n = node.openingElement?.name;
    const tag = n?.type === 'JSXIdentifier' ? n.name : n?.type === 'JSXMemberExpression' ? `${n.object?.name ?? ''}.${n.property?.name ?? ''}` : '';
    return Boolean(tag && (tag === 'NodeToolbar' || tag.endsWith('.NodeToolbar') || resolveSym(rel, tag, scopes)?.name === 'NodeToolbar'));
  }

  const raw = scan(root, {
    allowed: new Set(),
    what: 'node drag performance guards',
    rules: ({ rel, text }) => {
      if (!RELEVANT_RE.test(text)) return { enter() {} };
      const scopes = [], condStack = [], cutToolNodes = new Set();
      const checkHandler = (fnNode, name, activeScopes, report) => {
        if (!fnNode?.body) return;
        const fnScopes = bindParams(fnNode, activeScopes);
        const flagCall = (n, sc, inNonDrag = false) => {
          const hit = badCall(rel, n, sc);
          if (hit && !(inNonDrag && /^(?:ungroup|deleteNodes|settleNewNodes)\b/.test(hit))) {
            report(n, `Escritura/serialización durante el arrastre${hit.includes(' -> ') ? ` vía ${hit}` : ` (${hit})`}. ${DRAG_HINT}`);
          }
        };
        if (STRICT.has(name)) {
          walkScopes(fnNode.body, fnScopes, (n, sc) => { if (isFnDef(n)) return false; if (n.type === 'CallExpression') flagCall(n, sc); });
          return;
        }
        const { trueVars, falseVars } = dragAliases(fnNode);
        const isNonDragGuard = (t) => {
          const c = memberName(t);
          return c === 'removed.length' || c === 'fresh.size' || (t?.type === 'BinaryExpression' && (t.operator === '===' || t.operator === '==') &&
            ((memberName(t.left).endsWith('.type') && t.right?.value === 'remove') || (memberName(t.right).endsWith('.type') && t.left?.value === 'remove')));
        };
        const walk = (node, curScopes, active = true, nonDrag = false) => {
          if (!node || typeof node.type !== 'string' || isFnDef(node)) return;
          const next = extendScope(node, curScopes);
          if (active && node.type === 'BlockStatement' && Array.isArray(node.body)) {
            for (const s of node.body) {
              walk(s, next, true, nonDrag);
              if (s.type === 'IfStatement' && !s.alternate && isDragTest(s.test, true, trueVars, falseVars) && alwaysExits(s.consequent)) break;
            }
            return;
          }
          if (node.type === 'IfStatement' || node.type === 'ConditionalExpression') {
            if (active) walk(node.test, next, true, nonDrag);
            if (isDragTest(node.test, true, trueVars, falseVars)) { walk(node.consequent, next, true, nonDrag); if (node.alternate) walk(node.alternate, next, false); return; }
            if (isDragTest(node.test, false, trueVars, falseVars)) { walk(node.consequent, next, false); if (node.alternate) walk(node.alternate, next, active, nonDrag); return; }
            walk(node.consequent, next, active, nonDrag || (node.type === 'IfStatement' && isNonDragGuard(node.test)));
            if (node.alternate) walk(node.alternate, next, active, nonDrag);
            return;
          }
          if (active && node.type === 'LogicalExpression') {
            walk(node.left, next, true, nonDrag);
            const dropRight = (node.operator === '&&' && isDragTest(node.left, false, trueVars, falseVars)) || (node.operator === '||' && isDragTest(node.left, true, trueVars, falseVars));
            walk(node.right, next, !dropRight, nonDrag);
            return;
          }
          if (active && node.type === 'CallExpression') flagCall(node, next, nonDrag);
          for (const child of Object.values(node)) {
            if (Array.isArray(child)) child.forEach((c) => walk(c, next, active, nonDrag));
            else if (child && typeof child === 'object') walk(child, next, active, nonDrag);
          }
        };
        walk(fnNode.body, fnScopes);
      };
      const checkCut = (fnNode, activeScopes, report) => {
        const refsTrail = (node) => { let hit = false; walkSubtree(node, (n) => { if (n.type === 'Identifier' && TRAIL_NAMES.has(n.name)) { hit = true; return false; } }); return hit; };
        const hasScan = (curRel, node, sc0, seen = new Set()) => {
          let hit = null;
          walkScopes(node, sc0, (n, sc) => {
            if (hit) return false;
            if (n.type === 'CallExpression') {
              const res = resolveSym(curRel, calleeName(n.callee), sc);
              if (res?.name === 'trailCuts') { hit = n; return false; }
              if (res?.kind === 'fn' && !seen.has(`${res.rel}::${res.name}::${res.node.start}`)) {
                seen.add(`${res.rel}::${res.name}::${res.node.start}`);
                if (hasScan(res.rel, res.node.body, bindParams(res.node, res.scopes), seen)) { hit = n; return false; }
              }
              if (n.callee?.type === 'MemberExpression' && ITER_METHODS.has(n.callee.property?.name) && refsTrail(n.callee.object)) { hit = n; return false; }
            }
            if ((n.type === 'ForStatement' || n.type === 'ForOfStatement' || n.type === 'WhileStatement' || n.type === 'DoWhileStatement') && refsTrail(n.test ?? n.right ?? n.init)) { hit = n; return false; }
          });
          return hit;
        };
        const bad = hasScan(rel, fnNode.body, bindParams(fnNode, activeScopes));
        if (bad) report(bad, `La tijera recorre todo el trazo en pointermove. ${CUT_HINT}`);
      };
      const isScope = (n) => n.type === 'Program' || n.type === 'BlockStatement' || n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression';
      return {
        enter: (node, report) => {
          const base = [...scopes];
          if (isScope(node)) scopes.push(extendScope(node, base).at(-1));
          if ((node.type === 'FunctionDeclaration' || node.type === 'VariableDeclarator') && node.id?.name === 'useCutTool') cutToolNodes.add(node);
          if (node.type === 'ConditionalExpression' || node.type === 'LogicalExpression') condStack.push(node);
          if (cutToolNodes.size > 0 && (node.id?.name === 'move' || node.id?.name === 'onPointerMove')) {
            const fn = node.type === 'FunctionDeclaration' ? node : unwrapFn(node.init);
            if (fn) checkCut(fn, node.type === 'FunctionDeclaration' ? base : [...scopes], report);
          }
          if (node.type === 'VariableDeclarator' && HANDLERS.has(node.id?.name) && node.init) {
            const fn = unwrapFn(node.init); if (fn) checkHandler(fn, node.id.name, [...scopes], report);
          } else if (node.type === 'FunctionDeclaration' && HANDLERS.has(node.id?.name)) {
            checkHandler(node, node.id.name, base, report);
          } else if (node.type === 'JSXAttribute' && JSX_DRAG_ATTRS.has(node.name?.name) && node.value?.type === 'JSXExpressionContainer') {
            const expr = node.value.expression, fn = unwrapFn(expr);
            if (fn) checkHandler(fn, node.name.name, [...scopes], report);
            else if (expr?.type === 'Identifier' && !HANDLERS.has(expr.name)) {
              const res = resolveSym(rel, expr.name, scopes);
              if (res?.kind === 'fn') checkHandler(res.node, node.name.name, res.scopes, report);
            }
          }
          if (isToolbar(rel, node, scopes) && !rel.endsWith('Operations.tsx') && condStack.length === 0) report(node, TOOLBAR_HINT);
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
