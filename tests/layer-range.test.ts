import { describe, expect, it } from 'vitest';
import { layerSelection, pickLayer, pickLayerRange } from '../src/engine/design/selection';

describe('layers panel: Shift-click picks a range', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];
  it('from the active layer to the clicked one, either direction', () => {
    expect(pickLayerRange('doc', 'b', 'd', order)).toEqual(['b', 'c', 'd']);
    expect(pickLayerRange('doc', 'e', 'c', order)).toEqual(['c', 'd', 'e']);
    expect(layerSelection('doc', 'e', order)).toEqual(['c', 'd', 'e']);
  });
  it('Ctrl-click still adds or removes one', () => {
    const cur = pickLayerRange('doc', 'a', 'b', order);
    expect(pickLayer('doc', 'd', true, cur)).toEqual(['a', 'b', 'd']);
    expect(pickLayer('doc', 'a', true, ['a', 'b', 'd'])).toEqual(['b', 'd']);
  });
});
