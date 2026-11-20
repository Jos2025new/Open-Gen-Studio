import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NORMALIZE_STEP } from '../src/engine/planSteps';
import { ESTIMATE_STEP, RUN_STEP } from '../src/engine/planSteps/exec';

/** Opus #5: a step kind lives in tables keyed by kind, never in an if/switch chain in plan.ts or executor.ts. */
function planStepKinds(): string[] {
  const types = readFileSync('src/engine/types.ts', 'utf8');
  const union = /export type PlanStep = ([^;]+);/.exec(types)![1].split('|').map((n) => n.trim());
  return union.map((name) => new RegExp(`export interface ${name} extends StepBase \\{\\s*kind: '([a-z0-9]+)'`).exec(types)?.[1] ?? `?${name}`);
}

describe('step kinds have one entry in every table', () => {
  const kinds = planStepKinds();
  it('reads the kinds from the PlanStep union', () => {
    expect(kinds.sort()).toEqual(['audio', 'image', 'layer', 'model3d', 'op', 'text', 'video']);
  });
  it.each([['normalize', NORMALIZE_STEP], ['estimate', ESTIMATE_STEP], ['run', RUN_STEP]] as const)('%s has an entry per kind and no other', (_name, table) => {
    expect(Object.keys(table).sort()).toEqual(kinds);
    for (const kind of kinds) expect(typeof (table as Record<string, unknown>)[kind]).toBe('function');
  });
  it('keeps normalizePlan and executor.ts free of per-kind branches', () => {
    expect(readFileSync('src/engine/plan.ts', 'utf8'), 'plan.ts: normalizePlan dispatches through NORMALIZE_STEP').not.toMatch(/switch \(s\.kind\)/);
    expect(readFileSync('src/engine/executor.ts', 'utf8'), 'executor.ts: steps price and run through ESTIMATE_STEP / RUN_STEP').not.toMatch(/case '(text|image|model3d|video|audio|op|layer)':|switch \(s\.kind\)/);
  });
});
