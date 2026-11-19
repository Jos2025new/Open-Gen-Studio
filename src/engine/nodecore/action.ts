import { uid } from '../../lib/id';
import { recordJourneyEvent } from '../../lib/journeyTrace';
import { useStore } from '../../store/store';
import type { ExecResult } from '../executor';
import { prepareNodeRun, runNodes, type NodeRunPreview } from '../flow/actions';
import { resolveInputs, storeEnv } from './resolver';

/*
 * Explicit actions (ADR 0031 point 6). `prepareAction` freezes what the user approves: destination (session and
 * nodes), the reviewed preview and the revision every input had. `runAction` consumes that snapshot under a run id.
 * Running the same id again reconciles with what is already known instead of sending again: the same id while it runs
 * gives the same run; after it finished gives its result; after a failure it re-runs only what is still stale, so
 * results already paid for are never regenerated. The result belongs to the session in the snapshot, not to the view.
 */
export interface ActionSnapshot {
  /** The approval: one per prepare. */
  id: string;
  session: string;
  targets: string[];
  force: boolean;
  preview: NodeRunPreview;
  /** `node.port` → the revision that input had when approved. */
  pins: Record<string, string>;
  at: number;
}

export type RunStatus = 'running' | 'done' | 'failed' | 'stale';
export interface ActionRecord {
  runId: string;
  approval: string;
  session: string;
  targets: string[];
  status: RunStatus;
  /** How many times work was actually sent for this id. */
  sends: number;
  result?: ExecResult | null;
  error?: string;
}

const snapshots = new Map<string, ActionSnapshot>();
const ledger = new Map<string, ActionRecord & { done: Promise<ActionRecord> }>();

export const snapshotById = (id: string): ActionSnapshot | undefined => snapshots.get(id);
export const recordOf = (runId: string): ActionRecord | undefined => { const r = ledger.get(runId); return r && { ...r, done: undefined } as unknown as ActionRecord; };
export function resetActions(): void { snapshots.clear(); ledger.clear(); }

/** The revisions of every input the run reads, by `node.port`. */
function pinsFor(session: string, ids: string[]): Record<string, string> {
  const graph = useStore.getState().sessions[session]?.graph;
  if (!graph) return {};
  const env = storeEnv();
  return Object.fromEntries(ids.flatMap((id) => {
    const node = graph.nodes.find((n) => n.id === id);
    return node ? resolveInputs(graph, node, env).filter((i) => i.revision).map((i) => [`${id}.${i.port}:${i.edgeId}`, i.revision!]) : [];
  }));
}

export async function prepareAction(session: string, targets: string[], force = true): Promise<{ ok: true; snapshot: ActionSnapshot } | { ok: false; errors: string[] }> {
  const graph = useStore.getState().sessions[session]?.graph;
  if (!graph) return { ok: false, errors: ['No such session.'] };
  const gone = targets.find((t) => !graph.nodes.some((n) => n.id === t));
  if (gone) return { ok: false, errors: [`No such node: ${gone}.`] };
  const preview = await prepareNodeRun(session, targets, force);
  if (preview.errors.length) return { ok: false, errors: preview.errors };
  const snapshot: ActionSnapshot = { id: uid('appr'), session, targets: [...targets], force, preview, pins: pinsFor(session, [...preview.runIds, ...preview.inputIds]), at: Date.now() };
  snapshots.set(snapshot.id, snapshot);
  recordJourneyEvent({ journeyId: session, journey: 'node-core', event: 'action.prepared', reason: 'snapshot approved for an explicit destination', sessionId: session, approvalId: snapshot.id, after: { targets, signature: snapshot.preview.signature } });
  return { ok: true, snapshot };
}

function settle(runId: string, patch: Partial<ActionRecord>) {
  const r = ledger.get(runId);
  if (r) Object.assign(r, patch);
}

export function runAction(snapshot: ActionSnapshot, runId: string = uid('run')): Promise<ActionRecord> {
  const known = ledger.get(runId);
  if (known) {
    // Reconcile first: a running or finished run is never sent again.
    if (known.status === 'running' || known.status === 'done') return known.done;
    if (known.status === 'stale') return known.done;
  }
  const session = useStore.getState().sessions[snapshot.session];
  const record: ActionRecord & { done: Promise<ActionRecord> } = { runId, approval: snapshot.id, session: snapshot.session, targets: snapshot.targets, status: 'running', sends: known ? known.sends : 0, done: undefined as never };
  ledger.set(runId, record);
  const finish = (): ActionRecord => ({ runId, approval: snapshot.id, session: record.session, targets: record.targets, status: record.status, sends: record.sends, result: record.result, error: record.error });
  record.done = (async () => {
    if (!session) { settle(runId, { status: 'failed', error: 'The session of this action no longer exists.' }); return finish(); }
    const missing = snapshot.targets.find((t) => !session.graph.nodes.some((n) => n.id === t));
    if (missing) { settle(runId, { status: 'stale', error: `The destination node ${missing} was deleted after you approved.` }); return finish(); }
    const moved = Object.entries(snapshot.pins).find(([key, rev]) => pinsFor(snapshot.session, [key.split('.')[0]])[key] !== rev);
    if (moved) { settle(runId, { status: 'stale', error: `An input changed after you approved (${moved[0].split(':')[0]}). Review it again.` }); return finish(); }
    try {
      // Failed retries re-run only what is still stale: finished results are current and are never paid for twice.
      const result = await runNodes(snapshot.session, snapshot.targets, known?.status === 'failed' ? undefined : snapshot.preview, known?.status === 'failed' ? false : snapshot.force, (_step, state, info) => { if (state === 'running' && info?.generationId) record.sends += 1; });
      if (result == null) { settle(runId, { status: 'stale', error: 'The graph changed after it was reviewed; review it again.', result }); return finish(); }
      settle(runId, { status: result.failed.length ? 'failed' : 'done', result, ...(result.failed.length ? { error: result.failed[0].error } : {}) });
    } catch (err) {
      settle(runId, { status: 'failed', error: err instanceof Error ? err.message : String(err) });
    }
    recordJourneyEvent({ journeyId: snapshot.session, journey: 'node-core', event: `action.${record.status}`, reason: 'explicit action finished', sessionId: snapshot.session, approvalId: snapshot.id, after: { runId, sends: record.sends } });
    return finish();
  })();
  return record.done;
}

export const knownRunIds = (): string[] => [...ledger.keys()];
