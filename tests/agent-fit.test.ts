import { describe, expect, it } from 'vitest';
import { fitAngle, fitAspect, fitContactAngles, fitOp, fitPanels, fitUpscale } from '../src/engine/agent/fit';

const value = (r: ReturnType<typeof fitOp>, key: string) => (r.ok ? r.params[key] : `NOT OK: ${r.ok ? '' : r.reason}`);

describe('angle takes a value from the request, or the first angle not made yet', () => {
  it('names the angle when the request does', () => {
    expect(value(fitAngle('muéstrame desde arriba'), 'angle')).toBe('high');
    expect(value(fitAngle('un contrapicado de la escena'), 'angle')).toBe('low');
    expect(value(fitAngle('de espaldas, por favor'), 'angle')).toBe('back');
    expect(value(fitAngle('primer plano de la cara'), 'angle')).toBe('close-up');
  });

  it('"un ángulo diferente" picks an angle not made yet from this image', () => {
    expect(value(fitAngle('quiero un ángulo diferente', ['three-quarter-left']), 'angle')).toBe('profile-left');
  });

  it('with no angle named and none made, the first in the order', () => {
    expect(value(fitAngle('dame otro ángulo'), 'angle')).toBe('three-quarter-left');
  });

  it('fails only when every angle was already made', () => {
    const all = ['three-quarter-left', 'profile-left', 'back', 'high', 'low', 'close-up', 'wide', 'three-quarter-right', 'profile-right', 'top-down', 'front'];
    expect(fitAngle('otro ángulo', all).ok).toBe(false);
  });
});

describe('reframe takes a format: named, a platform, or another one than the source', () => {
  it('uses an explicit ratio', () => {
    expect(value(fitAspect('adapta esta imagen a 9:16'), 'aspect')).toBe('9:16');
  });

  it('reads Instagram as the feed post (4:5) and stories or reels as 9:16', () => {
    expect(value(fitAspect('cambia la imagen en formato para instagram'), 'aspect')).toBe('4:5');
    expect(value(fitAspect('pásala a formato de historia de instagram'), 'aspect')).toBe('9:16');
    expect(value(fitAspect('para reels'), 'aspect')).toBe('9:16');
  });

  it('"otro aspecto" with no value picks a format other than the source\'s', () => {
    expect(value(fitAspect('quiero otro aspecto', '16:9'), 'aspect')).toBe('4:5');
    expect(value(fitAspect('quiero otro aspecto', '4:5'), 'aspect')).toBe('9:16');
  });
});

describe('upscale takes its factor from the target size and the source image', () => {
  it('a 4K target from a 1K source is ×4', () => {
    expect(value(fitUpscale('pásala a 4K', 1024), 'factor')).toBe('4');
  });

  it('a 4K target from a 2K source is ×2', () => {
    expect(value(fitUpscale('pásala a 4K', 2048), 'factor')).toBe('2');
  });

  it('a 4K target from 1536 px is ×2 (nearest on a log scale)', () => {
    expect(value(fitUpscale('pásala a 4K', 1536), 'factor')).toBe('2');
  });

  it('an explicit factor is used as written', () => {
    expect(value(fitUpscale('upscale x4'), 'factor')).toBe('4');
  });

  it('4K needs the source size; without it the request does not fit', () => {
    expect(fitUpscale('pásala a 4K').ok).toBe(false);
  });

  it('an image already at the target size does not fit', () => {
    expect(fitUpscale('pásala a 4K', 3840).ok).toBe(false);
  });
});

describe('reference sheet and contact sheet take their count', () => {
  it('turnaround: 3 views unless 4 are named', () => {
    expect(value(fitPanels('hazme tres vistas de este personaje'), 'panels')).toBe('3');
    expect(value(fitPanels('cuatro vistas de este personaje'), 'panels')).toBe('4');
    expect(value(fitPanels('dos vistas de este personaje'), 'panels')).toBe('3');
  });

  it('contact sheet: 9 angles unless 6 are named', () => {
    expect(value(fitContactAngles('dame múltiples ángulos'), 'angles')).toBe('9');
    expect(value(fitContactAngles('seis ángulos de la escena'), 'angles')).toBe('6');
    expect(value(fitContactAngles('nueve ángulos'), 'angles')).toBe('9');
  });
});
