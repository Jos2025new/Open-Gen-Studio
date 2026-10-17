import { describe, expect, it } from 'vitest';
import { CONTRAST_LEVELS, CONTRAST_RULE, clampContrast, contrastLine, parseContrastAsk } from '../src/engine/contrast';
import { contrastLines } from '../src/engine/agent/contrastContext';
import { guideIndex, readGuide } from '../src/engine/skills/guides';
import { SKILLS } from '../src/engine/skills';
import type { Session } from '../src/engine/types';

describe('niveles de contraste', () => {
  it('cuatro niveles: nada, situación, estilismo o actitud, sensación', () => {
    expect(CONTRAST_LEVELS.map((l) => l.name)).toEqual(['none', 'unexpected situation', 'unexpected styling or attitude', 'feeling']);
    for (const l of CONTRAST_LEVELS) expect(CONTRAST_RULE).toContain(`${l.level} ${l.name}`);
  });
  it('la regla fija el alcance: solo sujeto y acción, nunca cámara ni estilo, sin controles', () => {
    expect(CONTRAST_RULE).toMatch(/only the subject and action part/);
    expect(CONTRAST_RULE).toMatch(/never camera, style or capture/);
    expect(CONTRAST_RULE).toMatch(/No controls/);
  });
  it('la guía está en el índice, se lee con read_guide y no es un skill elegible', () => {
    expect(guideIndex()).toContain('skill:contrast');
    expect(readGuide('skill:contrast')).toMatch(/Never camera, lens, light, texture or capture style/);
    expect(SKILLS.some((s) => s.id === 'contrast')).toBe(false);
  });
  it('entiende «súbelo a nivel 2» y los pasos relativos', () => {
    expect(parseContrastAsk('súbelo a nivel 2')).toEqual({ level: 2 });
    expect(parseContrastAsk('Make it level 3 please')).toEqual({ level: 3 });
    expect(parseContrastAsk('dale más contraste')).toEqual({ delta: 1 });
    expect(parseContrastAsk('bájale el contraste')).toEqual({ delta: -1 });
    expect(parseContrastAsk('una escena con mucho contraste de luz')).toBeNull();
    expect(parseContrastAsk('nivel 7')).toBeNull();
    expect(parseContrastAsk('haz un video de un gato')).toBeNull();
  });
  it('el contexto lo menciona solo cuando el último mensaje lo pide', () => {
    expect(contrastLine('súbelo a nivel 2')).toMatch(/level 2 \(unexpected styling or attitude\).*subject and action/);
    expect(contrastLine('más contraste')).toMatch(/one level up/);
    expect(contrastLine('hola')).toBeUndefined();
    const feed = (texts: string[]) => ({ feed: texts.map((text) => ({ type: 'user', text })) }) as unknown as Session;
    expect(contrastLines(feed(['súbelo a nivel 1']))).toHaveLength(1);
    expect(contrastLines(feed(['súbelo a nivel 1', 'gracias, ahora el plano']))).toEqual([]);
  });
  it('el nivel se acota a 0-3', () => {
    expect(clampContrast(9)).toBe(3);
    expect(clampContrast(-2)).toBe(0);
  });
});
