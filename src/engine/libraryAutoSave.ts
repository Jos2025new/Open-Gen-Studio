import { useStore } from '../store/store';
import { bufferVersion, rasterBufferIds } from './design/raster';
import { isKit, type LibrarySpace } from './libraryTypes';
import { isWorkingCopyDirty, saveKit } from './libraryVersions';
import type { DesignDoc } from './types';

/* Auto-version draft Library kits at the single end-of-turn point without blocking or breaking the turn. */
export interface DraftTurnBaseline { kitIds: Set<string>; docs: Map<string, { doc: DesignDoc; revs: Map<string, number> }>; }
const rasterRevs = (doc: DesignDoc) => new Map(rasterBufferIds(doc.layers).map((id) => [id, bufferVersion(id)]));
const revsChanged = (a: Map<string, number>, b: Map<string, number>) => a.size !== b.size || [...a].some(([k, v]) => b.get(k) !== v);

export function captureDraftBaseline(sessionId: string): DraftTurnBaseline {
  const st = useStore.getState(), docs = new Map<string, { doc: DesignDoc; revs: Map<string, number> }>();
  for (const d of st.sessions[sessionId]?.docs ?? []) if (d.library?.subjectId) docs.set(d.library.subjectId, { doc: d, revs: rasterRevs(d) });
  return { kitIds: new Set(st.library.filter(isKit).map((k) => k.id)), docs };
}

export async function autoVersionDraftKits(sessionId: string, baseline: DraftTurnBaseline, space: LibrarySpace, onError: (name: string, reason: string) => void): Promise<void> {
  const st = useStore.getState(), session = st.sessions[sessionId];
  if (!session) return;
  for (const kit of st.library.filter((s) => isKit(s) && s.draft)) {
    const workDoc = session.docs.find((d) => d.library?.subjectId === kit.id), prev = baseline.docs.get(kit.id);
    const created = !baseline.kitIds.has(kit.id) && kit.origin?.by === 'agent' && (!kit.origin.sessionId || kit.origin.sessionId === sessionId);
    const changed = Boolean(workDoc && (!prev || prev.doc !== workDoc || revsChanged(prev.revs, rasterRevs(workDoc))));
    if ((!created && !changed) || !(workDoc ? (!kit.versionId || await isWorkingCopyDirty(workDoc)) : (created && !kit.versionId))) continue;
    try { await saveKit({ subjectId: kit.id, mode: 'overwrite', space, by: 'agent', sessionId, ...(workDoc ? { docId: workDoc.id } : {}) }); }
    catch (err) { onError(kit.name, err instanceof Error ? err.message : String(err)); }
  }
}
