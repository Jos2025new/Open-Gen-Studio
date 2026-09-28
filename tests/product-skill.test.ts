import { describe, expect, it } from 'vitest';
import { OPS } from '../src/engine/ops';
import { activeSkill, readGuide, skillById, workflowById } from '../src/engine/skills';

describe('product photography skill and workflow', () => {
  it('the full guide comes only through read_guide; the per-message guidance stays short and points to it', () => {
    const skill = skillById('product')!;
    expect(skill.guide).toMatch(/Product sheet first/);
    expect(skill.guidance).not.toContain(skill.guide!);
    expect(skill.guidance).toMatch(/Load skill:product/);
    const text = readGuide('skill:product')!;
    expect(text).toMatch(/^Product photography:/);
    expect(text).toMatch(/color temperature in K/);
    expect(text).toMatch(/Second pass \(optional/);
  });

  it('default set is hero, lifestyle, detail and features, every later shot referencing the hero', () => {
    const w = workflowById('product-pack')!;
    expect(activeSkill(null, w.id)?.id).toBe('product');
    expect(w.steps.map((s) => s.title)).toEqual(['Hero shot', 'Lifestyle', 'Macro detail', 'Features shot']);
    for (const s of w.steps.slice(1)) expect(s.refs).toEqual(['s1']);
    expect(w.needs!.join(' ')).toMatch(/destination.*sets the aspect/);
    expect(w.needs!.filter((n) => /"No" \(recommended\)/.test(n))).toHaveLength(2);
  });

  it('every variant loads with its own steps and uses valid ops and params', () => {
    const w = workflowById('product-pack')!;
    const ids = w.variants!.map((v) => v.id);
    expect(ids).toEqual(['packshot', 'lifestyle', 'closeup', 'pinterest', 'hero-banner', 'carousel', 'ad-pack', 'try-on', 'conceptual', 'restyle']);
    for (const v of w.variants!) {
      expect(readGuide(`workflow:product-pack/${v.id}`), v.id).toMatch(new RegExp(`Product photoshoot · ${v.name}`));
      for (const s of v.steps ?? []) {
        if (s.kind !== 'op') continue;
        const op = OPS[s.op as keyof typeof OPS];
        expect(op, `${v.id}/${s.op}`).toBeDefined();
        for (const [k, val] of Object.entries(s.params ?? {})) {
          const field = op.fields.find((f) => f.key === k);
          expect(field, `${v.id}/${s.op}.${k}`).toBeDefined();
          if (field!.type === 'choice') expect(field!.options!.map((o) => o.value), `${v.id}/${s.op}.${k}`).toContain(val);
        }
      }
    }
  });
});
