import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EditModeOptions } from '../src/components/designer/ToolSettings';

// The view gets the mode as a prop: the store is not read here (server rendering would show its initial value).
const render = (mode: 'objects' | 'layers', objects: boolean) => renderToStaticMarkup(createElement(EditModeOptions, { mode, objects }));
const button = (html: string, label: string) => new RegExp(`<button[^>]*>${label}</button>`).exec(html)?.[0] ?? '';

describe('Edit: Object and Layer are always there', () => {
  it('both show on a vector layer, Object enabled', () => {
    const html = render('objects', true);
    expect(button(html, 'Object')).not.toBe('');
    expect(button(html, 'Layer')).not.toBe('');
    expect(button(html, 'Object')).not.toContain('disabled');
  });
  it('Object shows disabled with its reason where there are no single objects', () => {
    const html = render('objects', false);
    expect(button(html, 'Object')).toContain('disabled');
    expect(button(html, 'Object')).toContain('Object needs editable strokes or shapes; the active raster layer has none. Choose Layer to work with the whole layer.');
    expect(button(html, 'Object')).toContain('aria-description=');
    expect(button(html, 'Object')).toContain('title=');
    expect(button(html, 'Layer')).not.toContain('disabled');
  });
  it('the chosen mode is what shows as pressed, and it is not changed to Layer by the missing objects', () => {
    expect(render('objects', false)).toMatch(/aria-checked="true"[^>]*>Object</);
    expect(render('layers', false)).toMatch(/aria-checked="true"[^>]*>Layer</);
    expect(render('objects', true)).toMatch(/aria-checked="true"[^>]*>Object</);
  });
});
