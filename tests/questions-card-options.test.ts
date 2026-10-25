import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { introParts, optionParts } from '../src/components/chat/QuestionsCard';

/*
 * Questions card (2026-10-25, user's before/after: «si no cabe, recorta el texto»): an option written as
 * "label: what it means" shows the label and a quiet one-line detail. Only the display splits: the answer sent is the
 * whole option text, as before.
 */
describe('question options: label and detail', () => {
  it('splits at the first ": " near the start', () => {
    expect(optionParts('720p: usaré el storyboard y las imágenes de personajes como referencias.')).toEqual({ label: '720p', detail: 'usaré el storyboard y las imágenes de personajes como referencias.' });
  });
  it('keeps short or colon-free options whole', () => {
    expect(optionParts('La imagen de personaje de cabello rubio.')).toEqual({ label: 'La imagen de personaje de cabello rubio.' });
    expect(optionParts('16:9')).toEqual({ label: '16:9' });
  });
  it('a colon far into a sentence is not a label', () => {
    const o = 'Usar el primer panel del storyboard como inicio y luego: el resto';
    expect(optionParts(o)).toEqual({ label: o });
  });
});

describe('question intro: the last question is the title', () => {
  it('context first, the closing question as title', () => {
    expect(introParts('Hay dos variantes Mini: la de 480p solo acepta una imagen de inicio. ¿Qué priorizamos y con qué imagen abre?')).toEqual({ title: '¿Qué priorizamos y con qué imagen abre?', context: 'Hay dos variantes Mini: la de 480p solo acepta una imagen de inicio.' });
  });
  it('no closing question: all of it is context', () => {
    expect(introParts('Necesito dos datos antes de planear.')).toEqual({ context: 'Necesito dos datos antes de planear.' });
  });
  it('only a question: title alone', () => {
    expect(introParts('¿Para qué red es?')).toEqual({ title: '¿Para qué red es?' });
  });
});
