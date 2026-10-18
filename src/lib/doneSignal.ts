import { toast, useStore } from '../store/store';
import type { Generation, GenerationStatus, MediaKind } from '../engine/types';
import { formatUsd } from './format';

const ACTIVE = new Set<GenerationStatus>(['queued', 'running']);
const FINISHED = new Set<GenerationStatus>(['done', 'error']);
const APP = 'Open Gen Studio';
const KIND: Record<MediaKind | 'text', string> = { image: 'Image', video: 'Video', audio: 'Audio', model3d: '3D model', text: 'Transcription' };

/** The line the toast shows for a finished generation; a part the app does not know is left out. */
export function doneText(g: Generation): string {
  const parts = [`${KIND[g.kind] ?? g.kind} ready`, g.modelName];
  if (g.startedAt && g.finishedAt) parts.push(`${Math.max(1, Math.round((g.finishedAt - g.startedAt) / 1000))}s`);
  const usd = g.actualUsd ?? g.providerReportedUsd ?? g.estimate?.usd;
  if (usd != null) parts.push(formatUsd(usd));
  return parts.join(' · ');
}

export function failedText(g: Generation): string {
  return [`${KIND[g.kind] ?? g.kind} failed`, g.modelName, g.error].filter(Boolean).join(' · ');
}

/**
 * Tells the user a generation finished while they are elsewhere. Only live transitions count: a generation restored at
 * startup, or one that was discarded with its session, never does. While the tab is hidden the title shows the result
 * ("✓ Done · Open Gen Studio", "! Failed · …") or how many are running, and the original title returns when the tab
 * is visible again. Each finish also shows a toast. Nothing is polled; it only watches the store.
 */
export function installDoneSignal(): () => void {
  let prev: Map<string, GenerationStatus> | null = null;
  /** Generations that existed at startup (restored): never announced. */
  let startup = new Set<string>();
  let original: string | null = null;
  let result: 'done' | 'failed' | null = null;

  const titleFor = (): string | null => {
    if (!document.hidden || !useStore.getState().settings.notifications?.tabTitle) return null;
    if (result) return result === 'done' ? `✓ Done · ${APP}` : `! Failed · ${APP}`;
    const running = Object.values(useStore.getState().generations).filter((g) => ACTIVE.has(g.status) && !g.discard).length;
    return running ? `${APP} · ${running} running` : null;
  };
  const applyTitle = () => {
    const next = titleFor();
    if (next) {
      original ??= document.title;
      if (document.title !== next) document.title = next;
    } else if (original != null) {
      document.title = original;
      original = null;
    }
  };
  const onVisibility = () => {
    if (!document.hidden) result = null;
    applyTitle();
  };
  const snapshot = () => {
    const gens = Object.values(useStore.getState().generations);
    prev = new Map(gens.map((g) => [g.id, g.status]));
    startup = new Set(gens.map((g) => g.id));
  };

  if (useStore.getState().hydrated) snapshot();
  document.addEventListener('visibilitychange', onVisibility);
  const unsub = useStore.subscribe((s, p) => {
    if (!prev) {
      if (s.hydrated) snapshot();
      return;
    }
    const tabTitleChanged = s.settings.notifications?.tabTitle !== p.settings.notifications?.tabTitle;
    if (s.generations === p.generations && !tabTitleChanged) return;
    let failed = false;
    let finishedNow = false;
    for (const g of Object.values(s.generations)) {
      const before = prev.get(g.id);
      if (before === g.status) continue;
      prev.set(g.id, g.status);
      if (startup.has(g.id) || g.discard || !before || !ACTIVE.has(before) || !FINISHED.has(g.status)) continue;
      finishedNow = true;
      if (g.status === 'error') { failed = true; toast(failedText(g), 'error'); } else toast(doneText(g), 'success');
    }
    // Only a finish that happens while the tab is hidden is shown in its title; it stays until the tab is visible.
    if (finishedNow && document.hidden) result = failed ? 'failed' : 'done';
    applyTitle();
  });
  return () => { unsub(); document.removeEventListener('visibilitychange', onVisibility); if (original != null) document.title = original; original = null; result = null; };
}
