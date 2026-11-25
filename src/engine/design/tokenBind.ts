import { setDoc, useStore } from '../../store/store';
import { activeKitItems } from '../activeKit';
import { parseTokenAlias, resolveToken } from '../libraryTokens';
import { colorHex } from '../libraryTokensColor';
import type { KitTokenType, TokenRef } from '../libraryTypes';
import type { Layer, Subject } from '../types';
import type { DesignDoc } from './docType';

/* Values of a document taken from the tokens of a Library entry: they change when the token or the document's mode does. */
type Field = 'color' | 'fill' | 'stroke' | 'fontFamily' | 'fontSize' | 'background';
type Bag = Record<string, unknown>;
const TYPE: Record<Field, KitTokenType> = { color: 'color', fill: 'color', stroke: 'color', background: 'color', fontFamily: 'fontFamily', fontSize: 'dimension' };
const key = (f: Field) => `${f}Token`;

/** A token's value as the Designer uses it: an opaque hex color, px, or a font name; undefined when it has none. */
export function tokenValue(kit: Subject | undefined, token: string, mode?: string): string | number | undefined {
  const t = kit?.tokens?.[token], raw = t && resolveToken(kit.tokens!, token, mode);
  if (raw === undefined) return undefined;
  if (t!.type === 'color') { const hex = colorHex(String(raw)); return hex?.length === 7 ? hex : undefined; }
  if (t!.type === 'fontFamily') return String(raw).split(',')[0].trim().replace(/^(['"])(.*)\1$/, '$2');
  if (t!.type !== 'dimension') return raw;
  const m = /^(\d+(?:\.\d+)?)(px|rem)?$/.exec(String(raw).trim());
  return m ? Number(m[1]) * (m[2] === 'rem' ? 16 : 1) : undefined;
}

/** A field with a new value, taken from a token or not. */
export function tokenPatch<F extends Field>(field: F, value: string, ref?: TokenRef) {
  return { [field]: value, [key(field)]: ref } as { [K in F]: string } & { [K in `${F}Token`]?: TokenRef };
}
/** A family of an entry, with its token when it has one. */
export function familyPatch(kit: Subject, family: string) {
  const token = Object.keys(kit.tokens ?? {}).find((n) => kit.tokens![n].type === 'fontFamily' && tokenValue(kit, n) === family);
  return tokenPatch('fontFamily', family, token ? { kit: kit.id, token, value: family } : undefined);
}
/** The token a field's value comes from, while it still does. */
export const tokenOf = (obj: object, field: Field): TokenRef | undefined => {
  const ref = (obj as Bag)[key(field)] as TokenRef | undefined;
  return ref && ref.value === (obj as Bag)[field] ? ref : undefined;
};

export interface TokenChoice { ref: TokenRef; label: string; kit: string }
/** The tokens of the entry in use, and of those it contains, that fit a field. */
export function tokenChoices(type: KitTokenType, mode?: string, st = useStore.getState()): TokenChoice[] {
  return activeKitItems(st).flatMap((s) => Object.entries(s.tokens ?? {}).flatMap(([token, t]) => {
    const value = t.type === type ? tokenValue(s, token, mode) : undefined;
    return value === undefined ? [] : [{ ref: { kit: s.id, token, value }, label: token, kit: s.name }];
  }));
}

/** One object with its fields up to date; the same object when nothing changed. A value written as "{token}" becomes that token's. */
function fresh<T extends object>(obj: T, fields: readonly Field[], library: readonly Subject[], mode?: string): T {
  let out: Bag | null = null;
  for (const f of fields) {
    const value = (obj as Bag)[f], alias = parseTokenAlias(value);
    if (alias !== null) {
      const found = tokenChoices(TYPE[f], mode).find((c) => c.ref.token === alias);
      out = { ...(out ?? obj), [f]: found?.ref.value ?? (TYPE[f] === 'color' ? '#000000' : 'Inter'), [key(f)]: found?.ref };
      continue;
    }
    const ref = tokenOf(obj, f);
    const next = ref && tokenValue(library.find((s) => s.id === ref.kit), ref.token, mode);
    if (next !== undefined && next !== value && typeof next === typeof value) out = { ...(out ?? obj), [f]: next, [key(f)]: { ...ref!, value: next } };
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
  const mode = doc.tokenMode, one = <T extends object>(x: T, ...f: Field[]) => fresh(x, f, library, mode);
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
  const ids = new Set(activeKitItems(st).map((s) => s.id));
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
