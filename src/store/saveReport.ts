import { guard, onProblem, type SaveProblem } from '../lib/saveGuard';
import type { DiskWriteResult } from '../lib/disk';
import { confirmStateSave, failSave } from './saveStatus';

/** What each outcome of a save means for the status (the browser copy was written in every case). */
export function reportSave(version: number, result: DiskWriteResult): void {
  const p = guard.problem;
  if (result === 'rejected' && p) failSave(problemText(p), false, version, { reason: 'possible-loss', rejected: rejection(p) });
  else if (result === 'conflict') failSave('Another tab saved changes', true, version, { reason: 'conflict', rejected: null });
  else if (result === 'rejected' || result === 'fail') failSave('Disk copy pending', false, version);
  else confirmStateSave(version, result === 'browser-only');
}

const rejection = (p: SaveProblem) => ({ sessionId: p.sessionId, rejectedFile: p.rejectedFile, diskHash: p.diskHash, losses: p.losses?.map(({ sessionId }) => ({ sessionId })), total: Boolean(p.total) });
const problemText = (p: SaveProblem) => (p.reason === 'conflict' ? 'Another tab saved changes' : 'A save was set aside as a possible loss');

// A problem found while loading (before any save) shows up in the status at once.
onProblem((p) => failSave(problemText(p), p.reason === 'conflict', undefined, { reason: p.reason, rejected: p.reason === 'conflict' ? null : rejection(p) }));
