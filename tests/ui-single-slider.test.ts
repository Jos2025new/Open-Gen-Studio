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
  // An on/off setting in a bar or panel is an InlineToggle; native checkboxes only in menus, dialogs and popovers
  // (SnapControl, CanvasSize, DrawingChoice, AlignControls, and No fill / No stroke inside InlineColor's picker).
  it('settings use InlineToggle, not a native checkbox', () => {
    for (const f of ['ToolSettings.tsx', 'BrushSettings.tsx', 'LayersPanel.tsx']) {
      const src = readFileSync(join('src/components/designer', f), 'utf8').replace(/<InlineColor\b[\s\S]*?<\/InlineColor>/g, '');
      expect(src, f).not.toMatch(/type="checkbox"/);
    }
  });
  // One look for every field (ADR 0013, ADR 0024 M): fill, outline and corners come from the --field-* tokens, never a surface set by hand.
  it('field rules take their background, border and radius from the --field-* tokens', () => {
    const css = ['designer.css', 'designer-connected.css'].map((f) => readFileSync(join('src/styles', f), 'utf8')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
    const field = /(^|[\s,>])\.(opt|tool-setting)(\.(opt-slider|opt-toggle|opt-choice|opt-presets|opt-color|opt-pick|opt-[\w-]+|is-icon|is-on))*(:not\([^)]*\))?$|(^|[\s>])\.(opt-color|opt-pick)$/;
    // The tool rail's quick palette is the one flat exception: its fields sit on the rail with no fill of their own.
    const FLAT = ['.palette-quick .opt'];
    const bad: string[] = [];
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sels = m[1].split(',').map((x) => x.trim());
      if (!sels.some((x) => field.test(x)) || sels.every((x) => FLAT.includes(x))) continue;
      for (const d of m[2].split(';')) {
        const [k, v] = d.split(':').map((x) => x?.trim());
        const ok = !v || v.includes('--field-') || v.includes('--active-') || ['none', '0', 'transparent'].includes(v) || /50%/.test(v);
        if (['background', 'border-radius', 'border', 'border-color'].includes(k) && !ok) bad.push(`${sels.join(', ')} { ${k}: ${v} }`);
      }
    }
    expect(bad).toEqual([]);
  });
});
