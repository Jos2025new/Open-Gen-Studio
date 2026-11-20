import { setSettings, useStore } from '../store/store';
import { drawingPreference, setDrawingPreference } from './design/drawingChoice';

/*
 * One register of the notices that can be silenced with "Don't show again", listed in Settings → Budget where the user
 * brings them back. A preference that already has its own control there (the over-limit confirmation, the provider
 * auto-switch) is NOT in this list: one control per preference, and "silenced" never stands for another value.
 * New silenceable notices add an entry here (stored in `settings.mutedNotices`, or in their own place when they had one).
 */
export type NoticeId = 'send-uncertain' | 'drawing-choice';

export const NOTICES: Array<{ id: NoticeId; label: string; tip: string; /** Can be silenced from Settings (the drawing prompt is silenced by choosing an answer on it). */ canSilence: boolean }> = [
  { id: 'send-uncertain', label: 'Warn after a reload during a send', tip: 'The warning that a send may have reached the provider and been charged.', canSilence: true },
  { id: 'drawing-choice', label: 'Ask how to paint on a layer with strokes', tip: 'The prompt in Drawing when a layer has editable strokes. Silenced by saving an answer on it.', canSilence: false },
];

export type AutoSwitch = 'ask' | 'always' | 'never';
export const autoSwitchMode = (): AutoSwitch => useStore.getState().settings.autoSwitchProvider ?? 'ask';

/** Whether this notice is silenced ("Don't show again"). */
export function isMuted(id: NoticeId): boolean {
  if (id === 'drawing-choice') return drawingPreference() !== 'ask';
  return Boolean(useStore.getState().settings.mutedNotices?.includes(id));
}

/** Silence a notice or bring it back. The drawing prompt can only be brought back here. */
export function setMuted(id: NoticeId, muted: boolean): void {
  if (id === 'drawing-choice') { if (!muted) setDrawingPreference('ask'); return; }
  const rest = (useStore.getState().settings.mutedNotices ?? []).filter((x) => x !== id);
  setSettings({ mutedNotices: muted ? [...rest, id] : rest });
}
