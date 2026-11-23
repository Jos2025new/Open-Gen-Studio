/**
 * Single paid-send gate rule (D+ pilot, docs/diagnostico-dinero.md):
 * No billable provider call may bypass `paidSend` (`src/engine/money/paidSend.ts`):
 *  1. LLM `chat()` (`src/engine/providers/llm.ts`) may only be imported/called from `src/engine/money/llmSend.ts`,
 *     and every `chat(...)` call must be in the gate's transport callback or the guarded free-price branch.
 *  2. Billable adapter methods (`generate`, `transcribe`, `createStyle`, `createVoice`) may only be invoked
 *     inside `src/engine/providers/*`, `src/engine/jobs.ts` (nested inside `sendGenerationViaPaidGate`/`paidSend`),
 *     or `src/engine/specialSends.ts` (nested inside `runSpecialSend`/`sendGenerationViaPaidGate`/`paidSend`).
 *  3. `providerFetch` (`src/lib/providerFetch.ts`) may only be imported/called inside `src/lib/{providerFetch,http,media}.ts`
 *     and `src/engine/providers/*` so no engine/UI code can POST directly to a provider endpoint.
 */
import { posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scan } from './ast-scan.mjs';

const LLM_SEND_FILE = 'src/engine/money/llmSend.ts';
const LLM_PROVIDER_FILE = 'src/engine/providers/llm.ts';
const BILLABLE_ADAPTER_METHODS = new Set(['generate', 'transcribe', 'createStyle', 'createVoice']);
const ADAPTER_GATE_FILES = new Set(['src/engine/jobs.ts', 'src/engine/specialSends.ts']);
const FETCH_ALLOWED = new Set([
  'src/lib/providerFetch.ts',
  'src/lib/http.ts',
  'src/lib/media.ts',
]);
const GATE_IMPORTS = new Map([
  ['src/engine/money/paidSend', 'paidSend'],
  ['src/engine/money/storeBridge', 'sendGenerationViaPaidGate'],
]);

const LLM_HINT = 'Route billable LLM calls through `sendLlmViaPaidGate` (`src/engine/money/llmSend.ts`) so they pass through `paidSend`.';
const ADAPTER_HINT = 'Route billable provider calls through `sendGenerationViaPaidGate` (`src/engine/money/storeBridge.ts`) or `paidSend` (`src/engine/money/paidSend.ts`).';
const FETCH_HINT = 'Do not call `providerFetch` directly; use a provider adapter behind `paidSend` (`src/engine/money/paidSend.ts`).';

function resolveTarget(fromRel, spec) {
  if (typeof spec !== 'string' || !spec.startsWith('.')) return '';
  return posix.join(posix.dirname(fromRel), spec).replace(/\.[cm]?[jt]sx?$/, '');
}

function keyName(node) {
  if (!node) return undefined;
  return node.type === 'Identifier' ? node.name : node.type === 'Literal' ? String(node.value) : undefined;
}

function unwrap(node) {
  let cur = node;
  while (cur && (cur.type === 'TSNonNullExpression' || cur.type === 'ChainExpression' || cur.type === 'ParenthesizedExpression' || cur.type === 'TSAsExpression')) {
    cur = cur.expression;
  }
  return cur;
}

function isFunction(node) {
  return node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression';
}

/** Only the function body registered as the transport can run after the gate. */
function inTransport(ancestors, gates, rel) {
  const i = ancestors.findLastIndex(isFunction);
  const fn = ancestors[i];
  if (!fn) return false;
  const parent = ancestors[i - 1];
  if (rel === 'src/engine/specialSends.ts' && parent?.type === 'CallExpression' &&
      unwrap(parent.callee)?.name === 'runSpecialSend' && unwrap(parent.arguments[2]) === fn) return true;
  if (parent?.type !== 'Property' || keyName(parent.key) !== 'send' || parent.value !== fn) return false;
  const object = ancestors[i - 2];
  const gate = ancestors.slice(0, i - 2).findLast((node) => node.type === 'CallExpression');
  return object?.type === 'ObjectExpression' && gate?.type === 'CallExpression'
    && unwrap(gate.arguments[0]) === object && gates.has(unwrap(gate.callee)?.name);
}

function inFreeLlmBranch(ancestors, guards) {
  const i = ancestors.findLastIndex((node) => node.type === 'IfStatement');
  const branch = ancestors[i];
  const test = branch?.test;
  return test?.type === 'CallExpression' && guards.has(unwrap(test.callee)?.name)
    && branch.consequent === ancestors[i + 1];
}

function isProviderImpl(rel) {
  return rel.startsWith('src/engine/providers/');
}

/** Problems under `root`, as `file:line: message` strings. */
export function check(root = '.') {
  return scan(root, {
    allowed: new Set(),
    what: 'paid-send gate calls',
    rules: ({ rel, program }) => {
      const llmNamespaces = new Set();
      const chatLocals = new Set();
      const fetchNamespaces = new Set();
      const fetchLocals = new Set();
      const ancestors = [];
      const gates = new Set();
      const freePriceGuards = new Set();

      for (const d of program.body) {
        if (d.type !== 'ImportDeclaration' || d.importKind === 'type') continue;
        const target = resolveTarget(rel, d.source?.value);
        for (const sp of d.specifiers ?? []) {
          if (sp.type === 'ImportSpecifier' && sp.importKind !== 'type' && GATE_IMPORTS.get(target) === keyName(sp.imported)) {
            gates.add(sp.local.name);
          }
          if (target === 'src/engine/money/ticket' && sp.type === 'ImportSpecifier'
              && sp.importKind !== 'type' && keyName(sp.imported) === 'isFreePrice') freePriceGuards.add(sp.local.name);
        }
        if (target === 'src/engine/providers/llm') {
          for (const sp of d.specifiers ?? []) {
            if (sp.importKind === 'type') continue;
            if (sp.type === 'ImportNamespaceSpecifier' && sp.local?.name) llmNamespaces.add(sp.local.name);
            if (sp.type === 'ImportSpecifier' && keyName(sp.imported) === 'chat' && sp.local?.name) chatLocals.add(sp.local.name);
          }
        }
        if (target === 'src/lib/providerFetch') {
          for (const sp of d.specifiers ?? []) {
            if (sp.importKind === 'type') continue;
            if (sp.type === 'ImportNamespaceSpecifier' && sp.local?.name) fetchNamespaces.add(sp.local.name);
            if (sp.type === 'ImportSpecifier' && keyName(sp.imported) === 'providerFetch' && sp.local?.name) fetchLocals.add(sp.local.name);
          }
        }
      }

      const isDynamicTo = (node, expected) =>
        (node?.type === 'ImportExpression' && resolveTarget(rel, node.source?.value) === expected)
        || (node?.type === 'AwaitExpression' && node.argument?.type === 'ImportExpression' && resolveTarget(rel, node.argument.source?.value) === expected);

      const checkPattern = (pattern, init, report, expected, forbidden, hint) => {
        if (pattern?.type !== 'ObjectPattern') return;
        const nsSet = expected === 'src/engine/providers/llm' ? llmNamespaces : fetchNamespaces;
        const isNs = (init?.type === 'Identifier' && nsSet.has(init.name)) || isDynamicTo(init, expected);
        if (!isNs) return;
        for (const p of pattern.properties ?? []) {
          const name = p.type === 'Property' ? keyName(p.key) : undefined;
          if (name === forbidden) {
            report(p, `destructures/imports \`${forbidden}\` outside the paidSend gate. ${hint}`);
          }
        }
      };

      const isChat = (node) => {
        const c = unwrap(node);
        return (c?.type === 'Identifier' && chatLocals.has(c.name))
          || (c?.type === 'MemberExpression' && keyName(c.property) === 'chat' &&
            ((c.object?.type === 'Identifier' && llmNamespaces.has(c.object.name)) || isDynamicTo(c.object, 'src/engine/providers/llm')));
      };

      return {
        enter: (node, report) => {
          const inGate = () => inTransport(ancestors, gates, rel);
          inspect(node, report, inGate);
          ancestors.push(node);
        },
        leave: () => { ancestors.pop(); },
      };

      function inspect(node, report, inGate) {

      // 1. Disallow importing/re-exporting LLM `chat` outside llmSend.ts and llm.ts.
      if ((node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration') && rel !== LLM_SEND_FILE && rel !== LLM_PROVIDER_FILE) {
        const target = resolveTarget(rel, node.source?.value);
        if (target === 'src/engine/providers/llm' && node.importKind !== 'type' && node.exportKind !== 'type') {
          for (const sp of node.specifiers ?? []) {
            if (sp.importKind === 'type' || sp.exportKind === 'type') continue;
            if (keyName(sp.imported ?? sp.local) === 'chat') {
              report(sp, `imports/exports billable LLM \`chat\` outside \`${LLM_SEND_FILE}\`. ${LLM_HINT}`);
            }
          }
        }
        // 3. Disallow importing/re-exporting `providerFetch` outside allowed transport/provider layer.
        if (target === 'src/lib/providerFetch' && !FETCH_ALLOWED.has(rel) && !isProviderImpl(rel) && node.importKind !== 'type' && node.exportKind !== 'type') {
          for (const sp of node.specifiers ?? []) {
            if (sp.importKind === 'type' || sp.exportKind === 'type') continue;
            if (keyName(sp.imported ?? sp.local) === 'providerFetch') {
              report(sp, `imports/exports \`providerFetch\` outside the provider transport layer. ${FETCH_HINT}`);
            }
          }
        }
      }

      if (node.type === 'ExportAllDeclaration') {
        const target = resolveTarget(rel, node.source?.value);
        if (target === 'src/engine/providers/llm' && rel !== LLM_SEND_FILE && rel !== LLM_PROVIDER_FILE) {
          report(node, `re-exports all of providers/llm (including billable \`chat\`). ${LLM_HINT}`);
        }
        if (target === 'src/lib/providerFetch' && !FETCH_ALLOWED.has(rel) && !isProviderImpl(rel)) {
          report(node, `re-exports all of providerFetch outside the provider transport layer. ${FETCH_HINT}`);
        }
      }

      if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') {
        if (isDynamicTo(node.init, 'src/engine/providers/llm')) llmNamespaces.add(node.id.name);
        if (isDynamicTo(node.init, 'src/lib/providerFetch')) fetchNamespaces.add(node.id.name);
      }

      if (node.type === 'VariableDeclarator') {
        if (rel !== LLM_PROVIDER_FILE && (rel !== LLM_SEND_FILE || !inGate())) checkPattern(node.id, node.init, report, 'src/engine/providers/llm', 'chat', LLM_HINT);
        if (!FETCH_ALLOWED.has(rel) && !isProviderImpl(rel)) checkPattern(node.id, node.init, report, 'src/lib/providerFetch', 'providerFetch', FETCH_HINT);
      }
      if (node.type === 'AssignmentExpression') {
        if (rel !== LLM_PROVIDER_FILE && (rel !== LLM_SEND_FILE || !inGate())) checkPattern(node.left, node.right, report, 'src/engine/providers/llm', 'chat', LLM_HINT);
        if (!FETCH_ALLOWED.has(rel) && !isProviderImpl(rel)) checkPattern(node.left, node.right, report, 'src/lib/providerFetch', 'providerFetch', FETCH_HINT);
      }

      if (node.type === 'MemberExpression') {
        const prop = keyName(node.property);
        if (prop === 'chat' && rel !== LLM_SEND_FILE && rel !== LLM_PROVIDER_FILE) {
          if ((node.object?.type === 'Identifier' && llmNamespaces.has(node.object.name)) || isDynamicTo(node.object, 'src/engine/providers/llm')) {
            report(node, `accesses billable LLM \`chat\` outside \`${LLM_SEND_FILE}\`. ${LLM_HINT}`);
          }
        }
        if (prop === 'providerFetch' && !FETCH_ALLOWED.has(rel) && !isProviderImpl(rel)) {
          if ((node.object?.type === 'Identifier' && fetchNamespaces.has(node.object.name)) || isDynamicTo(node.object, 'src/lib/providerFetch')) {
            report(node, `accesses \`providerFetch\` outside the provider transport layer. ${FETCH_HINT}`);
          }
        }
      }

      // 1b. Inside llmSend.ts, every `chat(...)` call must sit inside `paidSend(...)`.
      if (node.type === 'CallExpression') {
        const callee = unwrap(node.callee);
        const indirect = callee?.type === 'MemberExpression' && ['bind', 'call', 'apply'].includes(keyName(callee.property))
          ? unwrap(callee.object) : undefined;
        if (rel === LLM_SEND_FILE && (isChat(callee) || isChat(indirect)) && !inGate() && !inFreeLlmBranch(ancestors, freePriceGuards)) {
          report(node, `calls billable LLM \`chat()\` outside \`paidSend()\`. ${LLM_HINT}`);
        }
        // 2. Billable adapter methods: forbidden outside providers/, and inside jobs.ts / specialSends.ts must sit inside the gate.
        const adapterMethod = indirect ?? callee;
        if (!isProviderImpl(rel) && adapterMethod?.type === 'MemberExpression') {
          const prop = keyName(adapterMethod.property);
          if (BILLABLE_ADAPTER_METHODS.has(prop)) {
            if (!ADAPTER_GATE_FILES.has(rel)) {
              report(node, `calls billable provider method \`.${prop}()\` outside \`paidSend\` gate. ${ADAPTER_HINT}`);
            } else if (!inGate()) {
              report(node, `calls billable provider method \`.${prop}()\` in \`${rel}\` outside \`sendGenerationViaPaidGate\`/\`runSpecialSend\`/\`paidSend\`. ${ADAPTER_HINT}`);
            }
          }
        }
        // 3b. Direct `providerFetch(...)` call outside allowed layer (catches aliases too).
        if (!FETCH_ALLOWED.has(rel) && !isProviderImpl(rel) && callee?.type === 'Identifier' && fetchLocals.has(callee.name)) {
          report(node, `calls \`providerFetch()\` outside the provider transport layer. ${FETCH_HINT}`);
        }
      }
      }
    },
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const errors = check('.');
  if (errors.length) {
    console.error(`check-paid-send: ${errors.length} disallowed billable provider send(s)\n${errors.map((e) => `  ${e}`).join('\n')}`);
    process.exit(1);
  }
  console.log('check-paid-send: all billable LLM and provider sends go through paidSend.');
}
