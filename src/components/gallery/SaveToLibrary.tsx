import { useRef, useState } from 'react';
import { isKit, KIT_KIND_LIST, type KitKind } from '../../engine/libraryTypes';
import { createItem, deleteItem, saveItem } from '../../engine/libraryVersions';
import { nodesToLibrary } from '../../engine/flow/fromLibrary';
import type { DesignDoc, GraphGroup, Subject } from '../../engine/types';
import { setDoc, toast, useStore } from '../../store/store';
import { Button, Segmented } from '../ui/primitives';
import { KIT_META } from './newKit';

const KIT_OPTIONS = KIT_KIND_LIST.map((value) => ({ value, label: KIT_META[value].singular }));

export function SaveToLibrary({ space, sessionId, doc, group, nodeIds, onDone }: {
  space: 'studio' | 'designer' | 'nodes'; sessionId: string; doc?: DesignDoc; group?: GraphGroup; nodeIds?: string[]; onDone: () => void;
}) {
  const library = useStore((s) => s.library), linkedId = doc?.library?.subjectId ?? group?.library?.subjectId;
  const linked = linkedId ? library.find((s) => s.id === linkedId && isKit(s)) : undefined;
  const [name, setName] = useState(linked?.name ?? doc?.name ?? group?.title ?? '');
  const [kind, setKind] = useState<KitKind>((linked?.kind as KitKind | undefined) ?? 'moodboard');
  const [busy, setBusy] = useState(false), busyRef = useRef(false), clean = name.trim();
  const run = async (mode: 'overwrite' | 'copy' | 'new') => {
    if (busyRef.current || !clean) return;
    busyRef.current = true; setBusy(true);
    try {
      let saved: Subject;
      if (space === 'nodes') {
        saved = await nodesToLibrary({ sessionId, mode, subjectId: linked?.id, kind, groupId: group?.id, nodeIds: group ? undefined : nodeIds, name: clean, by: 'user' });
      } else if (mode === 'new') {
        const created = await createItem({ name: clean, kind, space, by: 'user', sessionId, draft: true, open: false });
        try { saved = await saveItem({ subjectId: created.subject.id, mode: 'overwrite', space, by: 'user', sessionId, docId: doc!.id, name: clean }); }
        catch (err) { await deleteItem(created.subject.id); throw err; }
        const link = { subjectId: saved.id, versionId: saved.versionId!, ...(saved.docRev ? { docRev: saved.docRev } : {}), ...(space === 'studio' ? { view: 'studio' as const } : {}) };
        setDoc(sessionId, doc!.id, (d) => ({ ...d, name: saved.name, library: link }));
      } else {
        saved = await saveItem({ subjectId: linked!.id, mode, space, by: 'user', sessionId, docId: doc!.id, name: clean });
        if (mode === 'overwrite') setDoc(sessionId, doc!.id, (d) => (d.library?.subjectId === saved.id ? { ...d, name: saved.name } : d));
      }
      toast(`Saved "${saved.name}" to Library.`, 'success'); onDone();
    } catch (err) { toast((err as Error).message, 'error'); } finally { busyRef.current = false; setBusy(false); }
  };
  return (
    <form className="subject-new" onSubmit={(e) => { e.preventDefault(); void run(linked ? 'overwrite' : 'new'); }}>
      <input autoFocus aria-label="Library item name" placeholder="Name" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
      <Segmented size="sm" value={kind} options={KIT_OPTIONS.map((o) => ({ ...o, disabled: Boolean(linked) || busy }))} onChange={setKind} />
      {linked?.versionId && group?.library && group.library.versionId !== linked.versionId && <p className="field-hint">Changed since it was opened here. Save replaces it; the previous one stays in Versions.</p>}
      {linked ? <div className="confirm-pop-actions">
        <Button size="sm" variant="secondary" disabled={busy || !clean} onClick={() => void run('copy')}>Save a copy</Button>
        <Button size="sm" variant="primary" type="submit" loading={busy} disabled={busy || !clean}>Save</Button>
      </div> : <Button size="sm" variant="primary" type="submit" loading={busy} disabled={busy || !clean}>Save to Library</Button>}
    </form>
  );
}
