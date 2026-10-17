import { describe, expect, it } from 'vitest';
import { CAPTURE_PRESETS, DIRECTIVES, TONES, captureClause, cleanCapture, resolveCapture, withCaptureSetting } from '../src/engine/captureStyles';
import { opRealism, withRealism } from '../src/engine/realism';
import { CAPTURE_RULE } from '../src/engine/procedure';

describe('estilos de captura (CTLT)', () => {
  it('cada preset trae cámara, tono, luz y textura', () => {
    for (const p of CAPTURE_PRESETS) for (const f of ['camera', 'tone', 'light', 'texture'] as const) expect(p[f].length, `${p.id}.${f}`).toBeGreaterThan(5);
    expect(CAPTURE_PRESETS.map((p) => p.id)).toEqual(expect.arrayContaining(['skate', 'documentary', 'photodump', 'curbside', 'disposable', 'concealed', 'phone', 'camcorder', 'selfie']));
  });
  it('imagen: cámara, tono, luz y textura; el tono por defecto se puede cambiar', () => {
    const base = withRealism('A skater mid-air', 'balanced', '', undefined, { kind: 'image', capture: { style: 'skate' } });
    expect(base).toContain('12 mm fisheye');
    expect(base).toContain('mood: raw, high-energy');
    const changed = withRealism('A skater mid-air', 'balanced', '', undefined, { kind: 'image', capture: { style: 'skate', tone: 'nostalgic, warm' } });
    expect(changed).toContain('mood: nostalgic, warm');
    expect(changed).not.toContain('raw, high-energy');
  });
  it('las directivas de video se combinan y no afectan a la imagen', () => {
    const cap = { style: 'concealed', directives: ['shake', 'crash-zoom', 'focus-hunt'] };
    const v = withRealism('Two friends talking', 'balanced', '', undefined, { kind: 'video', capture: cap });
    for (const id of cap.directives) expect(v).toContain(DIRECTIVES.find((d) => d.id === id)!.clause);
    const i = withRealism('Two friends talking', 'balanced', '', undefined, { kind: 'image', capture: cap });
    expect(i).not.toContain('crash zoom');
  });
  it('video anclado a una imagen: solo movimiento y cadencia, sin cámara nueva', () => {
    const v = withRealism('x', 'balanced', '', undefined, { kind: 'video', anchored: true, capture: { style: 'skate', directives: ['whip-pan'] } });
    expect(v).toContain('whip pan');
    expect(v).not.toContain('fisheye');
  });
  it('no toca otro medio ni JSON ni modelos sin política', () => {
    expect(withRealism('An anime girl', 'balanced', '', undefined, { kind: 'image', capture: { style: 'skate' } })).toBe('An anime girl');
    expect(withRealism('a cup', 'balanced', 'recraft-v3', undefined, { kind: 'image', capture: { style: 'skate' } })).toBe('a cup');
  });
  it('una edición solo recibe el estilo si se eligió', () => {
    expect(opRealism({ op: { id: 'edit' }, settings: {} }, 'image', 'make the coat red')).toBe('make the coat red');
    expect(opRealism({ op: { id: 'edit' }, settings: { capture: { style: 'phone' } } }, 'image', 'x')).toContain('phone main camera');
  });
  it('cleanCapture descarta lo desconocido', () => {
    expect(cleanCapture({ style: 'skate', directives: ['shake', 'nope'], imperfect: ['bad'], tone: 'x'.repeat(500) })?.directives).toEqual(['shake']);
    expect(cleanCapture({ directives: ['nope'] })).toBeUndefined();
    expect(cleanCapture('skate')).toBeUndefined();
  });
  it('un estilo guardado se usa por nombre ("con mi estilo X")', () => {
    const mine = [{ name: 'Mi tarde', kind: 'style', capture: { camera: '50 mm low', tone: 'quiet', light: 'dusk', texture: 'grain' } }];
    const sel = resolveCapture({ style: '@mi tarde' }, mine);
    expect(sel?.custom?.camera).toBe('50 mm low');
    expect(captureClause(sel!, 'image')).toBe('50 mm low, mood: quiet, dusk, grain.');
    expect(withCaptureSetting({ count: 1 }, 'image', { style: 'zzz' }, mine)).toEqual({ count: 1 });
    expect(withCaptureSetting({ count: 1 }, 'text', { style: 'skate' }, mine)).toEqual({ count: 1 });
  });
  it('el agente conoce presets, tonos y directivas', () => {
    for (const p of CAPTURE_PRESETS) expect(CAPTURE_RULE).toContain(p.id);
    for (const d of DIRECTIVES) expect(CAPTURE_RULE).toContain(d.id);
    expect(CAPTURE_RULE).toContain(TONES[0]);
  });
});
