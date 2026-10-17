import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));

import { SYSTEM_PROMPT } from '../src/engine/agent/context';
import { CAPABILITIES, MUST } from '../src/engine/agent/tools';
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
    expect(head).toContain('if the request has a real doubt, ask_questions once; once it is clear, read_guide for the workflow that fits; then confirm_settings if required; then propose_plan. If it is clear already, read_guide and follow it. Each request\'s mode line says which you have.');
    // The fixed prompt names no mode: only each request's mode line does, so the agent does not reason about other modes.
    expect(SYSTEM_PROMPT).not.toMatch(/\b(auto and guided|direct mode|guided only)\b/i);
    expect(head).toContain('candidates end the plan');
  });
  it('interpret-first ordering sits at the start and the end of the prompt, not before any question', () => {
    expect(SYSTEM_PROMPT).not.toContain('before any question');
    expect(SYSTEM_PROMPT).toContain('2. Interpret the request first. If it is clear, load the fitting workflow (table below) and proceed. If it has open questions, ask_questions / propose settings first; load the workflow once it is clear.');
    expect(MUST).toContain('Interpret first: a clear request goes straight to its workflow; open questions');
    const full = `${MUST}\n\n${CAPABILITIES}\n\n${SYSTEM_PROMPT}\n\n${MUST}`;
    expect(full.indexOf('Interpret first')).toBeLessThan(400);
    expect(full.lastIndexOf('Interpret first')).toBeGreaterThan(full.length - 700);
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
  it('a continuity preserve text over 200 characters is trimmed by the app, not refused (no extra round)', async () => {
    const { proposePlanSchema } = await import('../src/engine/agent/tools');
    const parsed = proposePlanSchema.safeParse({ title: 't', steps: [{ id: 's1', kind: 'text', text: 'a' }], continuity: [{ source: 'asset:a', preserve: 'x'.repeat(260), steps: ['s1'] }] });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.continuity![0].preserve.length).toBe(200);
  });
  it('the auto mode line says what to do, not which cards exist', async () => {
    const source = (await import('node:fs')).readFileSync('src/engine/agent/context.ts', 'utf8');
    expect(source).toContain('mode: auto (ask only missing user data, once; decide the rest)');
    expect(source).not.toContain("for the user's data only");
  });
});
