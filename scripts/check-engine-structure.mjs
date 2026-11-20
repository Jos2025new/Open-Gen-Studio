import { readdirSync, readFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSync } from 'rolldown/utils';

// Structure rules of the send engine (Opus #4, #8, #10, 2026-11-20). Each prints rule · file:line · problem · fix.
// 1. jobs.ts is provider-neutral: a provider's quirks are optional capabilities of its ProviderAdapter.
// 2. Providers reach the IndexedDB cache only through cachedJson / peekCached in providers/shared.ts.
// 4. The model an operation runs with is chosen in one place, opChoice() (opSpec.ts): the send, the estimate
//    (planSteps/exec/op.ts) and the Nodes preview (flow/actions.ts) call it and keep no chain of their own.
// 3. jobs.ts holds the send, not the operation specs (opSpec.ts) or the remote-job recovery (jobRecovery.ts).
const RULES = { neutral: true, split: true };
const NAMED_PROVIDER = /\b(atlas|fal|nanogpt|openrouter)\b|\bOP_PROVIDERS\b/i;
const NEUTRAL_FILES = new Set(['jobs.ts', 'quotes.ts', 'costs.ts', 'opSpec.ts', 'specialSends.ts', 'planSteps/audio.ts']
  .map((file) => `src/engine/${file}`));
const MOVED_OUT = /^(?:export\s+)?(?:async\s+)?function\s+(opSpec\w*|videoOp\w*|inputKindOf|recover\w*|resumeRemote\w*)\b/;

const OWN_CHOICE = /\b(opModelForAsset|opModelFromRef|reusedOpChoice)\(/;
const CHOICE_CALLERS = ['src/engine/planSteps/exec/op.ts', 'src/engine/flow/actions.ts'];

function isTypeOnlyDecl(node) {
  if (node.importKind === 'type' || node.exportKind === 'type') return true;
  return Boolean(node.specifiers?.length && node.specifiers.every((spec) => spec.importKind === 'type' || spec.exportKind === 'type'));
}

function importProblems(path, text) {
  const store = path === 'src/store/store.ts';
  if (!store && !path.startsWith('src/engine/providers/')) return [];
  const { program, errors } = parseSync(path, text);
  if (errors.length) return [`import-boundary · ${path}:1 · could not parse imports · ${errors[0].message}`];
  const problems = [];
  function visit(node) {
    if (!node || typeof node.type !== 'string') return;
    if (store && isTypeOnlyDecl(node)) return;
    const spec = node.source;
    if (spec?.type === 'Literal' && typeof spec.value === 'string' && spec.value.startsWith('.')) {
      const target = posix.join(posix.dirname(path), spec.value);
      const line = text.slice(0, spec.start).split('\n').length;
      if (store && /^src\/engine\/(design|flow)(\/|$)/.test(target)) {
        problems.push(`store-domain-boundary · ${path}:${line} · store imports Designer or Nodes · invert via storeHooks`);
      }
      if (!store && /^src\/engine\/quotes(?:\.ts)?$/.test(target)) {
        problems.push(`provider-neutral-engine · ${path}:${line} · provider imports engine quotes · implement quote on the adapter`);
      }
      if (!store && /^src\/lib\/idb(?:\.[cm]?[jt]sx?)?$/.test(target)) {
        problems.push(`provider-storage-boundary · ${path}:${line} · provider imports user persistence · use providers/shared.ts for catalog caching`);
      }
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(visit); else visit(child);
    }
  }
  visit(program);
  return problems;
}

export function structureProblems(files, existingCycles = new Set()) {
  const problems = [];
  for (const [path, text] of Object.entries(files)) {
    problems.push(...importProblems(path, text));
    if (path === 'src/store/reuse.ts') {
      problems.push(`reuse-domain-boundary · ${path}:1 · Reuse lives in the store · move it to src/engine/reuse.ts and use isVideoOpEngine()`);
    }
    if (CHOICE_CALLERS.includes(path)) {
      if (!/\bopChoice\(/.test(text)) problems.push(`one-op-choice · ${path}:1 · does not call opChoice() · ask opChoice() (opSpec.ts) which model the operation runs with`);
      text.split('\n').forEach((line, i) => {
        const own = line.match(OWN_CHOICE);
        if (own) problems.push(`one-op-choice · ${path}:${i + 1} · own model choice (${own[1]}) · replace the chain with opChoice() from opSpec.ts`);
      });
    }
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      const at = `${path}:${i + 1}`;
      if (NEUTRAL_FILES.has(path)) {
        const named = /^(?:\s*\/\/|\s*\*)/.test(line) ? null : line.match(NAMED_PROVIDER);
        if (named && RULES.neutral) problems.push(`provider-neutral-engine · ${at} · names «${named[0]}» · use adapter capabilities or provider labels`);
      }
      if (path === 'src/engine/jobs.ts') {
        const moved = line.match(MOVED_OUT);
        if (moved && RULES.split) problems.push(`jobs-split · ${at} · jobs.ts defines ${moved[1]} · it lives in src/engine/opSpec.ts (operation specs) or src/engine/jobRecovery.ts (remote recovery)`);
      }
      if (/^src\/engine\/providers\//.test(path) && path !== 'src/engine/providers/shared.ts' && /\bcacheDb\b/.test(line)) {
        problems.push(`cache-through-shared · ${at} · provider uses cacheDb directly · use cachedJson(key, ttlMs, load) or peekCached(key, ttlMs) from providers/shared.ts`);
      }
    });
  }
  return [...problems, ...cycleProblems(files, existingCycles)];
}

// Static runtime imports and re-exports participate in module initialization.
function cycleProblems(files, existingCycles) {
  const graph = new Map();
  const problems = [];
  for (const [path, text] of Object.entries(files)) {
    if (!/^src\/(engine|store)\//.test(path)) continue;
    const { program, errors } = parseSync(path, text);
    const edges = [];
    graph.set(path, edges);
    if (errors.length) {
      problems.push(`engine-import-cycle · ${path}:1 · could not parse imports · ${errors[0].message}`);
      continue;
    }
    for (const node of program.body) {
      if (!node.source?.value?.startsWith('.') || isTypeOnlyDecl(node)) continue;
      const base = posix.join(posix.dirname(path), node.source.value);
      const to = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find((file) => Object.hasOwn(files, file));
      if (to && /^src\/(engine|store)\//.test(to)) edges.push({ to, line: text.slice(0, node.start).split('\n').length });
    }
  }

  // Transitive store -> design/flow check: barrels cannot hide domain imports from store.ts.
  const seen = new Set(['src/store/store.ts']);
  const queue = [{ file: 'src/store/store.ts', trail: ['src/store/store.ts'] }];
  while (queue.length) {
    const { file, trail } = queue.shift();
    for (const { to, line } of graph.get(file) ?? []) {
      if (/^src\/engine\/(design|flow)\//.test(to)) {
        problems.push(`store-domain-boundary · ${file}:${line} · store reaches ${to} (${trail.join(' -> ')} -> ${to}) · invert via storeHooks`);
        continue;
      }
      if (!seen.has(to)) {
        seen.add(to);
        queue.push({ file: to, trail: [...trail, to] });
      }
    }
  }

  // Tarjan: each active vertex retains the lowest index it can reach on the stack.
  const index = new Map();
  const low = new Map();
  const stack = new Set();
  function visit(path) {
    index.set(path, index.size);
    low.set(path, index.get(path));
    stack.add(path);
    for (const { to } of graph.get(path)) {
      if (!index.has(to)) {
        visit(to);
        low.set(path, Math.min(low.get(path), low.get(to)));
      } else if (stack.has(to)) {
        low.set(path, Math.min(low.get(path), index.get(to)));
      }
    }
    if (low.get(path) !== index.get(path)) return;
    const members = new Set();
    for (const member of [...stack].reverse()) {
      stack.delete(member);
      members.add(member);
      if (member === path) break;
    }
    for (const from of members) for (const { to, line } of graph.get(from)) {
      if (members.has(to) && !existingCycles.has(`${from} -> ${to}`)) problems.push(`engine-import-cycle · ${from}:${line} · imports ${to} inside a cycle · move shared code to a leaf or use a type-only import`);
    }
  }
  for (const path of graph.keys()) if (!index.has(path)) visit(path);
  return problems;
}

export function checkEngineStructure(root) {
  const files = {};
  for (const dir of ['src/engine', 'src/store']) {
    for (const name of readdirSync(join(root, dir), { recursive: true }).sort()) {
      if (/\.tsx?$/.test(name)) files[`${dir}/${name}`] = readFileSync(join(root, dir, name), 'utf8');
    }
  }
  // Existing cycles outside this refactor are tracked by their exact edges.
  const baseline = readFileSync(new URL('./engine-import-cycles-baseline.json', import.meta.url), 'utf8');
  const problems = structureProblems(files, new Set(JSON.parse(baseline)));
  if (problems.length) throw new Error(`check-engine-structure: FAIL\n${problems.join('\n')}`);
  console.log('check-engine-structure: PASS');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { checkEngineStructure(process.cwd()); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
