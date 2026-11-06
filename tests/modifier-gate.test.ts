import { describe, expect, it } from 'vitest';
import { combineFrom, markDown, shapeMods } from '../src/engine/design/modifierGate';
import { SELECT_SHAPES } from '../src/engine/design/selectShape';

const m = (shift = false, alt = false, ctrl = false) => ({ shift, alt, ctrl });

describe('modifier gate', () => {
  it('a key held at pointer down is the mode, not the shape, until it is pressed anew', () => {
    markDown({ shiftKey: true, altKey: false, ctrlKey: false });
    expect(shapeMods(m(true, false))).toEqual(m());
    expect(shapeMods(m(true, true))).toEqual(m(false, true));
    markDown({ shiftKey: false, altKey: false, ctrlKey: false, metaKey: true });
    expect(shapeMods(m(true, false, true))).toEqual(m(true));
  });
  it('how a selection combines: Shift+Alt intersects, Alt subtracts, Shift adds, else the chosen Mode', () => {
    expect(combineFrom({ shift: true, alt: true }, 'replace')).toBe('intersect');
    expect(combineFrom({ shift: false, alt: true }, 'add')).toBe('subtract');
    expect(combineFrom({ shift: true, alt: false }, 'subtract')).toBe('add');
    expect(combineFrom({ shift: false, alt: false }, 'subtract')).toBe('subtract');
  });
  it('the Select family shapes keep the ids already stored', () => {
    expect(SELECT_SHAPES).toEqual(['rect', 'ellipse', 'lasso', 'polygon', 'wand']);
  });
});
