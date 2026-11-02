import { describe, expect, it } from 'vitest';
import { tipFor } from '../src/engine/design/brushEngine';
import { activePreset, applyBrushPreset, PENCIL_PRESETS, type PresetValues } from '../src/engine/design/brushPresets';
import { TOOLBOX } from '../src/components/designer/toolboxModel';

const KEYS: Array<keyof PresetValues> = ['size', 'hardness', 'minSize', 'minDensity', 'pressureSize', 'pressureDensity', 'simulatePressure', 'pressureSpeed', 'taperStart', 'taperEnd', 'texture', 'textureStrength', 'roundness', 'angle', 'follow', 'blend', 'keepOpacity', 'opacity', 'smoothing', 'stabilization'];
const preset = (id: string) => PENCIL_PRESETS.find((p) => p.id === id)!;

describe('pencil brush presets', () => {
  it('every preset sets every field, with pressure on', () => {
    expect(PENCIL_PRESETS).toHaveLength(8);
    for (const p of PENCIL_PRESETS) {
      for (const k of KEYS) expect(p.values[k], `${p.id}.${k}`).not.toBeUndefined();
      expect(p.values.pressureSize && p.values.pressureDensity).toBe(true);
    }
  });
  it('keeps the color and other settings', () => {
    const out = applyBrushPreset({ size: 9, color: '#ff0000', opacity: 1, mirror: true }, preset('pencil-hb'));
    expect(out.color).toBe('#ff0000');
    expect(out.mirror).toBe(true);
    expect(out.size).toBe(5);
  });
  it('switching from 4B to 2H leaves no 4B value', () => {
    const out = applyBrushPreset(applyBrushPreset({ size: 1, color: '#000000', opacity: 1 }, preset('pencil-4b')), preset('pencil-2h'));
    for (const k of KEYS) expect(out[k], k).toEqual(preset('pencil-2h').values[k]);
    expect(activePreset(out)?.id).toBe('pencil-2h');
    expect(activePreset({ ...out, size: 7 })).toBeUndefined();
  });
  it('tipFor gives a valid tip for each preset', () => {
    for (const p of PENCIL_PRESETS) {
      const tip = tipFor(applyBrushPreset({ color: '#000000' }, p), false);
      expect(tip.hardness).toBe(p.values.hardness);
      expect(tip.texture).toBe(p.values.texture);
      expect(tip.densities).toEqual([]);
      if (p.values.roundness < 1) expect(tip.roundness).toBe(p.values.roundness);
    }
  });
  it('the toolbox pencil variant is the HB preset', () => {
    const v = TOOLBOX.find((f) => f.id === 'brush')!.variants.find((x) => x.id === 'pencil')!;
    expect(v.preset).toBe('pencil');
    expect(PENCIL_PRESETS[1].id).toBe('pencil-hb');
  });
});
