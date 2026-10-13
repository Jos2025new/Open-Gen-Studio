import { describe, expect, it } from 'vitest';
import { layerSelection, pickLayer, pickedLayers } from '../src/engine/design/selection';
import { objectPick, pickObject } from '../src/engine/design/objectSelection';

// Photoshop, Inkscape, Figma: a plain click selects only what was clicked; Shift toggles; a click on empty clears;
// dragging a member of a multiple selection moves the whole selection without changing it.
const order = ['A', 'B', 'C'];

describe('plain click replaces the layer selection', () => {
  it('click A, then click B: only B is selected (the active layer is not added to the old pick)', () => {
    pickLayer('d1', 'A', false, []);            // click A
    pickLayer('d1', 'B', false, []);            // click B: Stage's plain-click path
    expect(layerSelection('d1', 'B', order)).toEqual(['B']);
  });
  it('the same with the active layer changed first (Stage sets the active layer before the pick)', () => {
    pickLayer('d2', 'A', false, []);
    expect(layerSelection('d2', 'B', order)).toEqual(['A']); // the picks stay until the click picks B
    pickLayer('d2', 'B', false, pickedLayers('d2', order));
    expect(layerSelection('d2', 'B', order)).toEqual(['B']);
  });
  it('a click on empty canvas clears the selection', () => {
    pickLayer('d3', 'A', false, []);
    pickLayer('d3', '', false, pickedLayers('d3', order));
    expect(layerSelection('d3', null, order)).toEqual([]);
  });
});

describe('Shift-click toggles, Ctrl-click keeps its behavior', () => {
  it('Shift adds, then takes out again', () => {
    expect(pickLayer('d4', 'B', true, ['A'])).toEqual(['A', 'B']);
    expect(pickLayer('d4', 'B', true, ['A', 'B'])).toEqual(['A']);
  });
});

describe('dragging a multiple selection keeps it', () => {
  it('the raw picks show the members; the group is only what was picked', () => {
    pickLayer('d5', 'A', false, []);
    pickLayer('d5', 'B', true, pickedLayers('d5', order));
    expect(pickedLayers('d5', order)).toEqual(['A', 'B']);
    expect(layerSelection('d5', 'B', order)).toEqual(['A', 'B']);
  });
});

describe('objects: a plain click replaces the object pick', () => {
  it('a plain pick in another layer leaves only that object', () => {
    pickObject('d6', 'A', 'o1', false);
    pickObject('d6', 'B', 'o2', false);
    expect(objectPick('d6')).toEqual({ layerId: 'B', ids: ['o2'] });
  });
});

import { clickCandidate } from '../src/engine/design/autoSelect';
describe('Auto-select on and off keep the plain-click rule', () => {
  const top = { id: 'B' } as never, active = { id: 'A' } as never;
  it('on: the topmost layer under the press is the one picked', () => {
    expect(clickCandidate(true, top, active, () => false)).toBe(top);
  });
  it('off: the selected layer; a press outside its content picks nothing', () => {
    expect(clickCandidate(false, top, active, () => true)).toBe(active);
    expect(clickCandidate(false, top, active, () => false)).toBeNull();
  });
});
