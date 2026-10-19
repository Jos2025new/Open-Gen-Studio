import { WRITER_HANDOFF } from '../engine/checkStatus';
import { controllers } from '../engine/jobs';
import { stopAgent } from '../engine/agent/runtime';
import { onWriterLockGranted, onWriterLockLost, setWriterHooks, type WorkReport } from '../lib/writerLock';
import { resetSaveStatus } from './saveStatus';
import { saveNow, useStore } from './store';

/*
 * What the store side knows about handing the writer lock over (plan 1.4): which work can move to the next tab
 * (generations with a provider job, `remoteJob`) and which cannot (a request still being answered, an agent turn).
 * Imported by App; a test imports it to get the same wiring.
 */
const inFlight = () => Object.values(useStore.getState().generations).filter((g) => g.status === 'running' || g.status === 'queued');
const busySessions = () => Object.values(useStore.getState().sessions).filter((s) => s.agent.busy).map((s) => s.id);

export function workReport(): WorkReport {
  const gens = inFlight();
  const transferable = gens.filter((g) => g.remoteJob).length;
  return { transferable, generations: gens.length - transferable, agent: busySessions().length };
}

/**
 * Polling is cut with WRITER_HANDOFF, handled like CHECK_RESTART: the generation stays `running` with its remoteJob (not
 * canceled, not charged), saved as it is for the next tab's resumeInterrupted. An abort without a reason would cancel it.
 */
const abortGenerations = (only: (g: { remoteJob?: unknown }) => boolean) => { for (const g of inFlight()) if (only(g)) controllers.get(g.id)?.abort(WRITER_HANDOFF); };

setWriterHooks({
  report: workReport,
  agentBusy: () => busySessions().length > 0,
  abortTransferable: () => abortGenerations((g) => Boolean(g.remoteJob)),
  abortAll: () => { abortGenerations(() => true); busySessions().forEach((id) => stopAgent(id)); },
  flush: saveNow,
});

// Without the lock this tab has no state of its own: the memory copy is stale, so the next grant loads the state again.
onWriterLockLost(() => useStore.setState({ hydrated: false }));
// Taking the lock (again) starts the save status clean; a problem the new load finds (stateDb.get) shows up again.
onWriterLockGranted(resetSaveStatus);
