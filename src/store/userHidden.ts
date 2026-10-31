import { useStore } from './store';

export type HideKind = 'session' | 'asset' | 'subject';

/**
 * Hide or unhide sessions, assets or saved library items from the Library and Sessions views.
 * Nothing is deleted or rewritten besides the `userHidden` flag; `Session.hidden` (Space containers) is never touched.
 */
export function setUserHidden(kind: HideKind, ids: string[], hidden: boolean): void {
  const picked = new Set(ids);
  useStore.setState((state) => {
    const flag = <T extends { id: string; userHidden?: boolean }>(item: T): T => (picked.has(item.id) && Boolean(item.userHidden) !== hidden ? { ...item, userHidden: hidden || undefined } : item);
    if (kind === 'session') {
      const sessions = Object.fromEntries(Object.entries(state.sessions).map(([id, s]) => [id, s.hidden ? s : flag(s)]));
      return { sessions };
    }
    if (kind === 'asset') return { assets: Object.fromEntries(Object.entries(state.assets).map(([id, a]) => [id, flag(a)])) };
    return { library: state.library.map(flag) };
  });
}
