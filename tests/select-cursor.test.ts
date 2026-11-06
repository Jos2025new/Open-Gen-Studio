import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SelectCursor } from '../src/components/designer/SelectCursor';

const view = { x: 10, y: 20, zoom: 2 };
const show = (tool: string, mods: { shift: boolean; alt: boolean }, point: { x: number; y: number } | null = { x: 5, y: 5 }) => renderToStaticMarkup(createElement(SelectCursor, { tool, point, view, mods }));

describe('Select cursor badge', () => {
  it('shows what a press would do (Mode New): + with Shift, − with Alt, ∩ with both, nothing for New', () => {
    expect(show('select', { shift: false, alt: false })).toBe('');
    expect(show('select', { shift: true, alt: false })).toContain('data-select-cursor="+"');
    expect(show('select', { shift: false, alt: true })).toContain('data-select-cursor="−"');
    expect(show('select', { shift: true, alt: true })).toContain('data-select-cursor="∩"');
  });
  it('follows the pointer, and only in Select', () => {
    const html = show('select', { shift: true, alt: true });
    expect(html).toContain(`translate(${10 + 5 * 2 + 10}px, ${20 + 5 * 2 + 10}px)`);
    expect(show('brush', { shift: true, alt: false })).toBe('');
    expect(show('select', { shift: true, alt: false }, null)).toBe('');
  });
});
