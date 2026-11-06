import { useSyncExternalStore } from 'react';

/** A short notice for a value changed from the keyboard ("Brush size 24 px"). One at a time: a new one rewrites the last (no stacking, unlike toasts). */
const SHOW_MS = 1000;
let text = '';
let version = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const emit = () => { version++; listeners.forEach((fn) => fn()); };

export function showValueNotice(next: string): void {
  text = next;
  clearTimeout(timer);
  timer = setTimeout(() => { text = ''; emit(); }, SHOW_MS);
  emit();
}

export const getValueNotice = (): string => text;

/** The text now on show, or '' when none. */
export function useValueNotice(): string {
  useSyncExternalStore((fn) => (listeners.add(fn), () => listeners.delete(fn)), () => version);
  return text;
}
