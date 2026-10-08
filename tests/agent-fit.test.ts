import { describe, expect, it } from 'vitest';
import { ASPECT_OPTIONS, fitAngle, fitAspect, fitContactAngles, fitOp, fitPanels, fitUpscale } from '../src/engine/agent/fit';
import { OPS } from '../src/engine/ops';

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

  it('"historia" alone is a story in the narrative sense, not a format', () => {
    expect(value(fitAspect('quiero otro aspecto para mi historia', '16:9'), 'aspect')).toBe('4:5');
  });

  it('the formats it picks from are the reframe operation\'s own options', () => {
    expect(ASPECT_OPTIONS).toEqual(OPS.reframe.fields.find((f) => f.key === 'aspect')!.options!.map((o) => String(o.value)));
  });

  it('Instagram alone is ambiguous (feed 4:5 or stories 9:16): the agent asks', () => {
    expect(fitAspect('cambia la imagen en formato para instagram').ok).toBe(false);
  });

  it('Instagram with "post" or "feed" is the feed, 4:5; stories and reels are 9:16', () => {
    expect(value(fitAspect('haz un post de instagram con esta imagen'), 'aspect')).toBe('4:5');
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

describe('a reference sheet is a sheet, for a character, a person or an object, never a place', () => {
  it('a place is refused outright (an impossibility, not a question)', () => {
    expect(fitOp('reference_sheet', 'hoja de la ciudad')).toMatchObject({ ok: false });
    expect(fitOp('reference_sheet', 'hoja de la ciudad')).not.toHaveProperty('ambiguous', true);
  });

  it('a sheet of a character, or of a person, fits with its views', () => {
    expect(fitOp('reference_sheet', 'hoja de personaje con tres vistas de este personaje')).toEqual({ ok: true, params: { subject: 'character', panels: '3' } });
    expect(fitOp('reference_sheet', 'hoja de ella con cuatro vistas')).toEqual({ ok: true, params: { subject: 'character', panels: '4' } });
  });

  it('a sheet of an object or a product fits as an object', () => {
    expect(fitOp('reference_sheet', 'hoja del producto con tres vistas')).toEqual({ ok: true, params: { subject: 'object', panels: '3' } });
  });

  it('"tres vistas" alone is ambiguous: a sheet or one image per view, so Auto asks and Direct makes the sheet', () => {
    expect(fitOp('reference_sheet', 'tres vistas de este personaje')).toMatchObject({ ok: false, ambiguous: true, fallback: { subject: 'character', panels: '3' } });
  });

  it('"una imagen por vista" is never a sheet: one image per view takes angle steps (an impossibility)', () => {
    const r = fitOp('reference_sheet', 'tres vistas de este personaje, una imagen por vista');
    expect(r).toMatchObject({ ok: false });
    expect(r).not.toHaveProperty('ambiguous', true);
  });
});

describe('reference sheet and contact sheet take their count', () => {
  it('turnaround: 3 views unless 4 are named', () => {
    expect(value(fitPanels('hazme tres vistas de este personaje'), 'panels')).toBe('3');
    expect(value(fitPanels('cuatro vistas de este personaje'), 'panels')).toBe('4');
    expect(value(fitPanels('dos vistas de este personaje'), 'panels')).toBe('3');
  });

  it('contact sheet: 9 angles unless 6 are named', () => {
    expect(fitContactAngles('hoja de contacto de esta escena')).toEqual({ ok: true, params: {} });
    expect(value(fitContactAngles('seis ángulos de la escena'), 'angles')).toBe('6');
    expect(value(fitContactAngles('nueve ángulos'), 'angles')).toBe('9');
  });
});

describe('no false refusals: a character or an object named with a place is still the sheet subject', () => {
  it('a person, a character or an object wins over a place in the same request', () => {
    for (const text of ['Hazme una hoja de personaje de la chica que está en la playa', 'Hoja de referencia de mi personaje, el chef de la cocina', 'Hoja de referencia de la casa de mi personaje'])
      expect(fitOp('reference_sheet', text)).toMatchObject({ ok: true, params: { subject: 'character' } });
    expect(fitOp('reference_sheet', 'hoja de referencia del bolso sobre la mesa de la oficina')).toMatchObject({ ok: true, params: { subject: 'object' } });
  });

  it('"separadas" about poses is a sheet; separate images or views are one image per view', () => {
    expect(fitOp('reference_sheet', 'Hoja de referencia de mi personaje con poses separadas')).toMatchObject({ ok: true });
    for (const text of ['tres vistas separadas de mi personaje', 'las vistas en imágenes separadas', 'cada vista en una imagen'])
      expect(fitOp('reference_sheet', text)).toMatchObject({ ok: false, reason: expect.stringContaining('one image per view') });
  });
});

describe('the source size of a chained step comes from its resolution', () => {
  it('reads 1k, 2K, 1080p and WxH', async () => {
    const { longEdgeOf } = await import('../src/engine/agent/fit');
    expect([longEdgeOf('1k'), longEdgeOf('2K'), longEdgeOf('1080p'), longEdgeOf('1024x1536'), longEdgeOf('auto')]).toEqual([1024, 2048, 1920, 1536, undefined]);
  });
});

