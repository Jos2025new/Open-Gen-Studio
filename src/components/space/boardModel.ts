import type { Asset, AssetKind, Generation, OpId } from '../../engine/types';
import { OPS, opsFor } from '../../engine/ops';
import { filterGenerations, statusOf, type GenerationQuery } from '../shell/generationsView';

/** One cell of the Done row: a finished asset, or (with "show failed") a generation that did not finish. */
export type DoneCell = { type: 'asset'; assetId: string; generationId: string } | { type: 'failed'; generation: Generation };

export interface BoardOptions extends GenerationQuery {
  /** Favorites only: finished assets the user starred. */
  starred: boolean;
  showFailed: boolean;
  scope: 'all' | { sessionId: string };
}

export interface BoardRows { done: DoneCell[]; ongoing: Generation[] }

/** Rows of the board: finished results on top, running or queued generations below. */
export function splitBoard(generations: Record<string, Generation>, assets: Record<string, Asset>, o: BoardOptions): BoardRows {
  const inScope = Object.values(generations).filter((g) => !g.discard && (o.scope === 'all' || g.sessionId === o.scope.sessionId));
  const list = filterGenerations(inScope, { kind: o.kind, status: o.status, q: o.q, sort: o.sort });
  const done: DoneCell[] = [];
  const ongoing: Generation[] = [];
  for (const g of list) {
    const st = statusOf(g);
    if (st === 'running') ongoing.push(g);
    else if (st === 'done') {
      for (const id of g.assetIds) {
        const a = assets[id];
        if (a && (!o.starred || a.favorite)) done.push({ type: 'asset', assetId: id, generationId: g.id });
      }
    } else if (o.showFailed && !o.starred) done.push({ type: 'failed', generation: g });
  }
  return { done, ongoing };
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
