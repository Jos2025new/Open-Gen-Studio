import { downloadBlob } from '../lib/media';
import { stateDb } from '../lib/idb';
import { persistState } from './persistJson';
import { beginStateSave, failSave, markStateDirty, resetSaveStatus, saveStatus } from './saveStatus';
import { reportSave } from './saveReport';
import { useStore } from './store';

/** What the app would save right now (the store's `partialize`), without the API keys. */
export function currentCopy(): Record<string, unknown> {
  const state = useStore.persist.getOptions().partialize!(useStore.getState()) as unknown as { settings: Record<string, unknown> };
  const { keys: _keys, ...settings } = state.settings;
  return { ...state, settings };
}

/** "Download copy": the state in memory as a JSON file, so nothing the screen shows can be lost. */
export function downloadCopy(): void {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  downloadBlob(new Blob([JSON.stringify(currentCopy())], { type: 'application/json' }), `open-gen-studio-copy-${stamp}.json`);
}

let keeping = false;
/**
 * "Keep this version": sends the in-memory version of the refused session with `keep` (bound to the disk text and the
 * exact text sent, by hash). One use at a time; the server refuses a second use because the disk has moved on.
 */
export async function keepThisVersion(): Promise<void> {
  const sessionId = saveStatus.getState().rejected?.sessionId;
  if (!sessionId || keeping) return;
  keeping = true;
  const version = markStateDirty();
  beginStateSave(version);
  try {
    const opts = useStore.persist.getOptions();
    reportSave(version, await stateDb.set(opts.name!, persistState({ state: opts.partialize!(useStore.getState()), version: opts.version }), { keep: sessionId }));
  } catch (err) {
    console.error('Could not keep this version', err);
    failSave('Could not save to browser storage', false, version);
  } finally { keeping = false; }
}

/** Replaceable in tests: reloading is the last step of a revert. */
export const page = { reload: () => window.location.reload() };

/**
 * "Revert to the disk version": this tab's state is kept under a `:conflict-<at>` copy, the disk's becomes the active one and
 * the page reloads. The caller asks for confirmation first (RevertConfirm in SaveGuardBanner).
 */
export async function revertToDisk(): Promise<void> {
  await stateDb.revertToDisk(useStore.persist.getOptions().name!);
  resetSaveStatus(); // the reload must not ask to confirm leaving: the memory state is given up on purpose
  page.reload();
}
