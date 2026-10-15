import { describe, expect, it } from 'vitest';
import { rolesPhrase, splitRefs } from '../src/engine/refRoles';

describe('ref roles', () => {
  it('plain string refs still work', () => {
    expect(splitRefs(['a', 'b'])).toEqual({ ids: ['a', 'b'], roles: [], problems: [] });
  });
  it('phrase with positional names when the model has no syntax', () => {
    const { ids, roles } = splitRefs([{ ref: 'a', role: 'identity' }, { ref: 'b', role: 'pose' }]);
    expect(rolesPhrase('some/image-model', ids, roles)).toBe('Image 1 = identity: keep face and body. Image 2 = pose reference only: do not copy its identity or background.');
  });
  it('uses the model mention syntax', () => {
    expect(rolesPhrase('bytedance/seedance-2', ['a'], [{ ref: 'a', role: 'style' }])).toBe('@Image1 = style reference only: do not copy its subject or content.');
  });
  it('rejects a role without ref', () => {
    expect(splitRefs([{ ref: '', role: 'pose' }]).problems).toHaveLength(1);
  });
});
