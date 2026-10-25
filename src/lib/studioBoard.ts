import { useSyncExternalStore } from 'react';
import { useStore } from '../store/store';

/** Studio's board column: open or closed, and its width. UI preferences kept in the browser, shared by everything that draws Studio. */
export type StudioView = 'assets' | 'nodes' | 'designer';
export interface StudioBoardPrefs { open: boolean; width: number; view: StudioView }
export const BOARD_MIN = 300;
/** Widest the board may be: 640px, or 60% of the window on wide screens (the chat keeps the rest). */
export const BOARD_MAX = 640;
export const boardMax = (): number => typeof window === 'undefined' ? BOARD_MAX : Math.max(BOARD_MAX, Math.round(0.6 * window.innerWidth));
const KEY = 'ogs:studio-board';
const clamp = (n: number) => Math.min(boardMax(), Math.max(BOARD_MIN, Math.round(n)));

function read(): StudioBoardPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<StudioBoardPrefs> | null;
    return { open: raw?.open !== false, width: clamp(typeof raw?.width === 'number' ? raw.width : 400), view: raw?.view === 'nodes' || raw?.view === 'designer' ? raw.view : 'assets' };
  } catch { return { open: true, width: 400, view: 'assets' }; }
}

let current = read();
const listeners = new Set<() => void>();
// Window resized: keep the stored width within the new bounds (the board is shown at the clamped width).
if (typeof window !== 'undefined') window.addEventListener('resize', () => {
  const width = clamp(current.width);
  if (width !== current.width) { current = { ...current, width }; listeners.forEach((l) => l()); }
});

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

/** The canvases whose messages Studio's chat shows: all of them, whichever the board is showing. */
export function studioCanvases(_b: StudioBoardPrefs): Array<'chat' | 'node' | 'designer'> {
  // Every canvas: the board only views one, and switching its tab never hides what was said (2026-10-24: Nodes → Generations emptied the chat).
  return ['chat', 'node', 'designer'];
}

/** Sessions whose board already opened by itself this run. In memory only: it is once per session of use, and a reload may open it again. */
const autoOpened = new Set<string>();
/** In Studio, the first generation to start in a session opens the board on its files; closing it keeps it closed for that session. */
export function installBoardAutoOpen(): () => void {
  let seen = useStore.getState().generations;
  return useStore.subscribe((s) => {
    if (s.generations === seen) return;
    const before = seen;
    seen = s.generations;
    if (s.ui.workspace !== 'chat' || autoOpened.has(s.activeSessionId)) return;
    const started = Object.values(s.generations).some((g) => !before[g.id] && g.sessionId === s.activeSessionId && (g.status === 'queued' || g.status === 'running'));
    if (!started) return;
    autoOpened.add(s.activeSessionId);
    // Already open (on Nodes or the Designer, say): leave the user's view alone.
    if (!getStudioBoard().open) setStudioBoard({ open: true, view: 'assets' });
  });
}
/** Test helper: forget which sessions opened the board. */
export function resetBoardAutoOpen(): void { autoOpened.clear(); }
