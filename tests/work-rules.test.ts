import { describe, expect, it } from 'vitest';
import { WORK_RULES } from '../src/engine/procedure';
import { readFileSync } from 'node:fs';

describe('WORK_RULES', () => {
  it('carries the compare, switch-model and failed-result rules', () => {
    expect(WORK_RULES).toContain('cite each by its result number and asset id');
    expect(WORK_RULES).toContain('never say you cannot change it');
    expect(WORK_RULES).toContain('no apologies');
  });
  it('is wired into the agent context', () => {
    expect(readFileSync('src/engine/agent/context.ts', 'utf8')).toContain('${WORK_RULES}');
  });
});
