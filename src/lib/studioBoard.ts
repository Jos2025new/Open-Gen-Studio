import { useSyncExternalStore } from 'react';

/** Studio's board column: open or closed, and its width. UI preferences kept in the browser, shared by everything that draws Studio. */
export type StudioView = 'assets' | 'nodes' | 'designer';
export interface StudioBoardPrefs { open: boolean; width: number; view: StudioView }
export const BOARD_MIN = 300;
export const BOARD_MAX = 640;
const KEY = 'ogs:studio-board';
const clamp = (n: number) => Math.min(BOARD_MAX, Math.max(BOARD_MIN, Math.round(n)));

function read(): StudioBoardPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<StudioBoardPrefs> | null;
    return { open: raw?.open !== false, width: clamp(typeof raw?.width === 'number' ? raw.width : 400), view: raw?.view === 'nodes' || raw?.view === 'designer' ? raw.view : 'assets' };
  } catch { return { open: true, width: 400, view: 'assets' }; }
}

let current = read();
const listeners = new Set<() => void>();

export const getStudioBoard = (): StudioBoardPrefs => current;
export function setStudioBoard(patch: Partial<StudioBoardPrefs>): void {
  current = { open: patch.open ?? current.open, width: clamp(patch.width ?? current.width), view: patch.view ?? current.view };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* storage unavailable */ }
  listeners.forEach((l) => l());
}
/** Test helper: forget what was loaded and read the stored value again. */
export function reloadStudioBoard(): void { current = read(); listeners.forEach((l) => l()); }

export function useStudioBoard(): StudioBoardPrefs {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, getStudioBoard, getStudioBoard);
}

/** The canvases whose messages Studio's chat shows: its own, and the one the board is showing. */
export function studioCanvases(b: StudioBoardPrefs): Array<'chat' | 'node' | 'designer'> {
  return b.open && b.view === 'nodes' ? ['chat', 'node'] : b.open && b.view === 'designer' ? ['chat', 'designer'] : ['chat'];
}
