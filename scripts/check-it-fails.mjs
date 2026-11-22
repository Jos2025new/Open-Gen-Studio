/**
 * Ensures every Vitest `it.fails` / `test.fails` (including chains like `it.fails.each`,
 * `it.concurrent.fails`, `it['fails']`, and import/variable aliases) in `tests/` has its own
 * explicit `// reproduce: ...` AST comment within the 3 preceding lines explaining what bug
 * it reproduces, so undocumented expected-failures do not accumulate as silent noise.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseSync } from 'rolldown/utils';

const REPRODUCE_RE = /^\s*reproduce:\s*\S/;
const SCOPED_TYPES = new Set([
  'BlockStatement',
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'CatchClause',
]);

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

function getLineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function lineOf(lineStarts, offset) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid] <= offset) lo = mid + 1;
    else hi = mid - 1;
  }
  return lo;
}

function getMemberPropName(node) {
  if (!node.computed && node.property?.type === 'Identifier') return node.property.name;
  if (node.computed && node.property?.type === 'Literal' && typeof node.property.value === 'string') {
    return node.property.value;
  }
  if (
    node.computed
    && node.property?.type === 'TemplateLiteral'
    && node.property.expressions.length === 0
    && node.property.quasis.length === 1
  ) {
    return node.property.quasis[0].value.cooked ?? null;
  }
  return null;
}

function unwrapChain(expr) {
  const props = [];
  let cur = expr;
  while (cur) {
    if (cur.type === 'MemberExpression') {
      props.unshift(getMemberPropName(cur));
      cur = cur.object;
    } else if (cur.type === 'CallExpression') {
      cur = cur.callee;
    } else if (cur.type === 'TaggedTemplateExpression') {
      cur = cur.tag;
    } else if (
      cur.type === 'ChainExpression'
      || cur.type === 'TSAsExpression'
      || cur.type === 'TSTypeAssertion'
      || cur.type === 'TSNonNullExpression'
      || cur.type === 'ParenthesizedExpression'
    ) {
      cur = cur.expression;
    } else {
      break;
    }
  }
  return { base: cur, props };
}

function classifyExpr(expr, scope) {
  const { base, props } = unwrapChain(expr);
  if (base?.type !== 'Identifier') return null;
  let kind = scope.get(base.name);
  let rest = props;
  if (kind === 'vitest-ns') {
    if (rest[0] !== 'it' && rest[0] !== 'test') return null;
    kind = 'test';
    rest = rest.slice(1);
  }
  if (kind === 'fails') return 'fails';
  if (kind === 'test') {
    if (rest.includes('fails')) return 'fails';
    if (rest.length === 0) return 'test';
  }
  return null;
}

function unbindPattern(pattern, scope) {
  if (!pattern || typeof pattern !== 'object') return;
  if (pattern.type === 'Identifier') {
    scope.delete(pattern.name);
  } else if (pattern.type === 'ObjectPattern') {
    for (const p of pattern.properties ?? []) {
      unbindPattern(p.type === 'Property' ? p.value : p.argument, scope);
    }
  } else if (pattern.type === 'ArrayPattern') {
    for (const el of pattern.elements ?? []) unbindPattern(el, scope);
  } else if (pattern.type === 'RestElement') {
    unbindPattern(pattern.argument, scope);
  } else if (pattern.type === 'AssignmentPattern') {
    unbindPattern(pattern.left, scope);
  }
}

function bindDeclarator(node, scope) {
  const initKind = node.init ? classifyExpr(node.init, scope) : null;
  if (node.id?.type === 'Identifier') {
    if (initKind) scope.set(node.id.name, initKind);
    else scope.delete(node.id.name);
    return;
  }
  if (node.id?.type === 'ObjectPattern' && (initKind === 'test' || initKind === 'vitest-ns')) {
    for (const prop of node.id.properties ?? []) {
      if (prop.type === 'Property' && prop.value?.type === 'Identifier') {
        const key = !prop.computed && prop.key?.type === 'Identifier'
          ? prop.key.name
          : prop.key?.type === 'Literal' && typeof prop.key.value === 'string'
            ? prop.key.value
            : null;
        if (initKind === 'test' && key === 'fails') scope.set(prop.value.name, 'fails');
        else if (initKind === 'vitest-ns' && (key === 'it' || key === 'test')) scope.set(prop.value.name, 'test');
        else scope.delete(prop.value.name);
      } else {
        unbindPattern(prop.type === 'Property' ? prop.value : prop.argument, scope);
      }
    }
    return;
  }
  unbindPattern(node.id, scope);
}

function walk(node, scope, onCall) {
  if (!node || typeof node.type !== 'string') return;

  if (node.type === 'ImportDeclaration' && node.source?.value === 'vitest') {
    for (const spec of node.specifiers ?? []) {
      if (spec.type === 'ImportSpecifier') {
        const imported = spec.imported?.name ?? spec.imported?.value;
        if (imported === 'it' || imported === 'test') scope.set(spec.local.name, 'test');
      } else if (spec.type === 'ImportNamespaceSpecifier') {
        scope.set(spec.local.name, 'vitest-ns');
      }
    }
    return;
  }

  if (node.type === 'CallExpression' || node.type === 'TaggedTemplateExpression') {
    onCall(node, scope);
  }

  let childScope = scope;
  if (SCOPED_TYPES.has(node.type)) {
    childScope = new Map(scope);
    if (node.type === 'FunctionDeclaration' && node.id?.type === 'Identifier') {
      scope.delete(node.id.name);
      childScope.delete(node.id.name);
    }
    for (const p of node.params ?? []) unbindPattern(p, childScope);
    if (node.type === 'CatchClause') unbindPattern(node.param, childScope);
  }

  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end') continue;
    const child = node[key];
    if (Array.isArray(child)) child.forEach((c) => walk(c, childScope, onCall));
    else if (child && typeof child === 'object') walk(child, childScope, onCall);
  }

  if (node.type === 'VariableDeclarator') {
    bindDeclarator(node, scope);
  } else if (node.type === 'AssignmentExpression' && node.operator === '=' && node.left?.type === 'Identifier') {
    const kind = classifyExpr(node.right, scope);
    if (kind) scope.set(node.left.name, kind);
    else scope.delete(node.left.name);
  }
}

function hasOnlyWhitespaceAndComments(text, comments, fromOffset, toOffset) {
  let cursor = fromOffset;
  for (const c of comments) {
    if (c.end <= cursor) continue;
    if (c.start >= toOffset) break;
    if (/\S/.test(text.slice(cursor, c.start))) return false;
    cursor = c.end;
  }
  return !/\S/.test(text.slice(cursor, toOffset));
}

function isFailsInvocation(node, scope) {
  const target = node.type === 'CallExpression' ? node.callee : node.tag;
  if (!target) return null;
  if (classifyExpr(target, scope) !== 'fails') return null;
  // Avoid double-reporting outer calls like `it.fails.each([1])('x', fn)` when inner `it.fails.each([1])` already matched.
  let cur = target;
  while (cur) {
    if (cur.type === 'MemberExpression') cur = cur.object;
    else if (
      cur.type === 'ChainExpression'
      || cur.type === 'TSAsExpression'
      || cur.type === 'TSTypeAssertion'
      || cur.type === 'TSNonNullExpression'
      || cur.type === 'ParenthesizedExpression'
    ) cur = cur.expression;
    else break;
  }
  if (cur?.type === 'CallExpression' || cur?.type === 'TaggedTemplateExpression') {
    const inner = cur.type === 'CallExpression' ? cur.callee : cur.tag;
    if (classifyExpr(inner, scope) === 'fails') return null;
  }
  return target;
}

/** Problems under `root`, as `file:line: message` strings. */
export function check(root = '.') {
  const errors = [];
  for (const file of walkTests(join(root, 'tests')).sort()) {
    const rel = relative(root, file).split('\\').join('/');
    const text = readFileSync(file, 'utf8');
    if (!text.includes('fails')) continue;
    const { program, comments: rawComments = [], errors: broken } = parseSync(file, text);
    if (broken.length) {
      errors.push(`${rel}:1: could not be parsed, so its it.fails comments could not be checked (${broken[0].message}).`);
      continue;
    }
    const comments = [...rawComments].sort((a, b) => a.start - b.start);
    const lineStarts = getLineStarts(text);
    const seenOffsets = new Set();
    const usedComments = new Set();
    const rootScope = new Map([['it', 'test'], ['test', 'test']]);

    walk(program, rootScope, (node, scope) => {
      const target = isFailsInvocation(node, scope);
      if (!target || seenOffsets.has(target.start)) return;
      seenOffsets.add(target.start);
      const line = lineOf(lineStarts, target.start);
      const match = comments.findLast((c) => (
        c.type === 'Line'
        && c.end <= target.start
        && !usedComments.has(c.start)
        && REPRODUCE_RE.test(c.value)
        && lineOf(lineStarts, c.start) >= line - 3
        && lineOf(lineStarts, c.start) <= line - 1
        && hasOnlyWhitespaceAndComments(text, comments, c.end, target.start)
      ));
      if (match) {
        usedComments.add(match.start);
      } else {
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
