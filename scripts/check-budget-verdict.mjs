/**
 * Single spending-limit rule (dinero7 Parte 3a): `overLimit` and `budgetVerdict` are defined in
 * `src/engine/budget.ts` and may only be imported by `src/engine/credit.ts` and the UI adapter
 * `src/components/ui/useBudgetVerdict.ts`. Engine callers use `budgetProblem` / `assertWithinLimit`;
 * UI components read a verdict from the adapter instead of recalculating the limit rule.
 */
import { posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scan } from './ast-scan.mjs';

const ALLOWED = new Set([
  'src/engine/budget.ts',
  'src/engine/credit.ts',
  'src/components/ui/useBudgetVerdict.ts',
]);
const RESTRICTED = new Set(['overLimit', 'budgetVerdict']);
const HINT = 'engine callers should use `budgetProblem` or `assertWithinLimit` from `src/engine/budget.ts`; UI components should read a verdict via `useBudgetVerdict` / `readBudgetVerdict` (`src/components/ui/useBudgetVerdict.ts`).';

function resolvesToBudget(fromRel, spec) {
  if (typeof spec !== 'string' || !spec.startsWith('.')) return false;
  const target = posix.join(posix.dirname(fromRel), spec).replace(/\.[cm]?[jt]sx?$/, '');
  return target === 'src/engine/budget';
}

function keyName(node) {
  if (!node) return undefined;
  return node.type === 'Identifier' ? node.name : node.type === 'Literal' ? String(node.value) : undefined;
}

/** Problems under `root`, as `file:line: message` strings. */
export function check(root = '.') {
  return scan(root, {
    allowed: ALLOWED,
    what: 'budget verdict imports',
    rules: ({ rel, program }) => {
      const namespaces = new Set();
      for (const d of program.body) {
        if (d.type === 'ImportDeclaration' && resolvesToBudget(rel, d.source?.value)) {
          for (const sp of d.specifiers ?? []) {
            if (sp.type === 'ImportNamespaceSpecifier' && sp.local?.name) namespaces.add(sp.local.name);
          }
        }
      }
      const dynamicBudget = (node) =>
        node?.type === 'ImportExpression' && resolvesToBudget(rel, node.source?.value)
        || (node?.type === 'AwaitExpression' && node.argument?.type === 'ImportExpression' && resolvesToBudget(rel, node.argument.source?.value));
      const isBudgetNamespace = (node) =>
        (node?.type === 'Identifier' && namespaces.has(node.name)) || dynamicBudget(node);
      const checkPattern = (pattern, init, report, verb) => {
        if (pattern?.type !== 'ObjectPattern' || !isBudgetNamespace(init)) return;
        for (const p of pattern.properties ?? []) {
          const name = p.type === 'Property' ? keyName(p.key) : undefined;
          if (RESTRICTED.has(name)) {
            report(p, `${verb} \`${name}\` outside budget.ts, credit.ts and useBudgetVerdict.ts. ${HINT}`);
          }
        }
      };

      return {
        enter: (node, report) => {
          if ((node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration') && resolvesToBudget(rel, node.source?.value)) {
            if (node.importKind === 'type' || node.exportKind === 'type') return;
            for (const sp of node.specifiers ?? []) {
              if (sp.importKind === 'type' || sp.exportKind === 'type') continue;
              const imported = keyName(sp.imported ?? sp.local);
              if (RESTRICTED.has(imported)) {
                report(sp, `imports/exports \`${imported}\` outside budget.ts, credit.ts and useBudgetVerdict.ts. ${HINT}`);
              }
            }
          }
          if (node.type === 'ExportAllDeclaration' && resolvesToBudget(rel, node.source?.value)) {
            report(node, `re-exports all of budget.ts (including \`overLimit\` / \`budgetVerdict\`). ${HINT}`);
          }
          if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && isBudgetNamespace(node.init)) {
            namespaces.add(node.id.name);
          }
          if (node.type === 'MemberExpression') {
            const prop = keyName(node.property);
            if (!RESTRICTED.has(prop)) return;
            if (isBudgetNamespace(node.object)) {
              report(node, `reads \`${prop}\` from budget.ts outside its allowed boundary. ${HINT}`);
            }
          }
          if (node.type === 'VariableDeclarator') {
            checkPattern(node.id, node.init, report, dynamicBudget(node.init) ? 'dynamically imports' : 'destructures');
          }
          if (node.type === 'AssignmentExpression') {
            checkPattern(node.left, node.right, report, dynamicBudget(node.right) ? 'dynamically imports' : 'destructures');
          }
        },
      };
    },
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const errors = check('.');
  if (errors.length) {
    console.error(`check-budget-verdict: ${errors.length} disallowed import(s)\n${errors.map((e) => `  ${e}`).join('\n')}`);
    process.exit(1);
  }
  console.log('check-budget-verdict: overLimit/budgetVerdict stay within budget.ts, credit.ts and useBudgetVerdict.ts.');
}
