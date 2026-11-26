import { alphaFromOpacity, opacityFromAlpha, parseHexAlpha } from '../../lib/color';
import { setComposer, setDoc, setUi, useStore } from '../../store/store';
import { activeKit, activeKitItems } from '../activeKit';
import { isKit } from '../libraryTypes';
import { parseTokenAlias, resolveToken } from '../libraryTokens';
import { colorHex } from '../libraryTokensColor';
import type { KitTokenType, TokenRef } from '../libraryTypes';
import type { Layer, Subject, TextStyle } from '../types';
import type { DesignDoc } from './docType';

/* Values of a document taken from the tokens of a Library entry: they change when the token or the document's mode does. */
type Field = 'color' | 'fill' | 'stroke' | 'fontFamily' | 'fontSize' | 'background';
type OpacityKey = 'colorOpacity' | 'fillOpacity' | 'strokeOpacity' | 'alpha' | 'opacity';
type Bag = Record<string, unknown>;
const TYPE: Record<Field, KitTokenType> = { color: 'color', fill: 'color', stroke: 'color', background: 'color', fontFamily: 'fontFamily', fontSize: 'dimension' };
const REQUIRED_OPACITY = new Set<OpacityKey>(['alpha', 'opacity']);
/** What a token that does not exist leaves. */
const NONE: Partial<Record<KitTokenType, string | number>> = { color: '#000000', fontFamily: 'Inter', dimension: 32 };
const key = (f: Field) => `${f}Token`;
const opacityKeyOf = (obj: object, f: Field): OpacityKey | undefined =>
  f === 'fill' ? 'fillOpacity' : f === 'stroke' ? 'strokeOpacity' : f !== 'color' ? undefined : 'alpha' in obj ? 'alpha' : 'thinning' in obj ? 'opacity' : 'colorOpacity';
const opacityVal = (opKey: OpacityKey, op: number | undefined): number | undefined =>
  op !== undefined && op < 1 ? op : REQUIRED_OPACITY.has(opKey) ? 1 : undefined;

/** A token's value as the Designer uses it: a 6- or 8-digit hex color, px, or a font name; undefined when it has none. */
export function tokenValue(kit: Subject | undefined, token: string, mode?: string): string | number | undefined {
  const t = kit?.tokens?.[token], raw = t && resolveToken(kit.tokens!, token, mode);
  if (raw === undefined) return undefined;
  if (t!.type === 'color') { const hex = colorHex(String(raw)); return hex?.length === 7 || hex?.length === 9 ? hex.toLowerCase() : undefined; }
  if (t!.type === 'fontFamily') return String(raw).split(',')[0].trim().replace(/^(['"])(.*)\1$/, '$2');
  if (t!.type !== 'dimension') return raw;
  const m = /^(\d+(?:\.\d+)?)(px|rem)?$/.exec(String(raw).trim());
  return m ? Number(m[1]) * (m[2] === 'rem' ? 16 : 1) : undefined;
}

function colorTokenPatch(f: Field, raw: string, ref?: TokenRef, prev?: TokenRef, opKey?: OpacityKey): Bag {
  const src = typeof ref?.value === 'string' ? ref.value : raw, p = parseHexAlpha(src);
  const c = p ? p.color : raw, hasAlpha = Boolean(p && src.trim().replace(/^#/, '').length === 8);
  const reset = !hasAlpha && typeof prev?.value === 'string' && prev.value.length === 9;
  const op = opKey && (hasAlpha || reset) ? { [opKey]: opacityVal(opKey, hasAlpha ? opacityFromAlpha(p!.alpha) : undefined) } : {};
  return { [f]: c, [key(f)]: f === 'background' && hasAlpha ? undefined : ref, ...op };
}

/** Opaque color + tool opacity for tools that have no token field of their own (brush). */
export function brushColorPatch(value: string): { color: string; opacity?: number } {
  const p = parseHexAlpha(value);
  return p ? { color: p.color, ...(value.trim().replace(/^#/, '').length === 8 ? { opacity: Math.max(0.01, opacityFromAlpha(p.alpha)) } : {}) } : { color: value };
}

/** A field with a new value, taken from a token or not (writes #rrggbb + its opacity field when transparent). */
export function tokenPatch(field: 'fontFamily', value: string, ref?: TokenRef): { fontFamily: string; fontFamilyToken?: TokenRef };
export function tokenPatch(field: 'background', value: string, ref?: TokenRef, prev?: TokenRef): { background: string; backgroundToken?: TokenRef };
export function tokenPatch<F extends 'fill' | 'stroke'>(field: F, value: string, ref?: TokenRef, prev?: TokenRef): { [K in F]: string } & { [K in `${F}Token`]?: TokenRef } & { [K in `${F}Opacity`]?: number };
export function tokenPatch(field: 'color', value: string, ref?: TokenRef, prev?: TokenRef): { color: string; colorToken?: TokenRef; colorOpacity?: number };
export function tokenPatch<O extends 'alpha' | 'opacity'>(field: 'color', value: string, ref: TokenRef | undefined, prev: TokenRef | undefined, opKey: O): { color: string; colorToken?: TokenRef } & Partial<Record<O, number>>;
export function tokenPatch(field: Field, value: string, ref?: TokenRef, prev?: TokenRef, opKey?: 'alpha' | 'opacity'): Bag {
  if (TYPE[field] !== 'color') return { [field]: value, [key(field)]: ref };
  const ok: OpacityKey | undefined = opKey ?? (field === 'fill' ? 'fillOpacity' : field === 'stroke' ? 'strokeOpacity' : field === 'color' ? 'colorOpacity' : undefined);
  return colorTokenPatch(field, value, ref, prev, ok);
}
/** A family of an entry, with its token when it has one. */
export function familyPatch(kit: Subject, family: string) {
  const token = Object.keys(kit.tokens ?? {}).find((n) => kit.tokens![n].type === 'fontFamily' && tokenValue(kit, n) === family);
  return tokenPatch('fontFamily', family, token ? { kit: kit.id, token, value: family } : undefined);
}
/** The token a field's value comes from, while it still does. */
export const tokenOf = (obj: object, field: Field): TokenRef | undefined => {
  const ref = (obj as Bag)[key(field)] as TokenRef | undefined;
  if (!ref) return undefined;
  if (typeof ref.value === 'string' && ref.value.length === 9) {
    const p = parseHexAlpha(ref.value), opKey = opacityKeyOf(obj, field), op = opKey ? ((obj as Bag)[opKey] as number | undefined) ?? 1 : 1;
    return p && (obj as Bag)[field] === p.color && alphaFromOpacity(op) === p.alpha ? ref : undefined;
  }
  return ref.value === (obj as Bag)[field] ? ref : undefined;
};

export interface TokenChoice { ref: TokenRef; label: string; kit: string }
/** The tokens that fit a field: of the entry in use, then of the one the document belongs to (`own`), and of those they contain. */
export function tokenChoices(type: KitTokenType, mode?: string, own?: string, st = useStore.getState()): TokenChoice[] {
  return activeKitItems(st, own).flatMap((s) => Object.entries(s.tokens ?? {}).flatMap(([token, t]) => {
    const value = t.type === type ? tokenValue(s, token, mode) : undefined;
    return value === undefined ? [] : [{ ref: { kit: s.id, token, value }, label: token, kit: s.name }];
  }));
}
const fieldChoices = (f: Field, mode?: string, own?: string) => tokenChoices(TYPE[f], mode, own).filter((c) => f !== 'background' || String(c.ref.value).length === 7);

const WRITTEN: Record<string, Field> = { color: 'color', fill: 'fill', stroke: 'stroke', background: 'background', fontFamily: 'fontFamily', font_family: 'fontFamily', fontSize: 'fontSize', font_size: 'fontSize' };
/** A style as written: a size as "{token}" becomes its number (text is laid out at once); the other tokens are placed by syncTokens. */
export function writtenStyle(style: Omit<Partial<TextStyle>, 'fontSize'> & { fontSize?: number | string }, own?: string, mode?: string): Partial<TextStyle> {
  const { fontSize, ...rest } = style, alias = parseTokenAlias(fontSize);
  if (typeof fontSize !== 'string') return fontSize === undefined ? rest : { ...rest, fontSize };
  const found = tokenChoices('dimension', mode, own).find((c) => c.ref.token === alias)?.ref;
  if (!found) throw new Error(`No size token "${fontSize}".`);
  return { ...rest, fontSize: Number(found.value), fontSizeToken: found };
}

/** What is wrong with the "{token}" values of what the agent writes: the ones the entry in use does not have, and the ones it does. */
export function tokenProblem(written: unknown, own?: string): string | null {
  const bad = new Map<string, Field>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
      const field = Object.hasOwn(WRITTEN, k) ? WRITTEN[k] : undefined, alias = field ? parseTokenAlias(x) : null;
      if (alias !== null && !fieldChoices(field!, undefined, own).some((c) => c.ref.token === alias)) bad.set(alias, field!);
      else walk(x);
    }
  };
  walk(written);
  if (!bad.size) return null;
  const [kit] = activeKitItems(undefined, own), has = [...new Set(bad.values())].map((f) => `${f === 'background' ? 'opaque color' : TYPE[f]}: ${[...new Set(fieldChoices(f, undefined, own).map((c) => c.label))].slice(0, 30).join(', ') || 'none'}`);
  return `no token ${[...bad.keys()].map((n) => `"{${n}}"`).join(', ')}${kit ? ` in ${kit.name}; it has ${has.join('; ')}` : ': no brand is in use'}. Write one of its tokens or a plain value.`;
}

/** One object with its fields up to date; the same object when nothing changed. A value written as "{token}" becomes that token's. */
function fresh<T extends object>(obj: T, fields: readonly Field[], library: readonly Subject[], mode?: string, own?: string): T {
  let out: Bag | null = null;
  for (const f of fields) {
    const cur = (out ?? obj) as Bag, value = cur[f], alias = parseTokenAlias(value);
    if (alias !== null) {
      const found = fieldChoices(f, mode, own).find((c) => c.ref.token === alias);
      out = TYPE[f] === 'color'
        ? { ...cur, ...colorTokenPatch(f, String(found?.ref.value ?? NONE.color), found?.ref, undefined, opacityKeyOf(obj, f)) }
        : { ...cur, [f]: found?.ref.value ?? NONE[TYPE[f]], [key(f)]: found?.ref };
      continue;
    }
    const ref = tokenOf(cur, f);
    const raw = ref && tokenValue(library.find((s) => s.id === ref.kit), ref.token, mode);
    const next = f === 'background' && typeof raw === 'string' && raw.length === 9 ? undefined : raw;
    if (next !== undefined && next !== ref!.value && typeof next === typeof value) {
      const nextRef = { ...ref!, value: next };
      out = TYPE[f] === 'color' ? { ...cur, ...colorTokenPatch(f, String(next), nextRef, ref, opacityKeyOf(obj, f)) } : { ...cur, [f]: next, [key(f)]: nextRef };
    }
  }
  return (out as T | null) ?? obj;
}
function each<T>(list: readonly T[], fn: (x: T) => T): T[] {
  let same = true;
  const out = list.map((x) => { const y = fn(x); if (y !== x) same = false; return y; });
  return same ? (list as T[]) : out;
}

/** The document with its token values up to date; the same one when nothing changed. */
function syncTokens(doc: DesignDoc, library: readonly Subject[]): DesignDoc {
  const own = doc.library?.subjectId, mode = doc.tokenMode, one = <T extends object>(x: T, ...f: Field[]) => fresh(x, f, library, mode, own);
  const layers = each(doc.layers, (l): Layer => {
    if (l.type === 'text') return one(l, 'color', 'fontFamily', 'fontSize');
    if (l.type !== 'vector') return l;
    const shapes = each(l.shapes, (s) => {
      let n = one(s, 'fill', 'stroke');
      for (const g of ['fillGradient', 'strokeGradient'] as const) {
        const paint = n[g], stops = paint && each(paint.stops, (x) => one(x, 'color'));
        if (paint && stops !== paint.stops) n = { ...n, [g]: { ...paint, stops } };
      }
      return n;
    });
    const strokes = l.strokes && each(l.strokes, (s) => one(s, 'color'));
    return shapes === l.shapes && strokes === l.strokes ? l : { ...l, shapes, ...(strokes ? { strokes } : {}) };
  });
  const page = one(doc, 'background');
  return layers === doc.layers ? page : { ...page, layers };
}

/** The modes of the entries a document takes values from, and of the one in use. */
export function docModes(doc: DesignDoc, st = useStore.getState()): string[] {
  const ids = new Set(activeKitItems(st, doc.library?.subjectId).map((s) => s.id));
  const from = (obj: object, ...fields: Field[]) => fields.forEach((f) => { const r = tokenOf(obj, f); if (r) ids.add(r.kit); });
  from(doc, 'background');
  for (const l of doc.layers) {
    if (l.type === 'text') from(l, 'color', 'fontFamily', 'fontSize');
    else if (l.type === 'vector') { for (const s of l.shapes) { from(s, 'fill', 'stroke'); for (const g of [s.fillGradient, s.strokeGradient]) g?.stops.forEach((x) => from(x, 'color')); } l.strokes?.forEach((s) => from(s, 'color')); }
  }
  return [...new Set(st.library.filter((s) => ids.has(s.id)).flatMap((s) => Object.values(s.tokens ?? {}).flatMap((t) => Object.keys(t.modes ?? {}))))];
}

/** Keeps the documents of the session on screen up to date; not an undo step: the change is the token's. */
export function installTokenSync(): () => void {
  const done = new WeakMap<DesignDoc, readonly Subject[]>();
  return useStore.subscribe((st, prev) => {
    const session = st.sessions[st.activeSessionId];
    if (!session || (session === prev.sessions[st.activeSessionId] && st.library === prev.library && st.activeSessionId === prev.activeSessionId)) return;
    for (const doc of session.docs) {
      if (done.get(doc) === st.library) continue;
      done.set(doc, st.library);
      const next = syncTokens(doc, st.library);
      if (next === doc) continue;
      done.set(next, st.library);
      setDoc(session.id, doc.id, (d) => (d === doc ? next : syncTokens(d, st.library)));
    }
  });
}

/** What new texts and shapes start with: the first font and color tokens of the brand in use. */
function brandStarts(st = useStore.getState()): { text: Partial<TextStyle>; fill: Bag } | null {
  if (!activeKit(st)) return null;
  const font = tokenChoices('fontFamily', undefined, undefined, st)[0]?.ref, color = tokenChoices('color', undefined, undefined, st)[0]?.ref;
  if (!font && !color) return null;
  return {
    text: { ...(font ? tokenPatch('fontFamily', String(font.value), font) : {}), ...(color ? tokenPatch('color', String(color.value), color) : {}) },
    fill: color ? tokenPatch('fill', String(color.value), color) : {},
  };
}

/**
 * The brand in use reaches the tools, as Canva's brand kit does: a brand kit or design system the user creates is the one in use
 * when none is; when the brand in use or its first font or color changes, new texts and shapes start with them; and the tools'
 * linked colors and fonts follow their tokens. A color or font the user picks by hand stays until the brand changes.
 */
export function installBrandStarts(): () => void {
  const keyOf = (st = useStore.getState()) => { const k = activeKit(st), c = tokenChoices('color', undefined, undefined, st)[0]?.ref, f = tokenChoices('fontFamily', undefined, undefined, st)[0]?.ref; return k ? `${k.id}|${f?.kit}.${f?.token}|${c?.kit}.${c?.token}` : ''; };
  let last = keyOf();
  return useStore.subscribe((st, prev) => {
    if (st.library === prev.library && st.composer.kitId === prev.composer.kitId) return;
    const added = st.library.find((s) => isKit(s) && s.kind !== 'moodboard' && s.origin?.by === 'user' && !s.draft && !prev.library.some((p) => p.id === s.id));
    if (added && !activeKit(st)) { setComposer({ kitId: added.id }); return; }
    const key = keyOf(st), starts = key !== last ? brandStarts(st) : null;
    last = key;
    const session = st.sessions[st.activeSessionId], mode = session?.docs.find((d) => d.id === session.activeDocId)?.tokenMode;
    const text = fresh({ ...st.ui.text, ...starts?.text }, ['color', 'fontFamily', 'fontSize'], st.library, mode);
    const shape = fresh({ ...st.ui.shape, ...starts?.fill }, ['fill', 'stroke'], st.library, mode);
    const lineart = fresh(st.ui.lineart, ['color'], st.library, mode);
    if (starts || text.color !== st.ui.text.color || text.fontFamily !== st.ui.text.fontFamily || text.fontSize !== st.ui.text.fontSize || shape.fill !== st.ui.shape.fill || shape.stroke !== st.ui.shape.stroke || lineart !== st.ui.lineart) setUi({ text, shape, lineart });
  });
}

/** "Use" on a brand: the texts of the open document that follow no token take its first font and color, in one undo step. */
export function brandToDoc(doc: DesignDoc, patch: (layerId: string, p: Partial<TextStyle>) => void): number {
  const starts = brandStarts();
  if (!starts) return 0;
  const texts = doc.layers.filter((l) => l.type === 'text' && !l.locked && !tokenOf(l, 'color') && !tokenOf(l, 'fontFamily'));
  for (const l of texts) patch(l.id, starts.text);
  return texts.length;
}
