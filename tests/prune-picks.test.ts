import { describe, expect, it } from 'vitest';
import { prunePicks } from '../src/engine/design/actions';
import { useLayerSelection } from '../src/engine/design/selection';
import { objectPick, setObjectPick } from '../src/engine/design/objectSelection';
import type { DesignDoc } from '../src/engine/types';

describe('undo/redo prune stale picks (monkey seed 303)', () => {
  it('drops picked layers and objects the restored document no longer has', () => {
    const doc = { id: 'd1', layers: [{ id: 'keep', type: 'raster' }] } as unknown as DesignDoc;
    useLayerSelection.setState({ byDoc: { d1: ['keep', 'gone'] } });
    setObjectPick('d1', { layerId: 'gone', ids: ['rst_x'] });
    prunePicks(doc);
    expect(useLayerSelection.getState().byDoc.d1).toEqual(['keep']);
    expect(objectPick('d1')).toBeNull();
  });
});
