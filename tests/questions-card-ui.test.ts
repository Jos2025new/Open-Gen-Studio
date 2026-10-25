// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Questions card (2026-10-25, user's screenshots and «1/3 … continue te lleva a la siguiente … skip question … plan now»):
 * medium size (card-m), one question at a time, short options side by side, long ones one per row. The answers sent are
 * the whole option texts, as before; a skipped question is left out; skipping all plans now.
 */
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QuestionsCard } from '../src/components/chat/QuestionsCard';
import * as runtime from '../src/engine/agent/runtime';
import type { QuestionsFeedItem } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const R480 = '480p: usaré una sola imagen de inicio; no podrá usar el storyboard.';
const R720 = '720p: usaré el storyboard y las imágenes de personajes como referencias.';
const item = {
  id: 'q1', createdAt: 0, workspace: 'chat', type: 'questions', status: 'pending', round: 1, maxRounds: 1,
  intro: 'Hay dos variantes Mini. ¿Qué priorizamos y con qué imagen abre?',
  questions: [
    { id: 'v', question: '¿Qué variante prefieres?', options: [R480, R720], default: R720, multi: false, allowCustom: true },
    { id: 'f', question: '¿Qué imagen abre?', options: ['El primer panel del storyboard: plano general del parque.', 'La imagen de personaje de cabello negro.'], multi: false, allowCustom: false },
  ],
} as unknown as QuestionsFeedItem;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.replaceChildren(host);
  root = createRoot(host);
});

const click = (label: string) => act(() => ([...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label) as HTMLButtonElement).click());

describe('questions card: one question at a time', () => {
  it('card-m; a 1/2 counter, no title, no "Round 1 of 1"; only the first question shows', () => {
    act(() => root.render(createElement(QuestionsCard, { item, sessionId: 's' })));
    expect(host.querySelector('article')?.className).toContain('card-m');
    expect(host.querySelector('.q-count')?.textContent).toBe('1/2');
    expect(host.querySelector('.q-title')).toBeNull();
    expect(host.textContent).not.toMatch(/Round 1 of 1/);
    expect([...host.querySelectorAll('.q-question')].map((x) => x.textContent)).toEqual(['¿Qué variante prefieres?']);
  });
  it('short options side by side (labels, check beside); the chosen one\'s meaning under them', () => {
    act(() => root.render(createElement(QuestionsCard, { item, sessionId: 's' })));
    const seg = host.querySelector('.q-options')!;
    expect(seg.className).toContain('cc-seg');
    expect([...seg.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['480p', '720p']);
    expect(host.querySelector('.q-opt-note')?.textContent).toBe('usaré el storyboard y las imágenes de personajes como referencias.');
  });
  it('Continue goes to 2/2 (long options one per row); Continue on the last sends the whole option texts', () => {
    const submit = vi.spyOn(runtime, 'submitAnswers').mockResolvedValue(undefined);
    act(() => root.render(createElement(QuestionsCard, { item, sessionId: 's' })));
    click('Continue');
    expect(host.querySelector('.q-count')?.textContent).toBe('2/2');
    expect(host.querySelector('.q-options')?.className).toContain('is-list');
    act(() => (host.querySelector('.q-opt') as HTMLButtonElement).click());
    click('Continue');
    expect(submit).toHaveBeenCalledWith('s', 'q1', { v: R720, f: 'El primer panel del storyboard: plano general del parque.' });
  });
  it('Skip question leaves that one out; Back brings it back', () => {
    const submit = vi.spyOn(runtime, 'submitAnswers').mockResolvedValue(undefined);
    act(() => root.render(createElement(QuestionsCard, { item, sessionId: 's' })));
    click('Skip question');
    click('Previous question');
    expect(host.querySelector('.q-count')?.textContent).toBe('1/2');
    click('Skip question');
    act(() => (host.querySelector('.q-opt') as HTMLButtonElement).click());
    click('Continue');
    expect(submit).toHaveBeenCalledWith('s', 'q1', { f: 'El primer panel del storyboard: plano general del parque.' });
  });
  it('skipping every question plans now; Plan now skips them all at once', () => {
    const skip = vi.spyOn(runtime, 'skipQuestions').mockResolvedValue(undefined);
    act(() => root.render(createElement(QuestionsCard, { item, sessionId: 's' })));
    click('Skip question');
    click('Skip question');
    expect(skip).toHaveBeenCalledTimes(1);
    act(() => root.render(createElement(QuestionsCard, { item: { ...item, id: 'q2' } as QuestionsFeedItem, sessionId: 's' })));
    click('Plan now');
    expect(skip).toHaveBeenCalledWith('s', 'q2');
  });
});
