import { pickComposerModel } from '../catalog';
import { setComposerMedia, useStore } from '../../store/store';
import type { MediaKind, PlanStep } from '../types';

/**
 * Direct has no settings card: when the user approves a plan, the model and values of each step become the
 * composer's defaults for that kind, so the next request starts from them (the user changes them by saying so).
 * A rejected or never-approved plan never reaches this.
 */
export function inheritApproved(steps: PlanStep[]): void {
  const done = new Set<string>();
  for (const st of steps) {
    const kind = st.kind as MediaKind;
    if ((kind !== 'image' && kind !== 'video') || done.has(kind) || !('settings' in st)) continue;
    done.add(kind);
    const cur = useStore.getState().composer[kind];
    const { aspect, resolution, count, duration } = st.settings;
    const settings = { ...cur.settings, ...(aspect ? { aspect } : {}), ...(resolution ? { resolution } : {}), ...(count ? { count } : {}), ...(kind === 'video' && duration ? { duration } : {}) };
    setComposerMedia(kind, { settings });
    if ('modelRef' in st && st.modelRef && st.modelRef !== cur.modelRef) void pickComposerModel(kind, st.modelRef);
  }
}
