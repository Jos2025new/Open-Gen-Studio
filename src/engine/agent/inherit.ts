import { pickComposerModel } from '../catalog';
import { userNamed } from '../modelNaming';
import { useStore } from '../../store/store';
import type { MediaKind } from '../types';

const get = () => useStore.getState();

/**
 * Direct has no settings card: a model the user names in their message is used for that plan (plan.ts) and
 * from then on is the composer's pick for its kind, so later requests inherit it instead of reverting.
 */
export function inheritDirectModels(steps: Array<{ kind: string; modelRef?: string }>, said: string): void {
  const done = new Set<string>();
  for (const s of steps) {
    const kind = s.kind as MediaKind;
    if ((kind !== 'image' && kind !== 'video') || !s.modelRef || done.has(kind) || s.modelRef === get().composer[kind].modelRef) continue;
    if (!userNamed([s.modelRef.split('::')[1] ?? '', get().catalog.models[s.modelRef]?.name ?? ''], said)) continue;
    done.add(kind);
    void pickComposerModel(kind, s.modelRef);
  }
}
