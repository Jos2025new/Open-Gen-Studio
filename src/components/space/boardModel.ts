import type { Asset, Generation, OpId } from '../../engine/types';
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

/** Selected assets win (last one picked); otherwise the newest finished asset. */
export function targetAsset(rows: BoardRows, selected: string[]): string | undefined {
  const live = selected.filter((id) => rows.done.some((c) => c.type === 'asset' && c.assetId === id));
  if (live.length) return live[live.length - 1];
  const first = rows.done.find((c) => c.type === 'asset');
  return first?.type === 'asset' ? first.assetId : undefined;
}
