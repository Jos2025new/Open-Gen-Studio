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
  it('cast before motion: anything invented gets its image before a video, also the product in UGC', () => {
    expect(SYSTEM_PROMPT.slice(0, 6000)).toContain('Cast before motion');
    expect(SYSTEM_PROMPT).toContain('A video prompt never invents a cast member that has no image.');
    const ugc = readGuide('workflow:ugc')!;
    expect(ugc).toContain('when invented — a product image made from text only');
    expect(ugc).toContain('plan 1 is the creator sheet and, for an invented product, its product image');
    // Every workflow carries the same cast rule, not only UGC.
    for (const id of ['product-pack', 'story', 'shot-sequence', 'ugc']) expect(readGuide(`workflow:${id}`)).toContain('cast (every workflow)');
  });
  it('tells the agent the app\'s order and checks up front, so plans pass the first time', () => {
    const head = SYSTEM_PROMPT.slice(0, 9000);
    expect(head).toContain('How the app works');
    expect(head).toContain('ask_questions (only for missing user data) → confirm_settings (when the settings policy below requires it) → propose_plan. Each request\'s mode line says which of these you have.');
    // The fixed prompt names no mode: only each request's mode line does, so the agent does not reason about other modes.
    expect(SYSTEM_PROMPT).not.toMatch(/\b(auto and guided|direct mode|guided only)\b/i);
    expect(head).toContain('candidates end the plan');
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

describe('limits and mode lines the agent reads', () => {
  it('the continuity preserve limit is stated where the agent reads it, and matches the schema', async () => {
    const { TOOLS } = await import('../src/engine/agent/tools');
    expect(JSON.stringify(TOOLS)).toContain('max 200 chars');
  });
  it('the auto mode line says what to do, not which cards exist', async () => {
    const source = (await import('node:fs')).readFileSync('src/engine/agent/context.ts', 'utf8');
    expect(source).toContain('mode: auto (ask only missing user data, once; decide the rest)');
    expect(source).not.toContain("for the user's data only");
  });
});
