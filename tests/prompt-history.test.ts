import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import { clear, createStore } from 'idb-keyval';
import { loadPromptHistory, promptHistoryDirection, recordPrompt, toggleFavorite } from '../src/lib/promptHistory';
beforeEach(async () => { await clear(createStore('ogs-prompts', 'kv')); });
it('un favorito nunca se descarta al pasar de 200 recientes', async () => {
  await recordPrompt('keep forever');
  await toggleFavorite('keep forever');
  for (let i = 0; i < 205; i++) await recordPrompt(`prompt ${i}`);
  const h = await loadPromptHistory();
  expect(h.recents).toHaveLength(200);
  expect(h.recents).not.toContain('keep forever');
  expect(h.favorites).toEqual(['keep forever']);
});
it('repeating a prompt moves it first; concurrent updates survive; stars have no hard limit', async () => {
  await recordPrompt('one'); await recordPrompt('two'); await recordPrompt(' one ');
  expect((await loadPromptHistory()).recents).toEqual(['one', 'two']);
  await Promise.all([recordPrompt('three'), recordPrompt('four')]);
  expect((await loadPromptHistory()).recents).toHaveLength(4);
  for (let i = 0; i < 1001; i++) await toggleFavorite(`star ${i}`);
  expect((await loadPromptHistory()).favorites).toHaveLength(1001);
  await toggleFavorite('star 0');
  expect((await loadPromptHistory()).favorites).toHaveLength(1000);
  await recordPrompt('  ');
  expect((await loadPromptHistory()).recents).toHaveLength(4);
});
it('arrows respect first and last line, selected text and middle lines', () => {
  const text = 'first\nmiddle\nlast';
  expect(promptHistoryDirection(text, 2, 2, 'ArrowUp')).toBe(-1);
  expect(promptHistoryDirection(text, 8, 8, 'ArrowUp')).toBe(0);
  expect(promptHistoryDirection(text, 8, 8, 'ArrowDown')).toBe(0);
  expect(promptHistoryDirection(text, 14, 14, 'ArrowDown')).toBe(1);
  expect(promptHistoryDirection(text, 1, 2, 'ArrowUp')).toBe(0);
});
