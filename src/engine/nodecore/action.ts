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
  /** `[node, port, cable]` (JSON) → the revision that input had when approved. */
  pins: Record<string, string>;
  at: number;
}

type StepStateHook = Parameters<typeof runNodes>[4];
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
  /** The generations this run's sends produced. */
  generationIds?: string[];
  /** Order of the run in this app session, to find the latest. */
  seq: number;
}

let counter = 0;
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
    return node ? resolveInputs(graph, node, env).filter((i) => i.revision).map((i) => [JSON.stringify([id, i.port, i.edgeId]), i.revision!]) : [];
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

/** The snapshot of a preview the user reviewed in the interface: the approval is the signature they saw. */
export function adoptPreview(session: string, targets: string[], force: boolean, preview: NodeRunPreview): ActionSnapshot {
  const id = uid('appr');
  const snapshot: ActionSnapshot = { id, session, targets: [...targets], force, preview, pins: pinsFor(session, [...preview.runIds, ...preview.inputIds]), at: Date.now() };
  snapshots.set(id, snapshot);
  return snapshot;
}

/**
 * The interface's Run buttons: the reviewed preview runs through the same registry, under the id of this confirmation.
 * Each confirmation is its own approval; the same confirmation clicked twice gets the run it already started.
 */
export function runApproved(session: string, targets: string[], force: boolean, preview: NodeRunPreview, runId: string, onState?: StepStateHook): Promise<ActionRecord> {
  const known = ledger.get(runId);
  if (known && known.session === session && known.targets.join(',') === targets.join(',')) return known.done;
  return runAction(adoptPreview(session, targets, force, preview), runId, onState);
}

/**
 * Run a snapshot under a run id. An id that is known is never sent again, whatever happened to it: running gives the
 * same run, done and failed give their record (a failed or interrupted send may have reached the provider, so the
 * state is kept as it is). Trying again means a new approval and a new id. An id belongs to one approval only.
 */
export function runAction(snapshot: ActionSnapshot, runId: string = uid('run'), onState?: StepStateHook): Promise<ActionRecord> {
  const known = ledger.get(runId);
  if (known) {
    if (known.approval !== snapshot.id) return Promise.resolve({ runId, approval: snapshot.id, session: snapshot.session, targets: snapshot.targets, status: 'stale', sends: 0, seq: 0, error: 'This run id belongs to another approval; approve again and use a new id.' });
    return known.done;
  }
  // An approval pays for one send, whether it ended well or badly (a failed send may have reached the provider too):
  // a new run id does not buy a second one. Trying again means preparing again and approving again.
  const spent = [...ledger.values()].find((r) => r.approval === snapshot.id && (r.sends > 0 || r.status === 'running'));
  if (spent) return Promise.resolve({ runId, approval: snapshot.id, session: snapshot.session, targets: snapshot.targets, status: 'stale', sends: 0, seq: 0, error: `This approval was already used (${spent.runId}); prepare the action again and approve it again.` });
  const session = useStore.getState().sessions[snapshot.session];
  const record: ActionRecord & { done: Promise<ActionRecord> } = { runId, approval: snapshot.id, session: snapshot.session, targets: snapshot.targets, status: 'running', sends: 0, seq: ++counter, done: undefined as never };
  ledger.set(runId, record);
  const finish = (): ActionRecord => ({ runId, approval: snapshot.id, session: record.session, targets: record.targets, status: record.status, sends: record.sends, seq: record.seq, result: record.result, error: record.error });
  record.done = (async () => {
    if (!session) { settle(runId, { status: 'failed', error: 'The session of this action no longer exists.' }); return finish(); }
    const missing = snapshot.targets.find((t) => !session.graph.nodes.some((n) => n.id === t));
    if (missing) { settle(runId, { status: 'stale', error: `The destination node ${missing} was deleted after you approved.` }); return finish(); }
    const moved = Object.entries(snapshot.pins).find(([key, rev]) => pinsFor(snapshot.session, [(JSON.parse(key) as string[])[0]])[key] !== rev);
    if (moved) { settle(runId, { status: 'stale', error: `An input changed after you approved (${(JSON.parse(moved[0]) as string[]).slice(0, 2).join('.')}). Review it again.` }); return finish(); }
    try {
      const result = await runNodes(snapshot.session, snapshot.targets, snapshot.preview, snapshot.force, (step, state, info) => { if (state === 'running' && info?.generationId) { record.sends += 1; (record.generationIds ??= []).push(info.generationId); } onState?.(step, state, info); });
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

/** The run that produced this generation, found by the generation itself (an ancestor run inside a downstream batch counts); none when no run of this app session did. */
export function lastRunFor(session: string, generationId: string): ActionRecord | undefined {
  return [...ledger.values()].filter((r) => r.session === session && r.generationIds?.includes(generationId)).sort((a, b) => b.seq - a.seq)[0];
}

/** The latest attempt that targeted this node (whatever it produced): what the inspector shows next to a result that came from elsewhere. */
export function lastAttemptFor(session: string, node: string): ActionRecord | undefined {
  return [...ledger.values()].filter((r) => r.session === session && r.targets.includes(node)).sort((a, b) => b.seq - a.seq)[0];
}
