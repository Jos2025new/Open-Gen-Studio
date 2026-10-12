import { create } from 'zustand';

export interface SaveStatus {
  phase: 'unsaved' | 'saving' | 'saved' | 'error';
  version: number;
  confirmed: number;
  browserOnly: boolean;
  conflict: boolean;
  error: string | null;
}
const initial: SaveStatus = { phase: 'saved', version: 0, confirmed: 0, browserOnly: false, conflict: false, error: null };
export const saveStatus = create<SaveStatus>(() => ({ ...initial }));
const pixels = new Set<string>();
const saving = new Set<number>();
function refresh(): void {
  const s = saveStatus.getState();
  saveStatus.setState({ phase: s.error ? 'error' : saving.has(s.version) ? 'saving' : s.confirmed < s.version || pixels.size ? 'unsaved' : 'saved' });
}
export function markStateDirty(): number {
  const version = saveStatus.getState().version + 1;
  saveStatus.setState({ version });
  refresh();
  return version;
}
export function beginStateSave(version: number): void { saving.add(version); refresh(); }
export function confirmStateSave(version: number, browserOnly: boolean): void {
  saving.delete(version);
  const s = saveStatus.getState();
  // A successful older write cannot hide a failure of a newer one (nor a tab conflict).
  if (version >= s.version && !s.conflict) saveStatus.setState({ error: null });
  saveStatus.setState({ confirmed: Math.max(s.confirmed, version), browserOnly });
  refresh();
}
export function failSave(message: string, conflict = false, version?: number): void {
  if (version !== undefined) saving.delete(version);
  saveStatus.setState({ error: message, conflict: saveStatus.getState().conflict || conflict });
  refresh();
}
export function rasterPending(id: string): void { pixels.add(id); refresh(); }
export function rasterSaved(id: string): void {
  pixels.delete(id);
  const s = saveStatus.getState();
  if (!pixels.size && s.error === 'Layer pixels pending' && !s.conflict) saveStatus.setState({ error: null });
  refresh();
}
export function hasPendingSave(): boolean {
  const s = saveStatus.getState();
  return s.phase !== 'saved' || s.confirmed < s.version || pixels.size > 0;
}
/** Test reset; this store is transient and is never itself persisted. */
export function resetSaveStatus(): void { pixels.clear(); saving.clear(); saveStatus.setState({ ...initial }); }
