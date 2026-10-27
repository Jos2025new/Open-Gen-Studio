import { describe, expect, it } from 'vitest';
import { modelPriority } from '../src/engine/agent/modelPriority';
import { buildSettings } from '../src/engine/agent/settingsCard';
import type { ModelSummary, ModelSchema } from '../src/engine/types';
import { confirmSettingsSchema, proposePlanSchema } from '../src/engine/agent/tools';

describe('explicit model choice, not name matching', () => {
  it('keeps a session choice over a composer default and an agent recommendation', () => {
    expect(modelPriority({ session: 'Z', composer: 'Y', proposed: 'A', userRequested: false })).toEqual({ modelRef: 'Z', reason: 'session' });
  });
  it('accepts a current explicit request, or a current card selection first', () => {
    expect(modelPriority({ session: 'Z', composer: 'Y', proposed: 'C', userRequested: true }).modelRef).toBe('C');
    expect(modelPriority({ picked: 'Z', session: 'Y', proposed: 'C', userRequested: true }).modelRef).toBe('Z');
  });
  it('uses composer for a new session and keeps comparison choices temporary', () => {
    expect(modelPriority({ composer: 'Y', proposed: 'A' }).modelRef).toBe('Y');
    expect(modelPriority({ session: 'T', composer: 'Y', proposed: 'A', comparison: true }).reason).toBe('comparison');
  });
  it('accepts missing provenance (the app infers it, never from the agent\'s own words)', () => {
    // The schema no longer bounces a missing flag: the app infers it (tests/user-choice-inferred.test.ts).
    expect(confirmSettingsSchema.safeParse({ parts: [{ kind: 'image', model: 'flux' }] }).success).toBe(true);
    expect(proposePlanSchema.safeParse({ title: 'Test', steps: [{ id: 's', kind: 'image', model: 'flux', prompt: 'x' }] }).success).toBe(true);
    expect(confirmSettingsSchema.safeParse({ parts: [{ kind: 'image', model: 'flux', user_requested: true }] }).success).toBe(true);
  });
});

it('rejects an image-only model for a video before confirming any selection', async () => {
  const result = await buildSettings({ kind: 'video', purpose: 'normal', refs: 0, count: 1, startImage: false, model: 'atlas::still' }, {
    getModel: async () => ({ model: { ref: 'atlas::still', name: 'Still', kind: 'image' } as ModelSummary, schema: { ref: 'atlas::still', source: 'catalog', slots: { prompt: 'prompt' }, params: [] } as ModelSchema }),
    suggestModel: () => undefined, composerChosen: () => true, routeModel: () => undefined, defaultModel: () => 'atlas::still',
  });
  expect(result).toHaveProperty('error');
});
