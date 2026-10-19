import type { Asset, AssetKind, Generation, OpId } from '../../engine/types';
import type { Place } from '../../engine/placeTypes';
import { OPS, opsFor } from '../../engine/ops';
import { filterGenerations, statusOf, type GenerationQuery } from '../shell/generationsView';

/** One cell of the Done row: a finished asset. */
export type DoneCell = { type: 'asset'; assetId: string; generationId: string };

export interface BoardOptions extends GenerationQuery {
  /** Favorites only: finished assets the user starred. */
  starred: boolean;
  showFailed: boolean;
  scope: 'all' | { sessionId: string };
  /** A Space shows its own place; a workspace board (`workspace`) never shows what a Space made. */
  place?: Place | 'workspace';
}

/** `failed` is filled only with "show failed" on: its own row, never mixed into Done. */
export interface BoardRows { done: DoneCell[]; failed: Generation[]; ongoing: Generation[] }

/** Rows of the board: finished results on top, running or queued generations below. */
export function splitBoard(generations: Record<string, Generation>, assets: Record<string, Asset>, o: BoardOptions): BoardRows {
  const inPlace = (g: Generation) => !o.place || o.place === 'workspace' ? g.place !== 'space-create' && g.place !== 'space-tools' : g.place === o.place;
  const inScope = Object.values(generations).filter((g) => !g.discard && inPlace(g) && (o.scope === 'all' || g.sessionId === o.scope.sessionId));
  const list = filterGenerations(inScope, { kind: o.kind, status: o.status, q: o.q, sort: o.sort });
  const done: DoneCell[] = [];
  const ongoing: Generation[] = [];
  const failed: Generation[] = [];
  for (const g of list) {
    const st = statusOf(g);
    if (st === 'running') ongoing.push(g);
    else if (st === 'done') {
      for (const id of g.assetIds) {
        const a = assets[id];
        if (a && (!o.starred || a.favorite)) done.push({ type: 'asset', assetId: id, generationId: g.id });
      }
    } else if (o.showFailed) failed.push(g);
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
 * Whether the Done row is open. Studio folds it while something runs (Ongoing gets the room) and opens it again when
 * nothing does; the user's own toggle wins until the running state next changes. Elsewhere it is open unless folded by hand.
 */
export function doneExpanded({ running, override, auto }: { running: boolean; override: boolean | null; auto: boolean }): boolean {
  return override ?? (auto ? !running : true);
}
