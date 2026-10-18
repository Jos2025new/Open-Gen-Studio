import { uid } from '../../lib/id';
import { appendFeed, updateFeedItem } from '../../store/store';
import type { ActivityEntry, ActivityFeedItem, Workspace } from '../types';

/**
 * The turn's activity block (L3): created when the turn starts, it collects the streamed reasoning (store updates
 * throttled) and each action, and records when the turn ended.
 */
export function activityLog(sessionId: string, workspace: Workspace) {
  const item: ActivityFeedItem = { id: uid('fd'), createdAt: Date.now(), workspace, type: 'activity', startedAt: Date.now(), entries: [] };
  appendFeed(sessionId, item);
  const patch = (fn: (entries: ActivityEntry[]) => ActivityEntry[]) =>
    updateFeedItem<ActivityFeedItem>(sessionId, item.id, (it) => ({ ...it, entries: fn(it.entries) }));
  let thinking = -1;
  let latest = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const text = latest.length > 6000 ? `…${latest.slice(-6000)}` : latest;
    const at = thinking;
    if (at >= 0) patch((e) => e.map((x, i) => (i === at && x.kind === 'thinking' ? { ...x, text } : x)));
  };
  return {
    id: item.id,
    thinking(full: string) {
      if (thinking < 0) {
        patch((e) => {
          thinking = e.length;
          return [...e, { kind: 'thinking', text: '' }];
        });
      }
      latest = full;
      timer ??= setTimeout(flush, 150);
    },
    /** A model call ended: its reasoning (if any) gets its duration; the next call starts a new one. */
    callEnded(reasoningMs: number | undefined, totalMs: number) {
      if (thinking < 0) return;
      flush();
      const at = thinking;
      const ms = reasoningMs != null ? totalMs - reasoningMs : undefined;
      patch((e) => e.map((x, i) => (i === at && x.kind === 'thinking' ? { ...x, ms } : x)));
      thinking = -1;
      latest = '';
    },
    action(entry: Omit<Extract<ActivityEntry, { kind: 'action' }>, 'kind'>) {
      patch((e) => [...e, { kind: 'action', ...entry }]);
    },
    end() {
      flush();
      updateFeedItem<ActivityFeedItem>(sessionId, item.id, { endedAt: Date.now() });
    },
  };
}
