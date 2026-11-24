import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, {
  window: { setTimeout, clearTimeout, addEventListener: () => undefined },
  document: { addEventListener: () => undefined, visibilityState: 'visible' },
}));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { CAPABILITIES, TOOLS } from '../src/engine/agent/tools';
import { agentSystem } from '../src/engine/agent/llmTurn';

describe('Part 6: brief Library kits rule in agent capability map', () => {
  it('documents what a kit is, the build workflow, and reading the index before designing without breaking tool listing or size limits', () => {
    const kitLine = CAPABILITIES.split('\n').find((l) => /LIBRARY KITS/i.test(l));
    expect(kitLine).toBeDefined();
    expect(kitLine!.length).toBeLessThan(400);
    expect(kitLine).toMatch(/moodboard|design-system|brand-kit/i);
    expect(kitLine).toMatch(/library\.kit\.create/);
    expect(kitLine).toMatch(/designer\.group\.create/);
    expect(kitLine).toMatch(/library\.kit\.update/);
    expect(kitLine).toMatch(/before designing/i);
    expect(agentSystem()).toContain(kitLine!);

    // Still passes capability map tool-list invariant
    const listed = [...CAPABILITIES.matchAll(/^- ([a-z_]+):/gm)].map((m) => m[1]);
    expect(listed.sort()).toEqual(TOOLS.map((t) => t.function.name).sort());
  });
});
