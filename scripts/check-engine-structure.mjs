import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Structure rules of the send engine (Opus #4, #8, #10, 2026-11-20). Each prints rule · file:line · problem · fix.
// 1. jobs.ts is provider-neutral: a provider's quirks are optional capabilities of its ProviderAdapter.
// 2. Providers reach the IndexedDB cache only through cachedJson / peekCached in providers/shared.ts.
// 3. jobs.ts holds the send, not the operation specs (opSpec.ts) or the remote-job recovery (jobRecovery.ts).
const RULES = { jobs: false };
const NAMED_PROVIDER = /\b(atlas|fal)\b/i;
const MOVED_OUT = /^(?:export\s+)?(?:async\s+)?function\s+(opSpec\w*|videoOp\w*|inputKindOf|recover\w*|resumeRemote\w*)\b/;

export function structureProblems(files) {
  const problems = [];
  for (const [path, text] of Object.entries(files)) {
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      const at = `${path}:${i + 1}`;
      if (path === 'src/engine/jobs.ts' && RULES.jobs) {
        const named = line.match(NAMED_PROVIDER);
        if (named) problems.push(`provider-neutral-engine · ${at} · jobs.ts names the provider «${named[1]}» · move it to an optional ProviderAdapter capability (quote?, serialKey?, retry?, createVoice?, createStyle?) and pick the adapter with parseModelRef(g.modelRef)`);
        const moved = line.match(MOVED_OUT);
        if (moved) problems.push(`jobs-split · ${at} · jobs.ts defines ${moved[1]} · it lives in src/engine/opSpec.ts (operation specs) or src/engine/jobRecovery.ts (remote recovery)`);
      }
      if (/^src\/engine\/providers\//.test(path) && path !== 'src/engine/providers/shared.ts' && /\bcacheDb\b/.test(line)) {
        problems.push(`cache-through-shared · ${at} · provider uses cacheDb directly · use cachedJson(key, ttlMs, load) or peekCached(key, ttlMs) from providers/shared.ts`);
      }
    });
  }
  return problems;
}

export function checkEngineStructure(root) {
  const files = { 'src/engine/jobs.ts': readFileSync(join(root, 'src/engine/jobs.ts'), 'utf8') };
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
