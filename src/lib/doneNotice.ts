import { useStore } from '../store/store';
import type { GenerationStatus } from '../engine/types';

const ACTIVE = new Set<GenerationStatus>(['queued', 'running']);
const FINISHED = new Set<GenerationStatus>(['done', 'error']);
/** Finishes this close together make one notification. */
export const BATCH_MS = 1500;

/**
 * While the tab is hidden, and only if the user turned it on in Settings and the browser granted it, one browser
 * notification per finished batch. The tab title and the in-app toast are doneSignal.ts's. Nothing is stored.
 */
export function installDoneNotice(): () => void {
  let prev = new Map<string, GenerationStatus>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let batch = { ok: 0, failed: 0 };

  const snapshot = () => { prev = new Map(Object.values(useStore.getState().generations).map((g) => [g.id, g.status])); };
  const restore = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    batch = { ok: 0, failed: 0 };
  };
  const notify = () => {
    timer = null;
    const { ok: o, failed: f } = batch;
    batch = { ok: 0, failed: 0 };
    if (!document.hidden || !useStore.getState().settings.notify) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const parts = [o ? `${o} generation${o === 1 ? '' : 's'} ready` : '', f ? `${f} failed` : ''].filter(Boolean);
    if (parts.length) try { new Notification('Open Gen Studio', { body: parts.join(' · ') }); } catch { /* notifications unavailable */ }
  };
  const onVisibility = () => { if (document.hidden) snapshot(); else restore(); };

  if (document.hidden) snapshot();
  document.addEventListener('visibilitychange', onVisibility);
  const unsub = useStore.subscribe((s, p) => {
    if (!document.hidden || s.generations === p.generations) return;
    let n = 0;
    for (const g of Object.values(s.generations)) {
      const before = prev.get(g.id);
      if (before === g.status) continue;
      prev.set(g.id, g.status);
      // Counts what was seen running (or queued), so loading old results never counts.
      if (before && ACTIVE.has(before) && FINISHED.has(g.status)) { n++; if (g.status === 'done') batch.ok++; else batch.failed++; }
    }
    if (!n) return;
    if (!timer) timer = setTimeout(notify, BATCH_MS);
  });
  return () => { unsub(); document.removeEventListener('visibilitychange', onVisibility); restore(); };
}

/** Called when the user turns the setting on: the only place that asks for permission. Resolves true if notifications are allowed. */
export async function askNotifyPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try { return (await Notification.requestPermission()) === 'granted'; } catch { return false; }
}
