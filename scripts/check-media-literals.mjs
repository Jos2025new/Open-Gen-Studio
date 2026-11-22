/**
 * Closed-list discipline for media kinds: any array or `z.enum` listing 2+ of `'image'`, `'video'`, `'audio'`, `'model3d'`
 * (or 1+ of them paired with `'agent'`, `'llm'`, `'text'`) outside `src/engine/types.ts` fails.
 * Deliberate subsets (e.g. `['image', 'video']`) are named once in `src/engine/types.ts` and imported everywhere else.
 * Text-parsing word lists and HTML/SVG tag lists are explicitly exempted by binding name with their reason below.
 */
import { pathToFileURL } from 'node:url';
import { scan } from './ast-scan.mjs';

const ALLOWED_FILES = new Set(['src/engine/types.ts']);

// Named binding exceptions outside src/engine/types.ts (never whole files, so new violations in these files still fail).
export const EXCEPTIONS = new Map([
  ['src/engine/graphTypes.ts', new Map([
    ['BASE_NODE_KINDS', 'canonical closed tuple of base graph node kinds'],
  ])],
  ['src/engine/variants.ts', new Map([
    ['ROUTE_WORDS', 'stop-words stripped from model IDs when grouping model lines by input route'],
    ['ROUTE_ORDER', 'display order of VariantRoute input kinds (text/image/edit/reference/video), not MediaKind'],
  ])],
  ['src/engine/agent/userChoice.ts', new Map([
    ['TIER', 'generic/tier stop-words stripped from user text when matching a model brand name'],
  ])],
  ['src/engine/agent/modelIndex.ts', new Map([
    ['GENERIC', 'generic query stop-words ignored during fuzzy model search'],
  ])],
  ['src/engine/design/svgImport/sanitize.ts', new Map([
    ['DROP_ELEMENTS', 'HTML/SVG tag names (audio, video, script, iframe...) stripped by the SVG sanitizer'],
  ])],
]);

const CORE_KINDS = new Set(['image', 'video', 'audio', 'model3d']);
const VARIANT_KINDS = new Set(['agent', 'llm', 'text']);
const ALL_KINDS = new Set([...CORE_KINDS, ...VARIANT_KINDS]);

const HINT = "Import `MEDIA_KINDS` (or a named tuple like `COMPOSER_MODES`, `MODEL_MEDIA_KINDS`, `VISUAL_MEDIA_KINDS`, `VIEWABLE_MEDIA_KINDS`) from `src/engine/types.ts`, or derive via spread (e.g. `['agent', ...MEDIA_KINDS]`).";

function stringLiteralOf(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  // Also catch `z.union([z.literal('image'), z.literal('video')])`.
  if (
    node.type === 'CallExpression'
    && node.callee?.type === 'MemberExpression'
    && node.callee.property?.name === 'literal'
    && node.arguments?.[0]?.type === 'Literal'
    && typeof node.arguments[0].value === 'string'
  ) {
    return node.arguments[0].value;
  }
  return null;
}

/** Return `file:line: message` errors for literal media kind lists outside `src/engine/types.ts`. */
export function check(root = '.') {
  return scan(root, {
    allowed: ALLOWED_FILES,
    what: 'media kind literals',
    rules: ({ rel }) => {
      const fileExceptions = EXCEPTIONS.get(rel);
      const bindingStack = [];
      return {
        enter: (node, report) => {
          if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') {
            bindingStack.push(node.id.name);
          }
          if (node.type !== 'ArrayExpression') return;
          if (fileExceptions && bindingStack.some((name) => fileExceptions.has(name))) return;
          const values = node.elements.map(stringLiteralOf).filter((v) => v !== null);
          const core = [...new Set(values.filter((v) => CORE_KINDS.has(v)))];
          const matched = [...new Set(values.filter((v) => ALL_KINDS.has(v)))];
          if (core.length >= 2 || (core.length >= 1 && matched.length >= 2)) {
            report(node, `literal media kind list [${matched.map((v) => `'${v}'`).join(', ')}] outside src/engine/types.ts. ${HINT}`);
          }
        },
        leave: (node) => {
          if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') {
            bindingStack.pop();
          }
        },
      };
    },
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const errors = check(process.cwd());
  if (errors.length) {
    console.error(`check-media-literals: FAIL (${errors.length} literal media list(s) outside src/engine/types.ts)\n${errors.map((e) => `  ${e}`).join('\n')}`);
    process.exit(1);
  }
  console.log('check-media-literals: PASS (all media kind lists derive from src/engine/types.ts).');
}
