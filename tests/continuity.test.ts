import { describe, expect, it } from 'vitest';
import { continuityErrors } from '../src/engine/continuity';
import type { PlanStep } from '../src/engine/types';
const image = (id: string, refs: string[] = [], prompt = 'Same subject'): PlanStep => ({ id, kind: 'image', title: id, prompt, modelRef: 'local::image', settings: { count: 1, advanced: {} }, refs });
describe('declared preservation through actual content inputs', () => {
  it.each(['character identity', 'building geometry', 'product label'])('%s rejects independent text generations and accepts a shared source', preserve => {
    const group = [{ source: 's1', preserve, steps: ['s2', 's3'] }];
    const disconnected = [image('s1'), image('s2'), image('s3')];
    expect(continuityErrors(group, disconnected)).toHaveLength(2);
    expect(continuityErrors(group, [image('s1'), image('s2', ['s1']), image('s3', ['s1'])])).toEqual([]);
  });
  it('accepts a scene-derived video; first frames from independent scenes fail', () => {
    const video = { id: 'clip', kind: 'video', title: 'clip', prompt: '', modelRef: 'local::video', settings: { count: 1, advanced: {} }, firstFrame: 'scene' } as PlanStep;
    const group = [{ source: 'asset:original', preserve: 'identity', steps: ['scene', 'clip'] }];
    expect(continuityErrors(group, [image('scene'), video])).toHaveLength(2);
    expect(continuityErrors(group, [image('scene', ['asset:original']), video])).toEqual([]);
  });
  it('does not confuse scheduling or text with a content reference', () => {
    const step = { ...image('s2'), after: ['s1'], promptFrom: 's1' };
    expect(continuityErrors([{ source: 's1', preserve: 'identity', steps: ['s2'] }], [image('s1'), step])).toHaveLength(1);
  });
  it('supports temporary named subjects, without a save operation', () => {
    expect(continuityErrors([{ source: 's1', preserve: 'identity', steps: ['s2'] }], [image('s1'), image('s2', [], '@Hero in another setting')], [{ name: 'Hero', from: 's1' }])).toEqual([]);
  });
  it('does not constrain unrelated outputs or deliberately changed properties', () => {
    expect(continuityErrors([], [image('a'), image('b')])).toEqual([]);
    expect(continuityErrors([{ source: 'a', preserve: 'shape, not material', steps: ['b'] }], [image('a'), image('b', ['a']), image('unrelated')])).toEqual([]);
  });
  it('rejects an unknown consumer, a self-source and the wrong candidate', () => {
    for (const target of ['missing', 's1', 's2']) {
      expect(continuityErrors([{ source: 's1', preserve: 'identity', steps: [target] }], [image('s1'), image('s2', ['s1#2'])])).toHaveLength(1);
    }
  });
});
