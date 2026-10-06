import { canvasIndex } from '../canvas';
import { OPS } from '../ops';
import type { Asset, AssetKind, Generation, Session, Workspace } from '../types';

/*
 * find_assets: the agent's view of this session's results and uploads — filter by kind, origin, canvas and date,
 * search words in the prompt, model, operation, file type or id, newest first. Only this session: other sessions
 * are never searched. With `view`, the first matches also travel as images (one round for "look at the last 3D").
 */

export interface AssetQuery {
  kind?: AssetKind[];
  query?: string;
  canvas?: 'this' | 'all';
  since?: string;
  origin?: Array<'generated' | 'upload' | 'view3d' | 'frame' | 'design'>;
  favorites?: boolean;
  sort?: 'newest' | 'oldest';
  limit?: number;
  offset?: number;
  view?: boolean;
}

export const VIEW_MAX = 4;

const EXT: Record<string, string> = { jpeg: 'jpg', 'gltf-binary': 'glb', 'gltf+json': 'gltf', mpeg: 'mp3', quicktime: 'mov', 'x-wav': 'wav', wave: 'wav' };
export function extensionOf(mime: string): string {
  const sub = mime.split('/')[1]?.split(';')[0] ?? '';
  return EXT[sub] ?? sub;
}

/** "24h", "7d", "today", or a date ("2026-10-02", "2026-10-02T07:30"): the earliest creation time, or NaN. */
export function sinceTime(since: string, now = Date.now()): number {
  const s = since.trim().toLowerCase();
  if (s === 'today') {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  const rel = /^(\d+(?:\.\d+)?)\s*(m|min|h|d|w)$/.exec(s);
  if (rel) return now - Number(rel[1]) * { m: 60e3, min: 60e3, h: 3600e3, d: 86400e3, w: 604800e3 }[rel[2] as 'm']!;
  return Date.parse(since);
}

function stamp(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** A usable capture must belong to this model's session, not just share an ID in its metadata. */
export function currentViewImage(a: Asset, assets: Record<string, Asset>): Asset | undefined {
  const view = a.kind === 'model3d' && a.viewImageId ? assets[a.viewImageId] : undefined;
  return view?.kind === 'image' && view.sessionId === a.sessionId ? view : undefined;
}

/** The stored model→capture relation, never a guess based on creation time. */
export function viewReferenceLabel(a: Asset, assets: Record<string, Asset>): string {
  if (a.kind === 'model3d') {
    const view = currentViewImage(a, assets);
    return view
      ? `current view image: asset:${view.id} (image reference; the 3D file itself is not an image reference)`
      : 'no current view image reference available';
  }
  if (a.origin !== 'view3d') return '';
  const model = Object.values(assets).find(x => x.kind === 'model3d' && x.sessionId === a.sessionId && x.viewImageId === a.id);
  const relation = model ? `current view image of 3D model asset:${model.id}` : 'saved 3D view image; not identified as a current view';
  return `${relation}, rendered by the app's 3D viewer (not by the 3D model provider)`;
}

/** What an asset is, in words the agent cannot misread. */
export function describeAsset(a: Asset, assets: Record<string, Asset>, generations: Record<string, Generation>): string {
  const g = a.generationId ? generations[a.generationId] : undefined;
  const shape = a.kind === 'model3d' ? '3D model' : a.kind === 'audio' ? `audio${a.duration ? ` ${a.duration.toFixed(1)}s` : ''}` : `${a.kind} ${a.width}×${a.height}${a.duration ? ` ${a.duration.toFixed(1)}s` : ''}`;
  const parts = [`asset:${a.id}`, `${shape} .${extensionOf(a.mime)}`, stamp(a.createdAt)];
  if (a.origin === 'view3d') {
    parts.push(viewReferenceLabel(a, assets));
  } else if (g) {
    const index = g.assetIds.length > 1 ? ` #${g.assetIds.indexOf(a.id) + 1} of ${g.assetIds.length}` : '';
    const what = g.op ? `${OPS[g.op.id].label} of asset:${g.op.sourceAssetId}` : `"${g.prompt.length > 90 ? `${g.prompt.slice(0, 89)}…` : g.prompt}"`;
    const s = g.settings;
    const params = [s.aspect && `aspect ${s.aspect}`, s.resolution && `res ${s.resolution}`, s.duration && `${s.duration}s`, s.count > 1 && `count ${s.count}`, s.seed != null && `seed ${s.seed}`].filter(Boolean).join(', ');
    parts.push(`${g.modelName}${index}`, what);
    if (params) parts.push(params);
    if (g.stepId) parts.push(`plan step ${g.stepId}`);
    if (g.inputs.refs.length || g.inputs.firstFrame) parts.push(`inputs ${[g.inputs.firstFrame && `first asset:${g.inputs.firstFrame}`, ...g.inputs.refs.map((r) => `asset:${r}`)].filter(Boolean).join(', ')}`);
  } else parts.push(a.origin === 'upload' ? 'uploaded by the user' : a.origin);
  if (a.kind === 'model3d') parts.push(viewReferenceLabel(a, assets));
  if (a.favorite) parts.push('favorite');
  return parts.join(' · ');
}

export function findAssets(session: Session, workspace: Workspace, assets: Record<string, Asset>, generations: Record<string, Generation>, q: AssetQuery, now = Date.now()) {
  const index = canvasIndex(session, generations);
  const since = q.since ? sinceTime(q.since, now) : NaN;
  const words = (q.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const rows = Object.values(assets)
    .filter((a) => a.sessionId === session.id && a.origin !== 'sketch' && a.origin !== 'mask')
    .filter((a) => !q.kind?.length || q.kind.includes(a.kind))
    .filter((a) => !q.origin?.length || q.origin.includes(a.origin as 'generated'))
    .filter((a) => (q.canvas ?? 'this') === 'all' || index.visible(a, workspace))
    .filter((a) => !q.favorites || a.favorite)
    .filter((a) => Number.isNaN(since) || a.createdAt >= since)
    .filter((a) => {
      if (!words.length) return true;
      const g = a.generationId ? generations[a.generationId] : undefined;
      const hay = [a.id, a.kind, a.origin, extensionOf(a.mime), g?.prompt, g?.modelName, g?.modelRef, g?.op && OPS[g.op.id].label, g?.stepId].filter(Boolean).join(' ').toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => (q.sort === 'oldest' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt));
  const offset = q.offset ?? 0;
  const page = rows.slice(offset, offset + Math.min(q.limit ?? 10, 20));
  const text = page.length
    ? `${rows.length} match${rows.length === 1 ? '' : 'es'}${rows.length > page.length ? ` (showing ${offset + 1}–${offset + page.length}; use offset for more)` : ''}:\n${page.map((a) => `- ${describeAsset(a, assets, generations)}`).join('\n')}`
    : 'No assets match.';
  return { rows: page, total: rows.length, text };
}

/** What `view` sends for each match: the asset itself, a 3D model's view image, nothing for audio or text. */
export function viewTargets(rows: Asset[], assets: Record<string, Asset>): Array<{ show?: string; note: string }> {
  return rows.slice(0, VIEW_MAX).map((a) => {
    if (a.kind === 'image' || a.kind === 'video') return { show: a.id, note: `asset:${a.id}` };
    if (a.kind === 'model3d') {
      const view = currentViewImage(a, assets);
      return view ? { show: view.id, note: `3D model asset:${a.id}, shown by its current view image asset:${view.id}` } : { note: `3D model asset:${a.id}: no valid current view image, cannot be shown` };
    }
    return { note: `asset:${a.id} (${a.kind}): nothing to show` };
  });
}
