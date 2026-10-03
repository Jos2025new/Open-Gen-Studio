import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));

import { SYSTEM_PROMPT } from '../src/engine/agent/context';
import { guideIndex, readGuide } from '../src/engine/skills';

describe('one procedure instead of per-case rules', () => {
  it('opens with the procedure and the user-data / creative split, in every mode', () => {
    const head = SYSTEM_PROMPT.slice(0, 2500);
    expect(head).toContain('The procedure (every message, every mode, every size of piece)');
    expect(head).toContain("The user's data");
    expect(head).toContain('Creative decisions');
    expect(SYSTEM_PROMPT).not.toContain('plan directly');
  });
  it('staged-piece rules live once, in skill:staged, not in the prompt', () => {
    const staged = readGuide('skill:staged')!;
    for (const rule of ['Pilot first', 'Pre-production first', 'One clip or several', 'Sequence rules', 'The look']) {
      expect(staged).toContain(rule);
      expect(SYSTEM_PROMPT).not.toContain(`- ${rule}`);
    }
    expect(guideIndex()).toContain('skill:staged');
  });
});
