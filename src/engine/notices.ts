import { setSettings, useStore } from '../store/store';

/*
 * One register of the notices the user can silence with "Don't show again" and bring back in Settings → Budget.
 * The older over-limit confirmation and the provider auto-switch keep their own settings (budgetNoAsk,
 * autoSwitchProvider); this module maps all of them to one list so the user sees and undoes them in one place.
 * New silenceable notices only add an entry here (stored in `settings.mutedNotices`).
 */
export type NoticeId = 'budget' | 'credit-switch' | 'send-uncertain';

export const NOTICES: Array<{ id: NoticeId; label: string; tip: string }> = [
  { id: 'budget', label: 'Ask before going over the limit', tip: 'The confirmation when a run goes over your spending limit.' },
  { id: 'credit-switch', label: 'Ask before switching provider', tip: 'The question when a provider is out of credit and the same model is available elsewhere.' },
  { id: 'send-uncertain', label: 'Warn after a reload during a send', tip: 'The warning that a send may have reached the provider and been charged.' },
];

export type AutoSwitch = 'ask' | 'always' | 'never';
export const autoSwitchMode = (): AutoSwitch => useStore.getState().settings.autoSwitchProvider ?? 'ask';

/** Whether this notice is silenced ("Don't show again"). */
export function isMuted(id: NoticeId): boolean {
  const s = useStore.getState().settings;
  if (id === 'budget') return Boolean(s.budgetNoAsk || s.budgetAccepted === s.budgetUsd);
  if (id === 'credit-switch') return autoSwitchMode() !== 'ask';
  return Boolean(s.mutedNotices?.includes(id));
}

/** Silence a notice or bring it back. Silencing the provider question means "switch without asking". */
export function setMuted(id: NoticeId, muted: boolean): void {
  if (id === 'budget') { setSettings({ budgetNoAsk: muted, budgetAccepted: null }); return; }
  if (id === 'credit-switch') { setSettings({ autoSwitchProvider: muted ? 'always' : 'ask' }); return; }
  const rest = (useStore.getState().settings.mutedNotices ?? []).filter((x) => x !== id);
  setSettings({ mutedNotices: muted ? [...rest, id] : rest });
}
