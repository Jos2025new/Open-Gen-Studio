import type { Asset, AssetKind, Generation, OpId } from '../../engine/types';
import type { Place } from '../../engine/placeTypes';
import { OPS, opsFor } from '../../engine/ops';
import { filterGenerations, statusOf, type GenerationQuery } from '../shell/generationsView';

/** One cell of the Done row: a finished asset. */
export type DoneCell = { type: 'asset'; assetId: string; generationId: string } | { type: 'text'; generationId: string };

export interface BoardOptions extends GenerationQuery {
  /** Favorites only: finished assets the user starred. */
  starred: boolean;
  showFailed: boolean;
  scope: 'all' | { sessionId: string };
  /** A Space shows its own place; a workspace board (`workspace`) never shows what a Space made. */
  place?: Place | 'workspace';
}

const RELOAD_INTERRUPTED_RE = /^Interrupted by a page reload or tab change\./;

/** True when a generation failed because a page reload or tab change cut it short. */
export function isReloadInterrupted(g: Pick<Generation, 'status' | 'error'>): boolean {
  return g.status === 'error' && Boolean(g.error && RELOAD_INTERRUPTED_RE.test(g.error));
}

/** True when a failed generation is local or guaranteed free ($0, with no paid send uncertainty). */
export function isFreeGeneration(g: Pick<Generation, 'provider' | 'modelRef' | 'estimate' | 'lostJob' | 'remoteJob' | 'sends'>): boolean {
  if (g.lostJob || g.remoteJob || g.sends?.some((s) => s.status === 'uncertain' || s.status === 'intent' || s.status === 'sent')) return false;
  return g.provider === 'local' || g.modelRef.startsWith('local::') || (g.estimate?.usd === 0 && !g.estimate.lowerBound);
}

/** Generation ids that already have a retry child attempt. */
export function retriedGenerationIds(generations: Record<string, Pick<Generation, 'parentId'>>): Set<string> {
  const ids = new Set<string>();
  for (const g of Object.values(generations)) if (g.parentId) ids.add(g.parentId);
  return ids;
}

/** `failed` includes all failures when "show failed" is on, plus unretried local/free runs interrupted by a reload. */
export interface BoardRows { done: DoneCell[]; failed: Generation[]; ongoing: Generation[] }

/** Rows of the board: finished results on top, running or queued generations below. */
export function splitBoard(generations: Record<string, Generation>, assets: Record<string, Asset>, o: BoardOptions): BoardRows {
  const inPlace = (g: Generation) => !o.place || o.place === 'workspace' ? g.place !== 'space-create' && g.place !== 'space-tools' : g.place === o.place;
  const inScope = Object.values(generations).filter((g) => !g.discard && inPlace(g) && (o.scope === 'all' || g.sessionId === o.scope.sessionId));
  const list = filterGenerations(inScope, { kind: o.kind, status: o.status, q: o.q, sort: o.sort });
  const retried = retriedGenerationIds(generations);
  const done: DoneCell[] = [];
  const ongoing: Generation[] = [];
  const failed: Generation[] = [];
  for (const g of list) {
    const st = statusOf(g);
    if (st === 'running') ongoing.push(g);
    else if (st === 'done') {
      if (g.kind === 'text' && !o.starred) done.push({ type: 'text', generationId: g.id });
      for (const id of g.assetIds) {
        const a = assets[id];
        if (a && (!o.starred || a.favorite)) done.push({ type: 'asset', assetId: id, generationId: g.id });
      }
    } else if (o.showFailed || (isReloadInterrupted(g) && isFreeGeneration(g) && !retried.has(g.id))) failed.push(g);
  }
  return { done, failed, ongoing };
}

/** Operations that can start from one asset with no further input: no Sketch, no several-clip joins. */
export function suggestedOps(asset: Asset | undefined): OpId[] {
  if (!asset) return [];
  return opsFor(asset.kind).filter((o) => !OPS[o.id].viaSketch && !OPS[o.id].multiInput).map((o) => o.id);
}

/** Of the active mode's kind only: the last selected asset wins, otherwise the newest finished one. */
export function targetAsset(rows: BoardRows, selected: string[], assets: Record<string, Asset>, kind: AssetKind): string | undefined {
  const ids = rows.done.flatMap((c) => (c.type === 'asset' && assets[c.assetId]?.kind === kind ? [c.assetId] : []));
  const live = selected.filter((id) => ids.includes(id));
  return live.length ? live[live.length - 1] : ids[0];
}

/**
 * What Done shows. While something runs: only what finished since the batch began ("batch"; Ongoing sits above it and
 * keeps the attention), the rest folded behind "Show all"; when nothing runs, everything. The user's own toggle wins
 * until the running state next changes (true = all, false = folded).
 */
export type DoneMode = 'all' | 'batch' | 'folded';
export function doneMode({ running, override }: { running: boolean; override: boolean | null }): DoneMode {
  if (override != null) return override ? 'all' : 'folded';
  return running ? 'batch' : 'all';
}

/** The Done cells of the running batch: generations created since it began. */
export function batchCells(done: DoneCell[], generations: Record<string, Pick<Generation, 'createdAt'>>, since: number | null): DoneCell[] {
  return since == null ? [] : done.filter((c) => (generations[c.generationId]?.createdAt ?? 0) >= since);
}

type Stamped = Pick<Generation, 'createdAt' | 'planId' | 'sessionId'>;

/**
 * When the running batch began, read from the store (not from what a mounted board happened to see): the earliest
 * generation that is running, or that belongs to the same plan as one that is, so a board mounted mid-plan still lists
 * the steps that plan already finished. Null when nothing runs.
 */
export function batchStart(generations: Record<string, Stamped & Pick<Generation, 'discard'>>, ongoing: Stamped[]): number | null {
  if (!ongoing.length) return null;
  const plans = new Set(ongoing.flatMap((g) => (g.planId ? [`${g.sessionId}|${g.planId}`] : [])));
  const ofPlan = Object.values(generations).filter((g) => !g.discard && g.planId && plans.has(`${g.sessionId}|${g.planId}`));
  return Math.min(...[...ongoing, ...ofPlan].map((g) => g.createdAt));
}

/** The batch start a board keeps for `key` (session + scope): the earliest seen for that key; another key starts over, never reusing the old start. */
export function keepBatch(prev: { key: string; at: number | null }, key: string, start: number | null): { key: string; at: number | null } {
  const at = prev.key === key && prev.at != null && start != null ? Math.min(prev.at, start) : start;
  return { key, at };
}
