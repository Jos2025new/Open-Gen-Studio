import { describe, expect, it } from 'vitest';
import type { Layer } from '../src/engine/types';
import { clickCandidate } from '../src/engine/design/autoSelect';

const top = { id: 'top' } as unknown as Layer;
const active = { id: 'active' } as unknown as Layer;

describe('click target (Auto-select)', () => {
  it('off: the selected layer when the click lands on its content', () => {
    expect(clickCandidate(false, top, active, () => true)).toBe(active);
  });
  it('off: a click outside the selected layer picks nothing, so the selection stays', () => {
    expect(clickCandidate(false, top, active, () => false)).toBeNull();
  });
  it('on: the topmost layer under the pointer, even when another layer is selected', () => {
    expect(clickCandidate(true, top, active, () => false)).toBe(top);
    expect(clickCandidate(true, null, active, () => true)).toBeNull();
  });
});
