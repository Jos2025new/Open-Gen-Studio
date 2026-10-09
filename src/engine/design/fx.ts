import { getDoc, mutateDoc } from './actions';
import { runFxCommands, type FxCommand, type FxRun } from '../fx/commands';

/** Run FX commands on a document as one undo step (the layers panel and the agent both come through here). */
export function runFx(sessionId: string, docId: string, commands: FxCommand[]): FxRun | null {
  const doc = getDoc(sessionId, docId);
  if (!doc) return null;
  const run = runFxCommands(doc, commands);
  if (!run.error && run.doc !== doc) mutateDoc(sessionId, docId, () => run.doc);
  return run;
}
