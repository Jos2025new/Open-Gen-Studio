import { useRef, useState } from 'react';
import { KIT_KIND_LIST, type KitKind, type LibrarySpace } from '../../engine/libraryTypes';
import { createItem } from '../../engine/libraryVersions';
import type { Subject } from '../../engine/types';
import { setUi, toast, useStore } from '../../store/store';
import { BookOpen, Images, SwatchBook, type LucideIcon } from '../ui/icons';
import { MenuItem } from '../ui/primitives';

export const KIT_META: Record<KitKind, { label: string; singular: string; icon: LucideIcon }> = {
  moodboard: { label: 'Moodboards', singular: 'Moodboard', icon: Images },
  'design-system': { label: 'Design systems', singular: 'Design system', icon: SwatchBook },
  'brand-kit': { label: 'Brand kits', singular: 'Brand kit', icon: BookOpen },
};
export const newKitName = (kind: KitKind, library: readonly Subject[]): string => `${KIT_META[kind].singular} ${library.filter((s) => s.kind === kind).length + 1}`;

/** Create an empty Library entry and open it where the user is; one at a time. */
export function useNewKit(sessionId: string, space: LibrarySpace, onDone?: () => void) {
  const [busy, setBusy] = useState(false), busyRef = useRef(false);
  /** With `onPage` it opens there instead of in the space. */
  const create = async (kind: KitKind, onPage?: (id: string) => void) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const name = newKitName(kind, useStore.getState().library);
      if (onPage) onPage((await createItem({ name, kind, space, by: 'user', sessionId, draft: false, open: false })).subject.id);
      else {
        const { subject } = await createItem({ name, kind, space, by: 'user', sessionId });
        if (kind === 'brand-kit' || kind === 'design-system') setUi({ panel: 'gallery', libraryKitId: subject.id });
        onDone?.();
      }
    }
    catch (e) { toast((e as Error).message, 'error'); } finally { busyRef.current = false; setBusy(false); }
  };
  return { busy, create };
}

export function NewKitItems({ sessionId, space, onDone }: { sessionId: string; space: LibrarySpace; onDone: () => void }) {
  const { busy, create } = useNewKit(sessionId, space, onDone);
  return <>
    <div className="menu-sep-label">Library</div>
    {KIT_KIND_LIST.map((k) => <MenuItem key={k} icon={KIT_META[k].icon} label={KIT_META[k].singular} disabled={busy} onClick={() => void create(k)} />)}
  </>;
}
