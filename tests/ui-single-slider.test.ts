import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * One source of truth for the Designer's controls (InlineControls.tsx): a number is an InlineSlider, an on/off an
 * InlineToggle, a colour an InlineColor, a short list an InlineSelect. A panel that drew its own slider or colour
 * input would look and behave differently from every other one.
 */
const list = (dir: string): string[] | null => { try { return readdirSync(dir); } catch { return null; } };
const designer = (list('src/components/designer') ?? []).filter((f) => f.endsWith('.tsx'));

describe('the Designer draws its controls from InlineControls', () => {
  // InlineColor's own picker draws its colour tracks (ColorChannels) and plane: they are part of that one control.
  const SHARED = ['InlineControls.tsx', 'ColorChannels.tsx', 'ColorPlane.tsx'];
  it('no component but InlineControls (and its colour picker) renders a Range, a range input or a native colour input', () => {
    const offenders = designer.filter((f) => !SHARED.includes(f)).filter((f) => {
      const src = readFileSync(join('src/components/designer', f), 'utf8');
      return /<Range\b|type="range"|type=\{?["']range["']\}?|type="color"/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});
