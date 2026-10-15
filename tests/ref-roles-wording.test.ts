import { describe, expect, it } from 'vitest';
import { OPS } from '../src/engine/ops';

describe('change/keep wording', () => {
  it('contact sheet keeps identity but lets camera and shadows change', () => {
    const t = OPS.contact_sheet.instruction({});
    expect(t).toContain('Keep the identity, face, clothing, materials and colors of the subject consistent; the camera position, pose visibility, shadows and occlusions may change.');
  });
  it('angle no longer freezes lighting', () => {
    const t = OPS.angle.instruction({ angle: 'close-up' });
    expect(t).not.toContain('lighting and style');
    expect(t).toContain('let shadows adapt to the new viewpoint');
  });
});
