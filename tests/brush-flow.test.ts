import { describe, expect, it } from 'vitest';
import { DAB_DEFAULTS } from '../src/engine/design/brushEngine';
import { flowBlocked, flowOf, withFlow, FLOW_SPACING } from '../src/engine/design/brushFlow';
import { applyBrushPreset, PENCIL_PRESETS, presetEdited } from '../src/engine/design/brushPresets';

describe('flow', () => {
  it('reads 100 % without dabs and the dabs\' own flow with them', () => {
    expect(flowOf({})).toBe(1);
    expect(flowOf({ dabFlow: 0.2 })).toBe(1);
    expect(flowOf({ dabs: true })).toBe(DAB_DEFAULTS.flow);
    expect(flowOf({ dabs: true, dabFlow: 0.2 })).toBe(0.2);
  });

  it('turns Dabs on when it drops under 100 %', () => {
    expect(withFlow({}, 0.4)).toEqual({ dabs: true, dabSpacing: FLOW_SPACING, dabFlow: 0.4 });
  });

  it('changes nothing at 100 % without dabs, and keeps Dabs on when it returns to 100 %', () => {
    expect(withFlow({}, 1)).toEqual({});
    expect(withFlow({ dabs: true, dabFlow: 0.3 }, 1)).toEqual({ dabFlow: 1 });
  });

  it('keeps the dabs\' own spacing and clamps the value', () => {
    expect(withFlow({ dabs: true, dabSpacing: 0.5 }, 0.5)).toEqual({ dabFlow: 0.5 });
    expect(withFlow({ dabs: true }, 0)).toEqual({ dabFlow: 0.01 });
    expect(withFlow({ dabs: true }, 7)).toEqual({ dabFlow: 1 });
    expect(withFlow({ dabs: true }, NaN)).toEqual({});
  });

  it('is blocked for measured graphite', () => {
    const lead = { lead: 'HB' as never };
    expect(flowBlocked(lead)).toBe(true);
    expect(withFlow(lead, 0.4)).toEqual({});
    expect(flowBlocked({})).toBe(false);
  });

  it('marks the active preset as edited, like any other change', () => {
    const plain = PENCIL_PRESETS.find((p) => !p.values.dabs && !p.values.lead)!;
    const base = applyBrushPreset({}, plain);
    expect(presetEdited(base, plain)).toBe(false);
    expect(presetEdited({ ...base, ...withFlow(base, 0.5) }, plain)).toBe(true);
  });
});
