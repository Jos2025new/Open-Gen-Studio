import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import { mediumResolution } from '../src/engine/params';
import { SYSTEM_PROMPT } from '../src/engine/agent/context';

describe('medium quality by default (R1)', () => {
  it('takes the middle size, never the highest', () => {
    expect(mediumResolution(['480p', '720p', '1080p'], '1080p')).toBe('720p');
    expect(mediumResolution(['720p', '1080p'], '1080p')).toBe('720p');
    expect(mediumResolution(['1080p', '720p', '4k', '480p'])).toBe('720p');
  });

  it("keeps the model's default when it is already smaller, and leaves non-size options alone", () => {
    expect(mediumResolution(['480p', '720p', '1080p'], '480p')).toBe('480p');
    expect(mediumResolution(['standard', 'pro'], 'pro')).toBe('pro');
    expect(mediumResolution(['1080p'], '1080p')).toBe('1080p');
  });
});

describe('default route and prompting rules in the system prompt (R1, R2)', () => {
  it('states the default route, the purpose tables and the prompting rules', () => {
    for (const s of ['Default route', 'Wan 3', 'Seedance 2.0 Fast', 'Seedance 2.5', 'MiniMax H3', 'GPT Image 2', 'Nano Banana Pro', 'Recraft', 'Ideogram', 'never from how many references', 'do not describe the image again', 'Never paraphrase a reference']) {
      expect(SYSTEM_PROMPT).toContain(s);
    }
    expect(SYSTEM_PROMPT).not.toMatch(/Usually 40-120 words\. Write prompts/);
  });
});
