import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import { WRAPUP_RULE, SYSTEM_PROMPT } from '../src/engine/agent/context';
import { readGuide, skillById, workflowById } from '../src/engine/skills';

describe('social ad router and UGC workflow', () => {
  it('the social guide comes only through read_guide: route table, claims and the three copy layers', () => {
    const skill = skillById('social')!;
    expect(skill.guidance).toMatch(/Load skill:social/);
    expect(skill.guidance).not.toContain(skill.guide!);
    const text = readGuide('skill:social')!;
    expect(text).toMatch(/^Social ad:/);
    expect(text).toMatch(/one format → one flow/);
    expect(text).toMatch(/workflow:ugc/);
    expect(text).toMatch(/Claims \(hard rule/);
    expect(text).toMatch(/On-screen text/);
    expect(text).toMatch(/no market research/);
  });

  it('every flow the router names exists', () => {
    const text = skillById('social')!.guide!;
    for (const id of text.match(/workflow:([a-z-]+)/g)!.map((m) => m.slice(9))) expect(workflowById(id), id).toBeDefined();
  });

  it('UGC is its own chat workflow: 9:16, images in refs and claims in continuity, one piece per variant', () => {
    const w = workflowById('ugc')!;
    expect(w.workspaces).toEqual(['chat']);
    expect(w.fixed).toEqual({ aspect: '9:16' });
    expect(w.continuity).toMatch(/refs of every step/);
    expect(w.continuity).toMatch(/library only if the user asks/);
    expect(w.continuity).toMatch(/Claims only from the brief/);
    expect(w.variants!.map((v) => v.id)).toEqual(['review', 'unboxing', 'try-on', 'tutorial']);
    expect(readGuide('workflow:ugc/tutorial')).toMatch(/join_clips/);
  });

  it('the wrap-up rule is not in the fixed prompt (it travels only after a plan runs)', () => {
    expect(SYSTEM_PROMPT).not.toContain(WRAPUP_RULE);
  });
});
