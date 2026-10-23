import { describe, expect, it } from 'vitest';
import { TOOL_NAMES } from '../src/engine/shortcuts';
import { initialToolboxState, reduceToolboxState, TOOLBOXES, toolboxTools } from '../src/components/designer/toolboxModel';

describe('toolbox model', () => {
  it('places every implemented designer tool exactly once across the two modes', () => {
    const tools = toolboxTools();
    expect(new Set(tools).size).toBe(tools.length);
    expect([...tools].sort()).toEqual(Object.keys(TOOL_NAMES).sort());
  });

  it('keeps unavailable tools as named, explained variants without assigning invented tools', () => {
    const variants = Object.values(TOOLBOXES).flatMap((families) => families.flatMap((family) => family.variants));
    const soon = variants.filter((variant) => variant.soon);
    expect(soon.length).toBeGreaterThan(0);
    expect(soon.every((variant) => !variant.tool && variant.soon!.length > 0)).toBe(true);
    expect(variants.find((variant) => variant.id === 'ruler-perspective')?.rulerKind).toBe('perspective');
  });

  it('reduces the three dock depths and retains the active variant on Escape', () => {
    const opened = reduceToolboxState(initialToolboxState, { type: 'family', familyId: 'brush' });
    expect(opened).toEqual({ familyId: 'brush', variantId: null, depth: 'folded' });
    const card = reduceToolboxState(opened, { type: 'variant', familyId: 'brush', variantId: 'pencil' });
    expect(card).toEqual({ familyId: 'brush', variantId: 'pencil', depth: 'open' });
    expect(reduceToolboxState(card, { type: 'escape' })).toEqual({ ...card, depth: 'folded' });
    const folded = reduceToolboxState(card, { type: 'family', familyId: 'brush' });
    expect(folded.depth).toBe('closed');
    expect(reduceToolboxState(folded, { type: 'family', familyId: 'brush' }).depth).toBe('folded');
  });
});
