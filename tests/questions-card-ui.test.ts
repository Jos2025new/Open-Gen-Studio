// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Questions card (2026-10-25, user's screenshots): medium size of the card system (card-m), short options side by side
 * with what the chosen one means on a quiet line under them, long options one per row. Only the look: the answer sent is
 * the whole option text, as before.
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

describe('questions card layout', () => {
  it('card-m; the closing question is the title; no "Round 1 of 1"', () => {
    act(() => root.render(createElement(QuestionsCard, { item, sessionId: 's' })));
    expect(host.querySelector('article')?.className).toContain('card-m');
    expect(host.querySelector('.q-title')?.textContent).toBe('¿Qué priorizamos y con qué imagen abre?');
    expect(host.textContent).not.toMatch(/Round 1 of 1/);
  });
  it('480p and 720p side by side (labels only); the chosen one\'s meaning under them; long options one per row', () => {
    act(() => root.render(createElement(QuestionsCard, { item, sessionId: 's' })));
    const [short, long] = host.querySelectorAll('.q-options');
    expect(short.className).not.toContain('is-list');
    expect([...short.querySelectorAll('.q-opt')].map((b) => b.textContent)).toEqual(['480p', '720p']);
    expect(host.querySelector('.q-opt-note')?.textContent).toBe('usaré el storyboard y las imágenes de personajes como referencias.');
    expect(long.className).toContain('is-list');
  });
  it('the answer sent is the whole option text', () => {
    const submit = vi.spyOn(runtime, 'submitAnswers').mockResolvedValue(undefined);
    act(() => root.render(createElement(QuestionsCard, { item, sessionId: 's' })));
    act(() => (host.querySelectorAll('.q-options')[1].querySelector('.q-opt') as HTMLButtonElement).click());
    act(() => ([...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Continue')) as HTMLButtonElement).click());
    expect(submit).toHaveBeenCalledWith('s', 'q1', { v: R720, f: 'El primer panel del storyboard: plano general del parque.' });
  });
});
