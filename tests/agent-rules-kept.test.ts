import { describe, expect, it } from 'vitest';
import { SYSTEM_PROMPT } from '../src/engine/agent/context';
import { TOOLS } from '../src/engine/agent/tools';

// ADR 0025: the change and aspect rules were added without dropping older agent rules to fit the size baseline.
describe('agent rules survive the ADR 0025 additions', () => {
  it('the system prompt keeps the older rules and carries the new ones', () => {
    for (const s of [
      'Different requested outputs use separate steps; candidates per step do not replace distinct outputs.',
      'never say a model is unavailable without searching',
      'use an asset-backed subject only if they said yes to saving or asked to save',
      'Never infer "there are no more images" from the recent list or previous replies.',
      'or only the provider of the confirmed one ("use NanoGPT")',
      "a character's full-body reference vertical",
    ]) expect(SYSTEM_PROMPT).toContain(s);
  });
  it('the tool descriptions keep their wording', () => {
    const text = JSON.stringify(TOOLS);
    for (const s of ['restore a deletion only when the user explicitly asks', 'No extra confirmation.', 'Does not save, generate or regenerate anything.', 'continue_in_canvas']) expect(text).toContain(s);
  });
});
