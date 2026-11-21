/**
 * Permanent drag-perf guard:
 * 1. In-progress drag handlers (`onNodeDrag`, `onSelectionDrag`, and the `dragging: true` path of `onNodesChange` or
 *    unconditional position handlers) must never reach `editPresentation`, `setGraph`, `patchSession`, `applyEdit`,
 *    `moveGroup`, `recordGraph`, `travelGraph`, or serialization (`persistState`, `JSON.stringify`).
 * 2. Card components must not mount `<NodeToolbar` unconditionally (each mounted `NodeToolbar` filters all nodes).
 */
import { posix } from 'node:path';
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
  'JSON.stringify',
]);

const TRACKED_SYMBOLS = new Set([...FORBIDDEN_CALLS, 'trailCuts', 'NodeToolbar']);
const HANDLER_NAMES = new Set(['onNodesChange', 'onNodeDrag', 'onSelectionDrag', 'applyDragChanges']);
const JSX_DRAG_ATTRS = new Set(['onNodesChange', 'onNodeDrag', 'onSelectionDrag']);

const DRAG_HINT = 'No escribas el grafo, historial ni serialices durante el arrastre en curso; usa estado local y aplica editPresentation al soltar (dragging: false).';
const CUT_HINT = 'No recorras todo el trazo de la tijera en cada pointermove; prueba solo el segmento [anterior, actual] y acumula los cortes.';
const TOOLBAR_HINT = 'NodeToolbar montado incondicionalmente; móntalo solo cuando la tarjeta esté seleccionada.';

function rawMemberName(node) {
  if (!node) return '';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression') {
    const obj = rawMemberName(node.object);
    const prop = node.property?.type === 'Identifier' ? node.property.name : node.property?.value ?? '';
    return obj && prop ? `${obj}.${prop}` : prop;
  }
  return '';
}

function calleeName(callee) {
  if (!callee) return '';
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression') {
    const prop = callee.property?.type === 'Identifier' ? callee.property.name : callee.property?.value ?? '';
    if ((prop === 'call' || prop === 'apply') && callee.object) {
      return calleeName(callee.object);
    }
    return rawMemberName(callee);
  }
  return '';
}

function unwrapFn(node) {
  if (!node) return null;
  if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression' || node.type === 'FunctionDeclaration') {
    return node;
  }
  if (node.type === 'CallExpression') {
    const cname = calleeName(node.callee);
    if ((cname === 'useCallback' || cname === 'useMemo' || cname.endsWith('.useCallback') || cname.endsWith('.useMemo')) && node.arguments?.[0]) {
      return unwrapFn(node.arguments[0]);
    }
  }
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

function isDraggingMember(node, draggingTrueVars = new Set()) {
  if (!node) return false;
  if (node.type === 'MemberExpression' && node.property?.name === 'dragging') return true;
  if (node.type === 'Identifier' && draggingTrueVars.has(node.name)) return true;
  return false;
}

function isDraggingTrueTest(test, draggingTrueVars = new Set(), draggingFalseVars = new Set()) {
  if (!test) return false;
  if (test.type === 'LogicalExpression' && test.operator === '&&') {
    return isDraggingTrueTest(test.left, draggingTrueVars, draggingFalseVars) ||
           isDraggingTrueTest(test.right, draggingTrueVars, draggingFalseVars);
  }
  if (isDraggingMember(test, draggingTrueVars)) return true;
  if (test.type === 'UnaryExpression' && test.operator === '!' && test.argument?.type === 'Identifier' && draggingFalseVars.has(test.argument.name)) {
    return true;
  }
  if (test.type === 'BinaryExpression') {
    const { left, right, operator } = test;
    if ((operator === '===' || operator === '==') &&
        ((isDraggingMember(left, draggingTrueVars) && right?.type === 'Literal' && right.value === true) ||
         (isDraggingMember(right, draggingTrueVars) && left?.type === 'Literal' && left.value === true))) return true;
    if ((operator === '!==' || operator === '!=') &&
        ((isDraggingMember(left, draggingTrueVars) && right?.type === 'Literal' && right.value === false) ||
         (isDraggingMember(right, draggingTrueVars) && left?.type === 'Literal' && left.value === false))) return true;
  }
  return false;
}

function isDraggingFalseTest(test, draggingTrueVars = new Set(), draggingFalseVars = new Set()) {
  if (!test) return false;
  if (test.type === 'LogicalExpression' && test.operator === '&&') {
    return isDraggingFalseTest(test.left, draggingTrueVars, draggingFalseVars) ||
           isDraggingFalseTest(test.right, draggingTrueVars, draggingFalseVars);
  }
  if (test.type === 'Identifier' && draggingFalseVars.has(test.name)) return true;
  if (test.type === 'UnaryExpression' && test.operator === '!') {
    return isDraggingMember(test.argument, draggingTrueVars) ||
           isDraggingTrueTest(test.argument, draggingTrueVars, draggingFalseVars);
  }
  if (test.type === 'BinaryExpression') {
    const { left, right, operator } = test;
    if ((operator === '===' || operator === '==') &&
        ((isDraggingMember(left, draggingTrueVars) && right?.type === 'Literal' && right.value === false) ||
         (isDraggingMember(right, draggingTrueVars) && left?.type === 'Literal' && left.value === false))) return true;
    if ((operator === '!==' || operator === '!=') &&
        ((isDraggingMember(left, draggingTrueVars) && right?.type === 'Literal' && right.value === true) ||
         (isDraggingMember(right, draggingTrueVars) && left?.type === 'Literal' && left.value === true))) return true;
  }
  return false;
}

function collectDraggingAliases(fnNode) {
  const draggingTrueVars = new Set();
  const draggingFalseVars = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    walkSubtree(fnNode, (n) => {
      if (n.type === 'ObjectPattern') {
        for (const prop of n.properties ?? []) {
          const key = prop.key?.type === 'Identifier' ? prop.key.name : prop.key?.value;
          const valNode = prop.value?.type === 'AssignmentPattern' ? prop.value.left : prop.value;
          const val = valNode?.type === 'Identifier' ? valNode.name : null;
          if (key === 'dragging' && val && !draggingTrueVars.has(val)) {
            draggingTrueVars.add(val);
            changed = true;
          }
        }
      }
      if (n.type === 'VariableDeclarator' && n.id?.type === 'Identifier' && n.init) {
        const name = n.id.name;
        if (!draggingTrueVars.has(name) && isDraggingTrueTest(n.init, draggingTrueVars, draggingFalseVars)) {
          draggingTrueVars.add(name);
          changed = true;
        } else if (!draggingFalseVars.has(name) && isDraggingFalseTest(n.init, draggingTrueVars, draggingFalseVars)) {
          draggingFalseVars.add(name);
          changed = true;
        }
      }
    });
  }
  return { draggingTrueVars, draggingFalseVars };
}

function alwaysExits(stmt) {
  if (!stmt) return false;
  if (stmt.type === 'ReturnStatement' || stmt.type === 'ContinueStatement' || stmt.type === 'ThrowStatement' || stmt.type === 'BreakStatement') return true;
  if (stmt.type === 'BlockStatement' && stmt.body.length) return alwaysExits(stmt.body.at(-1));
  return false;
}

function checksDraggingAnywhere(fnNode, draggingTrueVars, draggingFalseVars) {
  if (draggingTrueVars.size > 0 || draggingFalseVars.size > 0) return true;
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

function indexModule(rel, program) {
  const mod = {
    rel,
    program,
    imports: new Map(),
    namespaceImports: new Map(),
    reexports: new Map(),
    starReexports: [],
    localExports: new Map(),
    aliases: new Map(),
    fnNodes: new Map(),
  };
  const addFn = (name, fnNode) => {
    if (!name || !fnNode) return;
    const list = mod.fnNodes.get(name) ?? [];
    list.push(fnNode);
    mod.fnNodes.set(name, list);
  };

  for (const stmt of program.body ?? []) {
    if (stmt.type === 'ImportDeclaration') {
      const source = stmt.source?.value;
      if (!source) continue;
      for (const spec of stmt.specifiers ?? []) {
        if (spec.type === 'ImportSpecifier') {
          const imported = spec.imported?.type === 'Identifier' ? spec.imported.name : spec.imported?.value;
          if (imported && spec.local?.name) mod.imports.set(spec.local.name, { source, imported });
        } else if (spec.type === 'ImportDefaultSpecifier' && spec.local?.name) {
          mod.imports.set(spec.local.name, { source, imported: 'default' });
        } else if (spec.type === 'ImportNamespaceSpecifier' && spec.local?.name) {
          mod.namespaceImports.set(spec.local.name, source);
        }
      }
    } else if (stmt.type === 'ExportNamedDeclaration') {
      const source = stmt.source?.value;
      for (const spec of stmt.specifiers ?? []) {
        const local = spec.local?.type === 'Identifier' ? spec.local.name : spec.local?.value;
        const exported = spec.exported?.type === 'Identifier' ? spec.exported.name : spec.exported?.value;
        if (!local || !exported) continue;
        if (source) mod.reexports.set(exported, { source, imported: local });
        else mod.localExports.set(exported, local);
      }
      if (stmt.declaration) {
        const decl = stmt.declaration;
        if (decl.type === 'FunctionDeclaration' && decl.id?.name) {
          mod.localExports.set(decl.id.name, decl.id.name);
        } else if (decl.type === 'VariableDeclaration') {
          for (const d of decl.declarations ?? []) {
            if (d.id?.type === 'Identifier') mod.localExports.set(d.id.name, d.id.name);
          }
        }
      }
    } else if (stmt.type === 'ExportDefaultDeclaration') {
      const decl = stmt.declaration;
      const fn = unwrapFn(decl);
      if (fn) {
        const name = decl.id?.name ?? '__default__';
        addFn(name, fn);
        mod.localExports.set('default', name);
      } else if (decl?.type === 'Identifier') {
        mod.localExports.set('default', decl.name);
      }
    } else if (stmt.type === 'ExportAllDeclaration' && stmt.source?.value) {
      mod.starReexports.push(stmt.source.value);
    }
  }

  walkSubtree(program, (n) => {
    if (n.type === 'FunctionDeclaration' && n.id?.name) {
      addFn(n.id.name, n);
    } else if (n.type === 'VariableDeclarator' && n.init) {
      if (n.id?.type === 'Identifier') {
        const idName = n.id.name;
        const fn = unwrapFn(n.init);
        if (fn) {
          addFn(idName, fn);
        } else if (n.init.type === 'Identifier') {
          mod.aliases.set(idName, n.init.name);
        } else if (n.init.type === 'MemberExpression') {
          const full = rawMemberName(n.init);
          if (full) mod.aliases.set(idName, full);
        } else if (n.init.type === 'ObjectExpression') {
          for (const prop of n.init.properties ?? []) {
            const key = prop.key?.type === 'Identifier' ? prop.key.name : prop.key?.value;
            if (!key || !prop.value) continue;
            const pFn = unwrapFn(prop.value);
            if (pFn) addFn(`${idName}.${key}`, pFn);
            else if (prop.value.type === 'Identifier') mod.aliases.set(`${idName}.${key}`, prop.value.name);
            else if (prop.value.type === 'MemberExpression') {
              const full = rawMemberName(prop.value);
              if (full) mod.aliases.set(`${idName}.${key}`, full);
            }
          }
        }
      } else if (n.id?.type === 'ObjectPattern') {
        const initName = n.init.type === 'Identifier' ? n.init.name : rawMemberName(n.init);
        for (const prop of n.id.properties ?? []) {
          const key = prop.key?.type === 'Identifier' ? prop.key.name : prop.key?.value;
          const valNode = prop.value?.type === 'AssignmentPattern' ? prop.value.left : prop.value;
          const val = valNode?.type === 'Identifier' ? valNode.name : null;
          if (key && val) {
            mod.aliases.set(val, initName ? `${initName}.${key}` : key);
          }
        }
      }
    }
  });

  return mod;
}

function resolveRelativePath(fromRel, spec, mods) {
  if (!spec || !spec.startsWith('.')) return null;
  const clean = spec.split('?')[0].replace(/\.(?:[cm]?[jt]sx?)$/, '');
  const base = posix.normalize(posix.join(posix.dirname(fromRel), clean));
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (mods.has(cand)) return cand;
  }
  return null;
}

/** Problems under `root`, as `file:line — message` strings. */
export function check(root = '.') {
  const mods = new Map();
  scan(root, {
    allowed: new Set(),
    what: 'node drag performance guards',
    rules: ({ rel, program }) => {
      mods.set(rel, indexModule(rel, program));
      return { enter() {} };
    },
  });

  function resolveImportedSymbol(fromRel, source, imported, seen) {
    const targetRel = resolveRelativePath(fromRel, source, mods);
    if (targetRel) {
      const targetMod = mods.get(targetRel);
      if (targetMod.reexports.has(imported)) {
        const re = targetMod.reexports.get(imported);
        const sub = resolveImportedSymbol(targetRel, re.source, re.imported, seen);
        if (sub) return sub;
      }
      if (targetMod.localExports.has(imported)) {
        const localName = targetMod.localExports.get(imported);
        const sub = resolveSymbol(targetRel, localName, seen);
        if (sub) return sub;
      }
      if (targetMod.fnNodes.has(imported)) {
        return { kind: 'fn', rel: targetRel, name: imported, nodes: targetMod.fnNodes.get(imported) };
      }
      for (const starSource of targetMod.starReexports) {
        const sub = resolveImportedSymbol(targetRel, starSource, imported, seen);
        if (sub) return sub;
      }
    }
    if (TRACKED_SYMBOLS.has(imported)) return { kind: 'tracked', name: imported };
    return null;
  }

  function resolveSymbol(rel, name, seen = new Set()) {
    if (!name) return null;
    if (TRACKED_SYMBOLS.has(name)) return { kind: 'tracked', name };
    const key = `${rel}::${name}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const mod = mods.get(rel);
    if (!mod) return TRACKED_SYMBOLS.has(name) ? { kind: 'tracked', name } : null;

    if (mod.aliases.has(name)) {
      const aliased = resolveSymbol(rel, mod.aliases.get(name), seen);
      if (aliased) return aliased;
    }
    if (mod.imports.has(name)) {
      const { source, imported } = mod.imports.get(name);
      const imp = resolveImportedSymbol(rel, source, imported, seen);
      if (imp) return imp;
    }
    if (mod.fnNodes.has(name)) {
      return { kind: 'fn', rel, name, nodes: mod.fnNodes.get(name) };
    }
    if (name.includes('.')) {
      const parts = name.split('.');
      const obj = parts[0];
      const prop = parts.slice(1).join('.');
      if (mod.namespaceImports.has(obj)) {
        const imp = resolveImportedSymbol(rel, mod.namespaceImports.get(obj), prop, seen);
        if (imp) return imp;
      }
      if (mod.aliases.has(obj)) {
        const resolvedObj = mod.aliases.get(obj);
        const sub = resolveSymbol(rel, `${resolvedObj}.${prop}`, seen);
        if (sub) return sub;
      }
      const last = parts.at(-1);
      if (FORBIDDEN_CALLS.has(last) && obj !== 'JSON') {
        return { kind: 'tracked', name: last };
      }
    }
    return null;
  }

  function callForbiddenTarget(rel, callNode, seen = new Set()) {
    if (callNode?.type !== 'CallExpression') return null;
    const cname = calleeName(callNode.callee);
    if (!cname) return null;
    const resolved = resolveSymbol(rel, cname);
    if (!resolved) return null;
    if (resolved.kind === 'tracked' && FORBIDDEN_CALLS.has(resolved.name)) {
      return cname !== resolved.name ? `${cname} -> ${resolved.name}` : cname;
    }
    if (resolved.kind === 'fn') {
      const fnKey = `${resolved.rel}::${resolved.name}`;
      if (seen.has(fnKey)) return null;
      seen.add(fnKey);
      for (const fnNode of resolved.nodes) {
        let hit = null;
        walkSubtree(fnNode.body, (n) => {
          if (hit) return false;
          if (n.type === 'CallExpression') {
            const sub = callForbiddenTarget(resolved.rel, n, new Set(seen));
            if (sub) {
              hit = `${cname} -> ${sub}`;
              return false;
            }
          }
        });
        if (hit) return hit;
      }
    }
    return null;
  }

  function isNodeToolbarJsx(rel, node) {
    if (node.type !== 'JSXElement') return false;
    const nameNode = node.openingElement?.name;
    let tagName = '';
    if (nameNode?.type === 'JSXIdentifier') tagName = nameNode.name;
    else if (nameNode?.type === 'JSXMemberExpression') {
      tagName = `${nameNode.object?.name ?? ''}.${nameNode.property?.name ?? ''}`;
    }
    if (!tagName) return false;
    if (tagName === 'NodeToolbar' || tagName.endsWith('.NodeToolbar')) return true;
    const resolved = resolveSymbol(rel, tagName);
    return resolved?.kind === 'tracked' && resolved.name === 'NodeToolbar';
  }

  const raw = scan(root, {
    allowed: new Set(),
    what: 'node drag performance guards',
    rules: ({ rel }) => {
      const flagCallsInSubtree = (rootNode, report) => {
        walkSubtree(rootNode, (n) => {
          if (n.type !== 'CallExpression') return;
          const hit = callForbiddenTarget(rel, n);
          if (hit) {
            const msg = hit.includes(' -> ')
              ? `Escritura/serialización durante el arrastre vía ${hit}. ${DRAG_HINT}`
              : `Escritura/serialización durante el arrastre (${hit}). ${DRAG_HINT}`;
            report(n, msg);
          }
        });
      };

      const checkDragHandler = (fnNode, name, report) => {
        if (!fnNode?.body) return;
        if (name === 'onNodeDrag' || name === 'onSelectionDrag') {
          flagCallsInSubtree(fnNode.body, report);
          return;
        }
        const { draggingTrueVars, draggingFalseVars } = collectDraggingAliases(fnNode);
        const walkDraggingPaths = (node) => {
          if (!node || typeof node.type !== 'string') return;
          if (node.type === 'BlockStatement' && Array.isArray(node.body)) {
            for (let i = 0; i < node.body.length; i++) {
              const stmt = node.body[i];
              if (stmt.type === 'IfStatement') {
                if (isDraggingTrueTest(stmt.test, draggingTrueVars, draggingFalseVars)) {
                  flagCallsInSubtree(stmt.consequent, report);
                  if (stmt.alternate) walkDraggingPaths(stmt.alternate);
                  continue;
                }
                if (isDraggingFalseTest(stmt.test, draggingTrueVars, draggingFalseVars)) {
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
            if (isDraggingTrueTest(node.test, draggingTrueVars, draggingFalseVars)) {
              flagCallsInSubtree(node.consequent, report);
              if (node.alternate) walkDraggingPaths(node.alternate);
              return;
            }
            if (isDraggingFalseTest(node.test, draggingTrueVars, draggingFalseVars)) {
              walkDraggingPaths(node.consequent);
              if (node.alternate) flagCallsInSubtree(node.alternate, report);
              return;
            }
          }
          if (node.type === 'ConditionalExpression') {
            if (isDraggingTrueTest(node.test, draggingTrueVars, draggingFalseVars)) { flagCallsInSubtree(node.consequent, report); return; }
            if (isDraggingFalseTest(node.test, draggingTrueVars, draggingFalseVars)) { flagCallsInSubtree(node.alternate, report); return; }
          }
          if (node.type === 'LogicalExpression') {
            if (node.operator === '&&' && isDraggingTrueTest(node.left, draggingTrueVars, draggingFalseVars)) { flagCallsInSubtree(node.right, report); return; }
            if (node.operator === '||' && isDraggingFalseTest(node.left, draggingTrueVars, draggingFalseVars)) { flagCallsInSubtree(node.right, report); return; }
          }
          for (const k of Object.keys(node)) {
            const child = node[k];
            if (Array.isArray(child)) child.forEach(walkDraggingPaths);
            else if (child && typeof child === 'object') walkDraggingPaths(child);
          }
        };
        walkDraggingPaths(fnNode.body);
        if (!checksDraggingAnywhere(fnNode.body, draggingTrueVars, draggingFalseVars)) {
          let mentionsPosition = false;
          walkSubtree(fnNode.body, (n) => {
            if (n.type === 'Literal' && n.value === 'position') mentionsPosition = true;
          });
          if (mentionsPosition) {
            walkSubtree(fnNode.body, (n) => {
              if (n.type !== 'CallExpression') return;
              const hit = callForbiddenTarget(rel, n);
              if (hit && hit !== 'ungroup' && hit !== 'deleteNodes') {
                report(n, `Commit de posición en onNodesChange sin distinguir \`dragging: false\` (${hit}). ${DRAG_HINT}`);
              }
            });
          }
        }
      };

      const cutMoveRescansTrail = (fnNode, report) => {
        const TRAIL_NAMES = new Set(['trail', 'curTrail', 'next', 'trailRef']);
        const ITER_METHODS = new Set(['forEach', 'map', 'filter', 'some', 'every', 'reduce', 'find']);
        const referencesTrail = (node) => {
          let hit = false;
          walkSubtree(node, (n) => {
            if (n.type === 'Identifier' && TRAIL_NAMES.has(n.name)) { hit = true; return false; }
          });
          return hit;
        };
        const hasTrailScan = (curRel, node, seen = new Set()) => {
          let hit = null;
          walkSubtree(node, (n) => {
            if (hit) return false;
            if (n.type === 'CallExpression') {
              const cname = calleeName(n.callee);
              if (cname) {
                const resolved = resolveSymbol(curRel, cname);
                if (resolved?.kind === 'tracked' && resolved.name === 'trailCuts') {
                  hit = n;
                  return false;
                }
                if (resolved?.kind === 'fn') {
                  const fnKey = `${resolved.rel}::${resolved.name}`;
                  if (!seen.has(fnKey)) {
                    seen.add(fnKey);
                    for (const targetFn of resolved.nodes) {
                      const sub = hasTrailScan(resolved.rel, targetFn.body, seen);
                      if (sub) { hit = n; return false; }
                    }
                  }
                }
              }
            }
            if ((n.type === 'ForStatement' || n.type === 'ForOfStatement' || n.type === 'WhileStatement' || n.type === 'DoWhileStatement') &&
                referencesTrail(n.test ?? n.right ?? n.init)) {
              hit = n; return false;
            }
            if (n.type === 'CallExpression' && n.callee?.type === 'MemberExpression' &&
                ITER_METHODS.has(n.callee.property?.name) && referencesTrail(n.callee.object)) {
              hit = n; return false;
            }
          });
          return hit;
        };
        const bad = hasTrailScan(rel, fnNode.body);
        if (bad) report(bad, `La tijera recorre todo el trazo en pointermove. ${CUT_HINT}`);
      };

      const fnStack = [];
      const condStack = [];
      let cutToolDepth = 0;
      const isCutToolFn = (node) =>
        (node.type === 'FunctionDeclaration' && node.id?.name === 'useCutTool');

      return {
        enter: (node, report) => {
          if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
            fnStack.push(node);
            if (isCutToolFn(node)) cutToolDepth++;
          }
          if (node.type === 'ConditionalExpression' || node.type === 'LogicalExpression') {
            condStack.push(node);
          }
          if (cutToolDepth > 0 && node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' &&
              (node.id.name === 'move' || node.id.name === 'onPointerMove') && node.init) {
            const fn = unwrapFn(node.init);
            if (fn) cutMoveRescansTrail(fn, report);
          }
          if (cutToolDepth > 0 && node.type === 'FunctionDeclaration' &&
              (node.id?.name === 'move' || node.id?.name === 'onPointerMove')) {
            cutMoveRescansTrail(node, report);
          }
          // Rule 1: Drag handlers (`onNodesChange`, `onNodeDrag`, `onSelectionDrag`, `applyDragChanges`).
          if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' &&
              HANDLER_NAMES.has(node.id.name) && node.init) {
            const fn = unwrapFn(node.init);
            if (fn) checkDragHandler(fn, node.id.name, report);
          }
          if (node.type === 'FunctionDeclaration' && node.id?.name && HANDLER_NAMES.has(node.id.name)) {
            checkDragHandler(node, node.id.name, report);
          }
          if (node.type === 'JSXAttribute' && JSX_DRAG_ATTRS.has(node.name?.name) &&
              node.value?.type === 'JSXExpressionContainer') {
            const attrName = node.name.name;
            const expr = node.value.expression;
            const fn = unwrapFn(expr);
            if (fn) {
              checkDragHandler(fn, attrName, report);
            } else if (expr?.type === 'Identifier' && !HANDLER_NAMES.has(expr.name)) {
              const resolved = resolveSymbol(rel, expr.name);
              if (resolved?.kind === 'fn') {
                for (const targetFn of resolved.nodes) checkDragHandler(targetFn, attrName, report);
              }
            }
          }
          // Rule 2: `<NodeToolbar` must be conditionally mounted (not always mounted with `isVisible={...}`).
          if (isNodeToolbarJsx(rel, node) && !rel.endsWith('Operations.tsx')) {
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
            if (isCutToolFn(node)) cutToolDepth--;
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
