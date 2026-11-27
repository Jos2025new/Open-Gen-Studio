import type { TokenRef } from './libraryTypes';
import type { DesignDoc, Layer, LayerGroup, RasterLayer, TextLayer, VectorLayer, VectorShape } from './types';

/* Pure surgical diff, revert and component-comparison helpers for brandSync.ts. */

export interface LayerRevert { layerId: string; before: Layer; after: Layer }
export interface GroupRevert { groupId: string; beforeGroup: LayerGroup; beforeMembers: Layer[]; afterMemberIds: string[]; writtenBlobKeys: string[] }
export interface DocRevertPatch {
  docId: string;
  backgroundBefore?: { background: string | null; backgroundToken?: TokenRef };
  backgroundAfter?: { background: string | null; backgroundToken?: TokenRef };
  layers: Map<string, LayerRevert>;
  groups: Map<string, GroupRevert>;
}

const RASTER_SYNC_KEYS: ReadonlyArray<keyof RasterLayer> = ['width', 'height', 'pxWidth', 'pxHeight', 'rev', 'sourceAssetId', 'libraryAsset', 'widthToken'];
const TEXT_SYNC_KEYS: ReadonlyArray<keyof TextLayer> = ['color', 'colorToken', 'colorOpacity', 'fontFamily', 'fontFamilyToken', 'fontSize', 'fontSizeToken'];
const SHAPE_SYNC_KEYS: ReadonlyArray<keyof VectorShape> = ['fill', 'fillToken', 'fillOpacity', 'stroke', 'strokeToken', 'strokeOpacity', 'radius', 'rx', 'ry', 'radiusToken', 'w', 'widthToken', 'fillGradient', 'strokeGradient'];

const PAIRED_VALUE_KEY: Record<string, string> = {
  colorToken: 'color', colorOpacity: 'color',
  fillToken: 'fill', fillOpacity: 'fill',
  strokeToken: 'stroke', strokeOpacity: 'stroke',
  fontFamilyToken: 'fontFamily', fontSizeToken: 'fontSize',
  radiusToken: 'radius', rx: 'radius', ry: 'radius',
  widthToken: 'width',
};

function sameVal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function emptyDocPatch(docId: string): DocRevertPatch {
  return { docId, layers: new Map(), groups: new Map() };
}

export function recordLayerPatch(patch: DocRevertPatch, before: Layer, after: Layer): void {
  const prev = patch.layers.get(before.id);
  patch.layers.set(before.id, { layerId: before.id, before: prev ? prev.before : before, after });
}

export function diffDocForTokens(prev: DesignDoc, next: DesignDoc): DocRevertPatch | null {
  const patch = emptyDocPatch(prev.id);
  let any = false;
  if (prev.background !== next.background || !sameVal(prev.backgroundToken, next.backgroundToken)) {
    patch.backgroundBefore = { background: prev.background, backgroundToken: prev.backgroundToken };
    patch.backgroundAfter = { background: next.background, backgroundToken: next.backgroundToken };
    any = true;
  }
  const prevById = new Map(prev.layers.map((l) => [l.id, l]));
  for (const nextL of next.layers) {
    const prevL = prevById.get(nextL.id);
    if (prevL && prevL !== nextL) {
      recordLayerPatch(patch, prevL, nextL);
      any = true;
    }
  }
  return any ? patch : null;
}

function revertFields<T extends object>(cur: T, before: T, after: T, keys: ReadonlyArray<keyof T>): T {
  let out: T | null = null;
  const curBag = cur as Record<string, unknown>, afterBag = after as Record<string, unknown>;
  for (const k of keys) {
    if (sameVal(before[k], after[k])) continue;
    // Preserve user edits made after the sync on this field or its primary value field.
    if (!sameVal(cur[k], after[k])) continue;
    const primary = PAIRED_VALUE_KEY[String(k)];
    if (primary && primary in curBag && primary in afterBag && !sameVal(curBag[primary], afterBag[primary])) continue;
    if (String(k) === 'widthToken' && 'w' in curBag && 'w' in afterBag && !sameVal(curBag.w, afterBag.w)) continue;
    if (!out) out = { ...cur };
    out[k] = before[k];
  }
  return out ?? cur;
}

export function revertLayerSurgical(cur: Layer, before: Layer, after: Layer): Layer {
  if (cur.type !== before.type || cur.type !== after.type) return cur;
  if (cur.type === 'raster') return revertFields(cur, before as RasterLayer, after as RasterLayer, RASTER_SYNC_KEYS);
  if (cur.type === 'text') return revertFields(cur, before as TextLayer, after as TextLayer, TEXT_SYNC_KEYS);
  if (cur.type === 'vector') {
    const bVec = before as VectorLayer, aVec = after as VectorLayer;
    const bShapes = new Map(bVec.shapes.map((s) => [s.id, s]));
    const aShapes = new Map(aVec.shapes.map((s) => [s.id, s]));
    let shapesChanged = false;
    const shapes = cur.shapes.map((s) => {
      const bs = bShapes.get(s.id), as = aShapes.get(s.id);
      if (!bs || !as || bs === as) return s;
      const next = revertFields(s, bs, as, SHAPE_SYNC_KEYS);
      if (next !== s) shapesChanged = true;
      return next;
    });
    let strokesChanged = false;
    let strokes = cur.strokes;
    if (cur.strokes && bVec.strokes && aVec.strokes) {
      const bSt = new Map(bVec.strokes.map((s) => [s.id, s]));
      const aSt = new Map(aVec.strokes.map((s) => [s.id, s]));
      strokes = cur.strokes.map((st) => {
        const bs = bSt.get(st.id), as = aSt.get(st.id);
        if (!bs || !as || bs === as) return st;
        const next = revertFields(st, bs, as, ['color', 'colorToken', 'opacity']);
        if (next !== st) strokesChanged = true;
        return next;
      });
    }
    return shapesChanged || strokesChanged ? { ...cur, shapes, ...(strokes ? { strokes } : {}) } : cur;
  }
  return cur;
}

export function mergeDocPatches(base: DocRevertPatch, extra: DocRevertPatch): DocRevertPatch {
  const out: DocRevertPatch = {
    docId: base.docId,
    backgroundBefore: base.backgroundBefore ?? extra.backgroundBefore,
    backgroundAfter: extra.backgroundAfter ?? base.backgroundAfter,
    layers: new Map(base.layers),
    groups: new Map(base.groups),
  };
  for (const [id, lr] of extra.layers) {
    const prev = out.layers.get(id);
    out.layers.set(id, prev ? { layerId: id, before: prev.before, after: lr.after } : lr);
  }
  for (const [gid, gr] of extra.groups) {
    const prev = out.groups.get(gid);
    out.groups.set(gid, prev ? {
      groupId: gid,
      beforeGroup: prev.beforeGroup,
      beforeMembers: prev.beforeMembers,
      afterMemberIds: gr.afterMemberIds,
      writtenBlobKeys: [...prev.writtenBlobKeys, ...gr.writtenBlobKeys],
    } : gr);
  }
  return out;
}

export function componentChanged(prevDoc: DesignDoc | undefined, nextDoc: DesignDoc, pieceId: string): boolean {
  if (!prevDoc) return true;
  const prevGroup = (prevDoc.groups ?? []).find((g) => g.id === pieceId);
  const nextGroup = (nextDoc.groups ?? []).find((g) => g.id === pieceId);
  if (!prevGroup || !nextGroup) return true;
  const prevLayers = prevDoc.layers.filter((l) => l.groupId === pieceId);
  const nextLayers = nextDoc.layers.filter((l) => l.groupId === pieceId);
  const normGroup = (g: LayerGroup) => ({ name: g.name, keptHidden: g.keptHidden, keptLocked: g.keptLocked });
  return JSON.stringify(normGroup(prevGroup)) !== JSON.stringify(normGroup(nextGroup)) || JSON.stringify(prevLayers) !== JSON.stringify(nextLayers);
}

/** Preserves local text overrides made by the user on a component instance when syncing from prevSrc to nextLayers. */
export function preserveLocalTextOverrides(curMembers: readonly Layer[], prevSrcLayers: readonly Layer[], nextLayers: Layer[]): Layer[] {
  const curTexts = curMembers.filter((l): l is TextLayer => l.type === 'text');
  const prevTexts = prevSrcLayers.filter((l): l is TextLayer => l.type === 'text');
  if (!curTexts.length || !prevTexts.length) return nextLayers;
  let ti = 0;
  return nextLayers.map((l) => {
    if (l.type !== 'text') return l;
    const cur = curTexts.find((c) => c.name === l.name) ?? curTexts[ti];
    const prev = prevTexts.find((p) => p.name === l.name) ?? prevTexts[ti];
    ti++;
    if (cur && prev && cur.text !== prev.text) return { ...l, text: cur.text };
    return l;
  });
}
