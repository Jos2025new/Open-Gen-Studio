// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { docToSvg, type SvgDeps } from '../src/engine/design/export';
import { exportFileNames, validateExport } from '../src/engine/design/exportJob';
import { DEFAULT_EXPORT } from '../src/engine/design/exportSettings';
import type { DesignDoc } from '../src/engine/types';

const doc = { id: 'd', name: 'Design', width: 100, height: 100, background: null, activeLayerId: 'text', createdAt: 0, updatedAt: 0,
  layers: [{ id: 'text', name: 'Text', type: 'text', visible: true, locked: false, opacity: 1, blend: 'normal', x: 0, y: 0, width: 100, text: ' ', fontFamily: 'Inter', fontSize: 12, fontWeight: 400, color: '#000', align: 'left', lineHeight: 1, letterSpacing: 0 }] } as DesignDoc;
const deps: SvgDeps = { rasterHref: async () => null, layout: () => ({ lines: [' '], width: 100, lineHeightPx: 12 }), ascent: () => 10 };

describe('adversarial export edge cases', () => {
  it('preserves whitespace in text when minifying SVG', async () => {
    const svg = await docToSvg(doc, deps, undefined, { minify: true });
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(parsed.querySelector('tspan')?.textContent).toBe(' ');
  });
  it('keeps a custom output suffix within one filename', () => {
    const settings = { ...DEFAULT_EXPORT, outputs: [{ scale: 1, suffix: '/draft', format: 'png' as const }] };
    expect(exportFileNames(settings, 'Design')[0]).not.toMatch(/[/\\]/);
  });
  it('rejects an invalid size limit when a JPG is in multiple outputs', () => {
    const settings = { ...DEFAULT_EXPORT, maxKb: -1, outputs: [{ scale: 1, suffix: '', format: 'jpg' as const }] };
    expect(() => validateExport(doc, settings, {})).toThrow(/size limit/i);
  });
  it('preserves a normal output suffix', () => {
    const settings = { ...DEFAULT_EXPORT, outputs: [{ scale: 2, suffix: '@2x', format: 'png' as const }] };
    expect(exportFileNames(settings, 'Design')).toEqual(['Design@2x.png']);
  });
});
