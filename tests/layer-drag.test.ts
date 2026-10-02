import { describe, expect, it } from 'vitest';
import { dropIndex } from '../src/engine/design/doc';

// 4 layers stored bottom first [A,B,C,D]; the list shows them top first: D(0) C(1) B(2) A(3).
describe('drag to reorder layers', () => {
  it('maps a drop gap in the list to the stored index', () => {
    expect(dropIndex(4, 3, 0)).toBe(3); // A dragged above D → top
    expect(dropIndex(4, 0, 4)).toBe(0); // D dragged below A → bottom
    expect(dropIndex(4, 0, 2)).toBe(2); // D dropped between C and B → just under C
    expect(dropIndex(4, 1, 1)).toBeNull(); // dropped where it was
    expect(dropIndex(4, 1, 2)).toBeNull(); // the gap right below itself
  });
});
