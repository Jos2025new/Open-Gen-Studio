import { describe, expect, it } from 'vitest';
import { CAPABILITIES, MUST, TOOLS } from '../src/engine/agent/tools';

describe('agent capability map', () => {
  it('lists every real tool, and only real tools', () => {
    const listed = [...CAPABILITIES.matchAll(/^- ([a-z_]+):/gm)].map((m) => m[1]);
    expect(listed.sort()).toEqual(TOOLS.map((t) => t.function.name).sort());
  });
  it('anti-drift rules say to act through tools', () => {
    expect(MUST).toMatch(/call the tool/);
  });
});
