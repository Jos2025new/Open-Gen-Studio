import { JobFailedError } from '../lib/http';
import { getAssetBlob } from '../lib/idb';
import { patchGeneration, saveNow, useStore } from '../store/store';
import { addSpend } from '../store/spend';
import { noteExcess, type BudgetPass } from './budget';
import { linkCompletedNode } from './flow/result';
import { estimateMedia, estimateOp, estimateTranscribe } from './costs';
import { deliveryNotes } from './delivery';
import { isVideoOpEngine, OPS } from './ops';
import { videoOpSeconds } from './opSpec';
import { partialRetryCharge } from './retryPartial';
import { markSendsDone } from './sendMark';
import { bookDelivered, deliverSend, ledgerCost, usesLedger } from './sendLedger';
import { generationTicketId, hasActiveTicketSend } from './money/storeBridge';
import type { Asset, Estimate, GenSettings, Generation, GenerationOrigin, MediaKind, RemoteJob } from './types';

const get = useStore.getState;
export const controllers = new Map<string, AbortController>();
export const running = new Map<string, Promise<string[]>>();

export interface GenerationSpec {
  sessionId: string;
  kind: MediaKind | 'text';
  prompt: string;
  modelRef: string;
  settings: GenSettings;
  inputs?: Generation['inputs'];
  op?: Generation['op'];
  origin: GenerationOrigin;
  place?: Generation['place'];
  mode?: Generation['mode'];
  parentId?: string;
  /** Links this attempt to its parent operation (regenerate/retry share it). */
  operationId?: string;
  planId?: string;
  stepId?: string;
  nodeRequest?: string;
  /** Durable approval ticket covering this generation. */
  approvalTicketId?: string;
  /** Frozen fingerprint of the resolved send payload approved by the user. */
  approvedFingerprint?: string;
  /** Runtime per-action budget pass ("Continue once" / "Allow this time"); never persisted. */
  budgetPass?: BudgetPass;
  estimate?: Estimate;
  variants?: string[];
}

export function estimateSpec(spec: GenerationSpec, memoryOnly = false): Estimate {
  if (spec.op) {
    const src = get().assets[spec.op.sourceAssetId];
    return estimateOp(spec.op.id, spec.op.params, src, spec.settings, spec.modelRef);
  }
  if (spec.kind === 'text') {
    // Model text (MiniMax Lyrics) is priced like its media kind; other text is not predictable.
    const m = get().catalog.models[spec.modelRef];
    return m?.textOutput ? estimateMedia(spec.modelRef, m.kind, spec.settings, false, memoryOnly) : { usd: null, approximate: true };
  }
  const withImage = Boolean(spec.inputs?.refs.length || spec.inputs?.firstFrame);
  return estimateMedia(spec.modelRef, spec.kind, spec.settings, withImage, memoryOnly, spec.prompt.length);
}

export function requestEstimate(spec: GenerationSpec): Estimate {
  if (spec.op) {
    const engine = OPS[spec.op.id].engine;
    const source = get().assets[spec.op.sourceAssetId];
    if (engine === 'transcribe') return estimateTranscribe(get().catalog.transcribers?.[spec.modelRef]?.usdPerMinute, source?.duration);
    if (isVideoOpEngine(engine)) {
      return estimateOp(spec.op.id, spec.op.params, source, { ...spec.settings, duration: videoOpSeconds(engine, spec.settings, source?.duration) }, spec.modelRef);
    }
  }
  return estimateSpec(spec, true);
}

/** A submitted job is kept for "Check again" after a local stop. */
export function keptJob(err: unknown, job: RemoteJob | undefined): RemoteJob | undefined {
  return err instanceof JobFailedError ? undefined : job;
}


export function finishText(id: string, text: string, actualUsd: number | undefined, reqId?: string): void {
  const g = get().generations[id];
  if (!g || g.status === 'done') return;
  const cost = actualUsd ?? g.estimate.usd ?? undefined;
  if (usesLedger(g)) deliverSend(id, reqId, g.sends!.length, cost, actualUsd == null);
  const sends = usesLedger(g) ? undefined : markSendsDone(g.sends, reqId);
  patchGeneration(id, { status: 'done', text, statusText: undefined, progress: undefined, finishedAt: Date.now(), actualUsd, providerReportedUsd: actualUsd, remoteJob: undefined, sending: undefined, ...(sends ? { sends } : {}) });
  if (!usesLedger(g)) addSpend(cost, spendEntry(g, actualUsd == null));
  noteExcess(id);
  linkCompletedNode(id);
  void saveNow().catch(() => undefined);
}

/** O3: never fails a generation; a file that cannot be read gives no note. */
export async function checkDelivery(id: string, assets: Asset[]): Promise<string[] | undefined> {
  const g = get().generations[id];
  if (!g) return undefined;
  const notes = await deliveryNotes(g, assets, getAssetBlob).catch(() => []);
  return notes.length ? notes : undefined;
}

export function finish(id: string, assetIds: string[], actualUsd: number | undefined, delivery?: string[], providerReportedUsd?: number, reqId?: string): void {
  const g = get().generations[id];
  if (!g || g.status === 'done') return;
  // Ledger: every delivered request was booked when it delivered; the generation's cost is their sum.
  const ledger = usesLedger(g);
  if (ledger) bookDelivered(id);
  const latest = get().generations[id] ?? g;
  const booked = ledger && latest.sends?.some((s) => s.status === 'done') ? ledgerCost(latest) : undefined;
  const sends = ledger ? latest.sends : markSendsDone(g.sends, reqId);
  const uniqueAssetIds = [...new Set(assetIds)];
  patchGeneration(id, {
    status: 'done',
    assetIds: uniqueAssetIds,
    delivery,
    statusText: undefined,
    progress: undefined,
    finishedAt: Date.now(),
    actualUsd: booked ? (!booked.hasUnknown && (booked.known || (booked.estimatedUsd === 0 && booked.usd > 0)) ? booked.usd : undefined) : actualUsd,
    providerReportedUsd: booked?.hasUnknown ? undefined : providerReportedUsd,
    remoteJob: undefined,
    sending: undefined,
    ...(sends ? { sends } : {}),
  });
  if (!ledger) addSpend(actualUsd ?? g.estimate.usd, spendEntry(g, actualUsd == null));
  noteExcess(id);
  linkCompletedNode(id);
  void saveNow().catch(() => undefined);
}

/** A cut-short run: with a ledger its delivered requests are already booked; older data books the proportional share once. */
export function chargePartial(g: Generation): void {
  const cur = get().generations[g.id] ?? g;
  if (usesLedger(cur)) return bookDelivered(g.id);
  const cost = partialRetryCharge(cur, cur.parentId ? get().generations[cur.parentId] : undefined);
  if (cost === 0) return;
  if (get().generations[g.id]) {
    deliverSend(g.id, `partial:${g.id}`, 0, cost, true);
    return;
  }
  addSpend(cost, spendEntry(cur, true));
}

/** How a generation shows in the Spending panel. */
function spendEntry(g: Generation, estimated: boolean) {
  return { category: g.kind, provider: g.modelRef.split('::')[0], model: g.modelRef, sessionId: g.sessionId, estimated };
}

/** Keep a discarded generation while it still has an active remote job or unsettled send trail. */
function hasPendingSendTrail(g: Generation): boolean {
  return g.status !== 'done' && hasActiveTicketSend(g);
}

/** An ended generation of a deleted session: already charged, so remove it and its results. */
export function purgeDiscarded(id: string): void {
  const g = get().generations[id];
  if (!g?.discard || running.has(id) || g.status === 'running' || g.status === 'queued' || hasPendingSendTrail(g)) return;
  const st = get();
  const kept = new Set(st.library.flatMap((x) => [x.frontalAssetId, ...x.refAssetIds, x.videoAssetId]));
  const ids = Object.values(st.assets).filter((a) => (a.generationId === id || g.assetIds.includes(a.id)) && !kept.has(a.id)).map((a) => a.id);
  useStore.setState((cur) => {
    const generations = { ...cur.generations };
    delete generations[id];
    const tickets = { ...cur.tickets };
    delete tickets[generationTicketId(id)];
    const assets = { ...cur.assets };
    ids.forEach((a) => delete assets[a]);
    return { generations, tickets, assets };
  });
  // Loaded only when there is something to delete.
  if (ids.length) void import('../lib/idb').then((m) => m.deleteAssetBlobs(ids));
}
