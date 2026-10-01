import { describe, expect, it } from 'vitest';
import { guideIndex, readGuide, workflowById } from '../src/engine/skills';

describe('archviz workflows and skills', () => {
  it('lists the workflows and loads their skills by step', () => {
    const index = guideIndex();
    for (const id of ['workflow:archviz-render', 'workflow:archviz-walkthrough', 'workflow:archviz-tour', 'workflow:archviz-sketch', 'skill:archviz', 'skill:archviz-motion', 'skill:archviz-sketch']) expect(index).toContain(id);
    const tour = readGuide('workflow:archviz-tour')!;
    expect(tour).toContain('skill:archviz-motion for each clip');
    expect(tour).toContain('join_clips');
    expect(readGuide('skill:archviz')).toMatch(/straight vertical/);
    expect(readGuide('skill:archviz-motion')).toMatch(/One camera move per clip/);
    expect(readGuide('skill:archviz-sketch')).toMatch(/massing/);
  });
  it('tour clips start from their views and are joined in order', () => {
    const w = workflowById('archviz-tour')!;
    const join = w.steps.find((s) => s.op === 'join_clips')!;
    expect([join.input, ...(join.more ?? [])]).toEqual(['v1', 'v2', 'v3', 'v4']);
    expect(w.steps.filter((s) => s.kind === 'video').every((s) => s.firstFrame)).toBe(true);
    expect(readGuide('workflow:archviz-render/set')).toContain('Terrace');
  });
});
