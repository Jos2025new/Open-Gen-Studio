import { alphaFromOpacity, parseHexAlpha } from '../lib/color';
import { useStore } from '../store/store';
import { activeKit, activeKitItems } from './activeKit';
import { brandSlotFile, brandSlug } from './brandExportFolder';
import { getDoc, mutateDoc } from './design/actions';
import { tokenChoices, tokenOf, tokenPatch, type TokenChoice } from './design/tokenBind';
import { isKit, type LibraryAssetRef, type TokenRef } from './libraryTypes';
import type { DesignDoc, Layer, RasterLayer, Subject, VectorShape } from './types';

/* One-click auto-linking of an existing or imported Designer document to a Brand Kit (colors, fonts, sizes, radii, widths, logos). */

export interface BrandLinkSummary {
  kitId: string;
  kitName: string;
  colors: number;
  fonts: number;
  sizes: number;
  radii: number;
  widths: number;
  logos: number;
  total: number;
  ambiguous: string[];
}

const EMPTY_SUMMARY = (kitId = '', kitName = ''): BrandLinkSummary => ({
  kitId, kitName, colors: 0, fonts: 0, sizes: 0, radii: 0, widths: 0, logos: 0, total: 0, ambiguous: [],
});

function colorKey(hex: string, opacity?: number): string {
  const p = parseHexAlpha(hex);
  const base = (p ? p.color : hex).trim().toLowerCase();
  const alphaPct = opacity !== undefined ? alphaFromOpacity(opacity) : (p ? p.alpha : 100);
  return alphaPct < 100 ? `${base}|${alphaPct}` : base;
}

function buildLookup(kit: Subject, doc: DesignDoc, st = useStore.getState()) {
  const own = kit.id, mode = doc.tokenMode;
  const kits = activeKitItems({ ...st, composer: { ...st.composer, kitId: kit.id } }, own);
  const byColor = new Map<string, TokenRef>();
  const byOpaqueColor = new Map<string, TokenRef>();
  const byFont = new Map<string, TokenRef>();
  const byDim = new Map<number, TokenRef>();

  const register = (choices: TokenChoice[], kind: 'color' | 'font' | 'dim') => {
    for (const c of choices) {
      if (kind === 'color') {
        const raw = String(c.ref.value).trim().toLowerCase();
        const k = colorKey(raw);
        if (!byColor.has(k)) byColor.set(k, c.ref);
        if (raw.length === 7 && !byOpaqueColor.has(raw)) byOpaqueColor.set(raw, c.ref);
      } else if (kind === 'font') {
        const val = String(c.ref.value).trim().toLowerCase();
        if (val && !byFont.has(val)) byFont.set(val, c.ref);
      } else {
        const n = Math.round(Number(c.ref.value) * 100) / 100;
        if (Number.isFinite(n) && n > 0 && !byDim.has(n)) byDim.set(n, c.ref);
      }
    }
  };

  const fakeSt = { ...st, composer: { ...st.composer, kitId: kit.id } };
  register(tokenChoices('color', mode, own, fakeSt), 'color');
  register(tokenChoices('fontFamily', mode, own, fakeSt), 'font');
  register(tokenChoices('dimension', mode, own, fakeSt), 'dim');

  const slotByAsset = new Map<string, LibraryAssetRef>();
  const slotBySlug = new Map<string, LibraryAssetRef | 'ambiguous'>();
  const registerSlug = (slug: string, ref: LibraryAssetRef) => {
    if (!slug) return;
    const prev = slotBySlug.get(slug);
    if (!prev) slotBySlug.set(slug, ref);
    else if (prev !== 'ambiguous' && (prev.subjectId !== ref.subjectId || prev.nodeId !== ref.nodeId)) slotBySlug.set(slug, 'ambiguous');
  };
  for (const k of kits) {
    for (const n of k.graph?.nodes ?? []) {
      if (n.data.kind !== 'asset' || !n.data.assetId) continue;
      const slot = brandSlotFile(k, n.id, st.assets, n.data.title, n.data.assetId);
      const ref: LibraryAssetRef = {
        subjectId: k.id,
        nodeId: n.id,
        assetId: n.data.assetId,
        slug: slot.slug,
        filename: slot.filename,
      };
      if (!slotByAsset.has(n.data.assetId)) slotByAsset.set(n.data.assetId, ref);
      const sec = (n.data.section || '').trim().toLowerCase();
      // Name-based matching is restricted to Logos/Icons slots so random Photos never hijack an imported logo layer.
      if (sec === 'logos' || sec === 'icons') {
        const titleSlug = brandSlug((n.data.title || '').replace(/\.[a-z0-9]+$/i, ''), '');
        registerSlug(titleSlug, ref);
        const assetName = st.assets[n.data.assetId]?.name?.replace(/\.[a-z0-9]+$/i, '') ?? '';
        const assetSlug = assetName ? brandSlug(assetName, '') : '';
        if (assetSlug && assetSlug !== titleSlug) registerSlug(assetSlug, ref);
      }
    }
  }
  return { byColor, byOpaqueColor, byFont, byDim, slotByAsset, slotBySlug };
}

function matchDim(map: ReadonlyMap<number, TokenRef>, value: number | undefined): TokenRef | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return map.get(Math.round(value * 100) / 100);
}

function matchColor(map: ReadonlyMap<string, TokenRef>, hex: string | null | undefined, opacity?: number): TokenRef | undefined {
  if (!hex) return undefined;
  const full = colorKey(hex, opacity);
  // Never fall back from a semi-transparent color ("#rrggbb|<pct>") to an opaque token.
  return map.get(full) ?? (full.includes('|') ? undefined : map.get(hex.trim().toLowerCase()));
}

function applyAutoLink(doc: DesignDoc, kit: Subject, st = useStore.getState()): { doc: DesignDoc; summary: BrandLinkSummary } {
  const { byColor, byOpaqueColor, byFont, byDim, slotByAsset, slotBySlug } = buildLookup(kit, doc, st);
  const summary = EMPTY_SUMMARY(kit.id, kit.name);
  let changed = false;

  const layers: Layer[] = doc.layers.map((l): Layer => {
    if (l.type === 'text') {
      let next = l;
      if (!tokenOf(next, 'color')) {
        const ref = matchColor(byColor, next.color, next.colorOpacity);
        if (ref) { next = { ...next, ...tokenPatch('color', String(ref.value), ref) }; summary.colors++; changed = true; }
      }
      if (!tokenOf(next, 'fontFamily')) {
        const ref = byFont.get(next.fontFamily.trim().toLowerCase());
        if (ref) { next = { ...next, ...tokenPatch('fontFamily', String(ref.value), ref) }; summary.fonts++; changed = true; }
      }
      if (!tokenOf(next, 'fontSize')) {
        const ref = matchDim(byDim, next.fontSize);
        if (ref) { next = { ...next, fontSize: Number(ref.value), fontSizeToken: ref }; summary.sizes++; changed = true; }
      }
      return next;
    }

    if (l.type === 'raster') {
      let next: RasterLayer = l;
      if (!next.libraryAsset) {
        const byAsset = next.sourceAssetId ? slotByAsset.get(next.sourceAssetId) : undefined;
        // If the layer has a known sourceAssetId that does NOT belong to the kit, never hijack it by filename match.
        let matched: LibraryAssetRef | undefined = byAsset;
        if (!matched && !next.sourceAssetId) {
          const nameSlug = brandSlug(next.name.replace(/\.[a-z0-9]+$/i, ''), '');
          const candidate = nameSlug ? slotBySlug.get(nameSlug) : undefined;
          if (candidate === 'ambiguous') summary.ambiguous.push(next.name);
          else matched = candidate;
        }
        if (matched) { next = { ...next, libraryAsset: matched }; summary.logos++; changed = true; }
      }
      if (!tokenOf(next, 'width')) {
        const ref = matchDim(byDim, next.width);
        if (ref) { next = { ...next, width: Number(ref.value), widthToken: ref }; summary.widths++; changed = true; }
      }
      return next;
    }

    if (l.type !== 'vector') return l;
    let layerChanged = false;
    const shapes: VectorShape[] = l.shapes.map((s) => {
      let ns = s;
      if (!tokenOf(ns, 'fill') && ns.fill) {
        const ref = matchColor(byColor, ns.fill, ns.fillOpacity);
        if (ref) { ns = { ...ns, ...tokenPatch('fill', String(ref.value), ref) }; summary.colors++; layerChanged = true; }
      }
      if (!tokenOf(ns, 'stroke') && ns.stroke) {
        const ref = matchColor(byColor, ns.stroke, ns.strokeOpacity);
        if (ref) { ns = { ...ns, ...tokenPatch('stroke', String(ref.value), ref) }; summary.colors++; layerChanged = true; }
      }
      for (const gKey of ['fillGradient', 'strokeGradient'] as const) {
        const grad = ns[gKey];
        if (!grad) continue;
        let gChanged = false;
        const stops = grad.stops.map((stop) => {
          if (tokenOf(stop, 'color')) return stop;
          const ref = matchColor(byColor, stop.color, stop.alpha);
          if (!ref) return stop;
          summary.colors++; gChanged = true; layerChanged = true;
          return { ...stop, ...tokenPatch('color', String(ref.value), ref, undefined, 'alpha') };
        });
        if (gChanged) ns = { ...ns, [gKey]: { ...grad, stops } };
      }
      if (ns.type === 'rect' && !tokenOf(ns, 'radius')) {
        const rx = ns.rx ?? ns.radius, ry = ns.ry ?? ns.radius;
        if (rx > 0 && Math.abs(rx - ry) < 0.01) {
          const ref = matchDim(byDim, rx);
          if (ref) { ns = { ...ns, ...tokenPatch('radius', Number(ref.value), ref) }; summary.radii++; layerChanged = true; }
        }
      }
      if (ns.type !== 'path' && !tokenOf(ns, 'width')) {
        const ref = matchDim(byDim, Math.abs(ns.w));
        if (ref) { ns = { ...ns, w: (ns.w < 0 ? -1 : 1) * Number(ref.value), widthToken: ref }; summary.widths++; layerChanged = true; }
      }
      return ns;
    });

    const strokes = l.strokes?.map((stItem) => {
      if (tokenOf(stItem, 'color')) return stItem;
      const ref = matchColor(byColor, stItem.color, stItem.opacity);
      if (!ref) return stItem;
      summary.colors++; layerChanged = true;
      return { ...stItem, ...tokenPatch('color', String(ref.value), ref, undefined, 'opacity') };
    });

    if (!layerChanged) return l;
    changed = true;
    return { ...l, shapes, ...(strokes ? { strokes } : {}) };
  });

  let nextDoc = changed ? { ...doc, layers } : doc;
  if (nextDoc.background && !tokenOf(nextDoc, 'background')) {
    const ref = byOpaqueColor.get(nextDoc.background.trim().toLowerCase());
    if (ref) {
      nextDoc = { ...nextDoc, ...tokenPatch('background', String(ref.value), ref) };
      summary.colors++;
      changed = true;
    }
  }
  summary.total = summary.colors + summary.fonts + summary.sizes + summary.radii + summary.widths + summary.logos;
  return { doc: changed ? { ...nextDoc, updatedAt: Date.now() } : doc, summary };
}

function resolveKit(kitId?: string, st = useStore.getState()): Subject | null {
  const k = kitId ? st.library.find((s) => s.id === kitId && isKit(s)) : activeKit(st);
  return k && k.kind !== 'moodboard' ? k : null;
}

/** Counts how many unlinked colors, fonts, sizes, radii, widths and logos in `doc` match the Brand Kit. */
export function previewBrandLink(doc: DesignDoc, kitId?: string, st = useStore.getState()): BrandLinkSummary {
  const kit = resolveKit(kitId, st);
  if (!kit) return EMPTY_SUMMARY();
  return applyAutoLink(doc, kit, st).summary;
}

/** Links all matching colors, fonts, sizes, radii, widths and logos of a Designer document to a Brand Kit in one undo step. */
export function autoLinkDocToBrand(sessionId: string, docId: string, kitId?: string): BrandLinkSummary {
  const st = useStore.getState(), doc = getDoc(sessionId, docId), kit = resolveKit(kitId, st);
  if (!doc) throw new Error(`No document "${docId}" in session "${sessionId}".`);
  if (!kit) throw new Error(kitId ? `No Brand Kit "${kitId}".` : 'No brand kit is in use.');
  const { doc: next, summary } = applyAutoLink(doc, kit, st);
  if (summary.total > 0) mutateDoc(sessionId, docId, () => next);
  return summary;
}

/** Human-readable summary of matched/linked items (e.g. "4 colors, 1 font and 1 logo"). */
export function formatBrandLinkSummary(s: BrandLinkSummary): string {
  const parts: string[] = [];
  const add = (n: number, one: string, many: string) => { if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`); };
  add(s.colors, 'color', 'colors');
  add(s.fonts, 'font', 'fonts');
  add(s.sizes, 'size', 'sizes');
  add(s.radii, 'radius', 'radii');
  add(s.widths, 'width', 'widths');
  add(s.logos, 'logo', 'logos');
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
