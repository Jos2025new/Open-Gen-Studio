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

import { OPS } from '../src/engine/ops';
import { OP_REF_ROLES } from '../src/engine/refRoles';

describe('ops with roles', () => {
  it('relight, edit and replace_background take the right roles', () => {
    expect(OP_REF_ROLES.relight).toEqual(['lighting']);
    expect(OP_REF_ROLES.edit).toEqual(['pose', 'expression', 'clothing']);
    expect(OP_REF_ROLES.replace_background).toEqual(['background']);
  });
  it('lighting phrase for a relight ref (source is Image 1)', () => {
    expect(rolesPhrase('x/y', ['src', 'l'], [{ ref: 'l', role: 'lighting' }])).toBe('Image 2 = lighting reference only: match its light, do not copy its content.');
  });
  it('replace_background wording', () => {
    const t = OPS.replace_background.instruction!({ background: 'a rainy street.' });
    expect(t).toContain('Replace only the background, with this new background: a rainy street.');
    expect(t).toContain('contact shadows and reflected light');
    expect(OPS.replace_background.instruction!({ background: '' })).toContain('with the setting of the background reference');
  });
});

import { detectOps } from '../src/engine/agent/triggers';
it('replace_background is detected from the request', () => {
  expect(detectOps('cambia el fondo por una calle')).toContain('replace_background');
});

import { placeRoles } from '../src/engine/refRoles';
describe('placeRoles', () => {
  it('flux and video: after the first sentence', () => {
    expect(placeRoles('Image 1 = identity: keep face and body. ', 'A woman runs. Rain falls.', 'fal::flux-2', 'image')).toBe('A woman runs. Image 1 = identity: keep face and body. Rain falls.');
    expect(placeRoles('R. ', 'A woman runs. Rain.', 'x', 'video')).toBe('A woman runs. R. Rain.');
  });
  it('others: first', () => expect(placeRoles('R. ', 'A woman runs.', 'gpt-image', 'image')).toBe('R. A woman runs.'));
});
