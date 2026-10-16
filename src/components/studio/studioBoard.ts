import { useSyncExternalStore } from 'react';

/** Studio's board column: open or closed, and its width. UI preferences kept in the browser, shared by everything that draws Studio. */
export interface StudioBoardPrefs { open: boolean; width: number }
export const BOARD_MIN = 300;
export const BOARD_MAX = 640;
const KEY = 'ogs:studio-board';
const clamp = (n: number) => Math.min(BOARD_MAX, Math.max(BOARD_MIN, Math.round(n)));

function read(): StudioBoardPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<StudioBoardPrefs> | null;
    return { open: raw?.open !== false, width: clamp(typeof raw?.width === 'number' ? raw.width : 400) };
  } catch { return { open: true, width: 400 }; }
}

let current = read();
const listeners = new Set<() => void>();

export const getStudioBoard = (): StudioBoardPrefs => current;
export function setStudioBoard(patch: Partial<StudioBoardPrefs>): void {
  current = { open: patch.open ?? current.open, width: clamp(patch.width ?? current.width) };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* storage unavailable */ }
  listeners.forEach((l) => l());
}
/** Test helper: forget what was loaded and read the stored value again. */
export function reloadStudioBoard(): void { current = read(); listeners.forEach((l) => l()); }

export function useStudioBoard(): StudioBoardPrefs {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, getStudioBoard, getStudioBoard);
}
