import { createStore, get, update } from 'idb-keyval';

export interface PromptHistory { recents: string[]; favorites: string[] }
const store = createStore('ogs-prompts', 'kv');
const empty = (): PromptHistory => ({ recents: [], favorites: [] });
const listeners = new Set<() => void>();
export const subscribePromptHistory = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Independent browser-only history; no sessions, settings, media or disk copy. */
export async function loadPromptHistory(): Promise<PromptHistory> {
  return await get<PromptHistory>('create', store) ?? empty();
}
async function change(fn: (h: PromptHistory) => PromptHistory): Promise<void> {
  // update does the read and write in one transaction, including concurrent callers.
  await update<PromptHistory>('create', (h) => fn(h ?? empty()), store);
  listeners.forEach((listener) => listener());
}
export async function recordPrompt(text: string): Promise<void> {
  const prompt = text.trim();
  if (!prompt) return;
  await change((h) => ({ favorites: h.favorites, recents: [prompt, ...h.recents.filter((p) => p !== prompt)].slice(0, 200) }));
}
export async function toggleFavorite(text: string): Promise<void> {
  const prompt = text.trim();
  if (!prompt) return;
  await change((h) => ({ recents: h.recents, favorites: h.favorites.includes(prompt) ? h.favorites.filter((p) => p !== prompt) : [prompt, ...h.favorites] }));
}

/** Vertical navigation belongs to history only at a line boundary, with no selected text. */
export function promptHistoryDirection(text: string, start: number, end: number, key: string): -1 | 1 | 0 {
  if (start !== end) return 0;
  if (key === 'ArrowUp' && !text.slice(0, start).includes('\n')) return -1;
  if (key === 'ArrowDown' && !text.slice(end).includes('\n')) return 1;
  return 0;
}
