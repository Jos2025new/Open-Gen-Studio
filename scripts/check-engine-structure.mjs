import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
const NAMED_PROVIDER = /\b(atlas|fal)\b/i;
const MOVED_OUT = /^(?:export\s+)?(?:async\s+)?function\s+(opSpec\w*|videoOp\w*|inputKindOf|recover\w*|resumeRemote\w*)\b/;

const OWN_CHOICE = /\b(opModelForAsset|opModelFromRef|reusedOpChoice)\(/;
const CHOICE_CALLERS = ['src/engine/planSteps/exec/op.ts', 'src/engine/flow/actions.ts'];

function importProblems(path, text) {
  const store = path === 'src/store/store.ts';
  if (!store && !path.startsWith('src/engine/providers/')) return [];
  const { program, errors } = parseSync(path, text);
  if (errors.length) return [`import-boundary · ${path}:1 · could not parse imports · ${errors[0].message}`];
  const problems = [];
  function visit(node) {
    if (!node || typeof node.type !== 'string') return;
    const spec = node.source;
    if (spec?.type === 'Literal' && typeof spec.value === 'string' && spec.value.startsWith('.')) {
      const target = posix.join(posix.dirname(path), spec.value);
      const line = text.slice(0, spec.start).split('\n').length;
      if (store && /^src\/engine\/(design|flow)(\/|$)/.test(target)) {
        problems.push(`store-domain-boundary · ${path}:${line} · store imports Designer or Nodes · use the domain bridge`);
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

export function structureProblems(files) {
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
      if (path === 'src/engine/jobs.ts') {
        const named = line.match(NAMED_PROVIDER);
        if (named && RULES.neutral) problems.push(`provider-neutral-engine · ${at} · jobs.ts names the provider «${named[1]}» · move it to an optional ProviderAdapter capability (quote?, serialKey?, retry?, createVoice?, createStyle?) and pick the adapter with parseModelRef(g.modelRef)`);
        const moved = line.match(MOVED_OUT);
        if (moved && RULES.split) problems.push(`jobs-split · ${at} · jobs.ts defines ${moved[1]} · it lives in src/engine/opSpec.ts (operation specs) or src/engine/jobRecovery.ts (remote recovery)`);
      }
      if (/^src\/engine\/providers\//.test(path) && path !== 'src/engine/providers/shared.ts' && /\bcacheDb\b/.test(line)) {
        problems.push(`cache-through-shared · ${at} · provider uses cacheDb directly · use cachedJson(key, ttlMs, load) or peekCached(key, ttlMs) from providers/shared.ts`);
      }
    });
  }
  return problems;
}

export function checkEngineStructure(root) {
  const files = {};
  for (const path of ['src/engine/jobs.ts', 'src/store/store.ts', ...CHOICE_CALLERS]) files[path] = readFileSync(join(root, path), 'utf8');
  const oldReuse = 'src/store/reuse.ts';
  if (existsSync(join(root, oldReuse))) files[oldReuse] = readFileSync(join(root, oldReuse), 'utf8');
  for (const name of readdirSync(join(root, 'src/engine/providers'))) {
    if (name.endsWith('.ts')) files[`src/engine/providers/${name}`] = readFileSync(join(root, 'src/engine/providers', name), 'utf8');
  }
  const problems = structureProblems(files);
  if (problems.length) throw new Error(`check-engine-structure: FAIL\n${problems.join('\n')}`);
  console.log('check-engine-structure: PASS');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { checkEngineStructure(process.cwd()); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
