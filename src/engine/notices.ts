import { setSettings, useStore } from '../store/store';
import { setDrawingPreference } from './design/drawingChoice';

/*
 * One register of the notices that can be silenced with "Don't show again", listed in Settings → Budget where the user
 * brings them back (the only place: no second control elsewhere). A preference that already has its own control there
 * (the over-limit confirmation, the provider auto-switch) is NOT in this list: one control per preference, and
 * "silenced" never stands for another value. New silenceable notices add an entry here (stored in
 * `settings.mutedNotices`, or in their own place when they had one) and a case in `noticeState`.
 */
export type NoticeId = 'send-uncertain' | 'drawing-choice';

export const NOTICES: Array<{ id: NoticeId; label: string; tip: string; /** Can be silenced from Settings (the drawing prompt is silenced by choosing an answer on it). */ canSilence: boolean; /** The button that brings it back. */ bringBack: string }> = [
  { id: 'send-uncertain', label: 'Warn after a reload during a send', tip: 'The warning that a send may have reached the provider and been charged.', canSilence: true, bringBack: 'Show again' },
  { id: 'drawing-choice', label: 'Painting on layers with editable strokes', tip: 'The prompt in Drawing when a layer has editable strokes (ADR 0016). Silenced by saving an answer on it; the saved answer is shown here.', canSilence: false, bringBack: 'Ask every time' },
];

export type AutoSwitch = 'ask' | 'always' | 'never';
export const autoSwitchMode = (): AutoSwitch => useStore.getState().settings.autoSwitchProvider ?? 'ask';

type State = ReturnType<typeof useStore.getState>;
const DRAWING_LABELS = { flatten: 'Flatten and paint', design: 'Paint in Design', newLayer: 'New layer' } as const;

/** What the register shows for a notice in this state: `muted`, and the text of its row (the saved answer, when it has one). */
export function noticeState(s: State, id: NoticeId): { muted: boolean; text: string } {
  if (id === 'drawing-choice') {
    const pref = s.ui.drawingChoice ?? 'ask';
    return pref === 'ask' ? { muted: false, text: 'Ask every time' } : { muted: true, text: DRAWING_LABELS[pref] };
  }
  const muted = Boolean(s.settings.mutedNotices?.includes(id));
  return { muted, text: muted ? 'silenced' : 'shown' };
}

/** Whether this notice is silenced ("Don't show again"). */
export function isMuted(id: NoticeId): boolean {
  return noticeState(useStore.getState(), id).muted;
}

/** The register row follows the store (both `settings.mutedNotices` and `ui.drawingChoice`): a change shows at once. */
export function useNotice(id: NoticeId): { muted: boolean; text: string } {
  const muted = useStore((s) => noticeState(s, id).muted);
  const text = useStore((s) => noticeState(s, id).text);
  return { muted, text };
}

/** Silence a notice or bring it back. The drawing prompt can only be brought back here. */
export function setMuted(id: NoticeId, muted: boolean): void {
  if (id === 'drawing-choice') { if (!muted) setDrawingPreference('ask'); return; }
  const rest = (useStore.getState().settings.mutedNotices ?? []).filter((x) => x !== id);
  setSettings({ mutedNotices: muted ? [...rest, id] : rest });
}
