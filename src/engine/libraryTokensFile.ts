import { parseTokenAlias, tokenModes, tokensIn, validateTokens } from './libraryTokens';
import { colorHex, colorObject, colorText } from './libraryTokensColor';
import type { KitToken, KitTokens, KitTokenType } from './libraryTypes';

/* Design tokens as a file: the W3C Design Tokens format (2025.10, the one Figma reads) and the token sets of Penpot and Tokens Studio. */
const TYPES: Record<string, KitTokenType> = {
  color: 'color', dimension: 'dimension', borderRadius: 'dimension', spacing: 'dimension', sizing: 'dimension', borderWidth: 'dimension', strokeWidth: 'dimension', fontSize: 'dimension', fontSizes: 'dimension', letterSpacing: 'dimension', paragraphSpacing: 'dimension',
  number: 'number', opacity: 'number', rotation: 'number', fontWeight: 'number', fontWeights: 'number', lineHeight: 'number', lineHeights: 'number',
  fontFamily: 'fontFamily', fontFamilies: 'fontFamily', string: 'string', text: 'string',
};
/** Tokens made of several values: each one becomes a token of its own ("title.fontSize"). */
const COMPOSITES = ['typography', 'border', 'shadow', 'boxShadow'];
const PARTS: Record<string, string> = { fontFamily: 'fontFamily', fontSize: 'dimension', fontWeight: 'fontWeight', letterSpacing: 'dimension', lineHeight: 'lineHeight', color: 'color', width: 'dimension', offsetX: 'dimension', offsetY: 'dimension', x: 'dimension', y: 'dimension', blur: 'dimension', spread: 'dimension' };
const WEIGHTS: Record<string, number> = { thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300, normal: 400, regular: 400, book: 400, medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900, extrablack: 950, ultrablack: 950 };
type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const clean = (part: string) => part.trim().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'token';
const nameOf = (path: readonly string[]) => path.filter((p) => p !== '$root').map(clean).join('.');
const isToken = (node: Json) => '$value' in node || ('value' in node && typeof node.type === 'string');
/** The path a "{group.token}" or a "#/group/token" points to. */
function refPath(v: unknown): string[] | null {
  const alias = parseTokenAlias(v), pointer = typeof v === 'string' && v.startsWith('#/') ? v : isObj(v) && typeof v.$ref === 'string' && v.$ref.startsWith('#/') ? v.$ref : null;
  if (alias !== null) return alias.split('.');
  return pointer === null ? null : pointer.slice(2).split('/').map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~')).filter((p) => p !== '$value');
}

/** A value of a file as this app keeps it; undefined when it has no place here. An alias takes its type from its target. */
function read(type: string, raw: unknown): KitToken | undefined {
  const ref = refPath(raw), kind = Object.hasOwn(TYPES, type) ? TYPES[type] : undefined;
  if (ref) return { type: kind as KitTokenType, value: `{${nameOf(ref)}}` };
  if (!kind) return undefined;
  if (kind === 'fontFamily' && Array.isArray(raw)) raw = raw.join(', ');
  if (isObj(raw)) raw = kind === 'color' ? colorText(raw) : kind === 'dimension' && typeof raw.value === 'number' ? `${raw.value}${String(raw.unit ?? 'px')}` : undefined;
  if ((typeof raw !== 'string' && typeof raw !== 'number') || (typeof raw === 'string' && kind !== 'string' && /[{}]/.test(raw))) return undefined;
  if (kind === 'number' && typeof raw === 'string') {
    const t = raw.trim(), weight = /weight/i.test(type) ? WEIGHTS[t.toLowerCase().replace(/[\s_-]/g, '')] : undefined;
    if (weight) return { type: kind, value: weight };
    if (t && Number.isFinite(Number(t))) return { type: kind, value: Number(t) };
    if (type === 'opacity' && /^[\d.]+%$/.test(t)) return { type: kind, value: parseFloat(t) / 100 };
    return type.startsWith('lineHeight') ? { type: 'dimension', value: t } : undefined;
  }
  return { type: kind, value: kind === 'color' || kind === 'fontFamily' || kind === 'string' ? String(raw) : raw };
}

/** The token sets that apply (the active ones, or those of the first theme of each group, or all), those of the other themes, and the ones nothing uses. */
function pickSets(root: Json): { sets: string[] | null; modes: Array<{ name: string; sets: string[] }>; off: string[] } {
  const meta = isObj(root.$metadata) ? root.$metadata : null, themes = Array.isArray(root.$themes) ? root.$themes.filter(isObj) : [];
  if (!meta && !themes.length) return { sets: null, modes: [], off: [] };
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  const all = [...new Set([...list(meta?.tokenSetOrder), ...Object.keys(root)])].filter((k) => !k.startsWith('$') && isObj(root[k]));
  const setsOf = (t: Json) => (isObj(t.selectedTokenSets) ? Object.entries(t.selectedTokenSets).filter(([k, v]) => v !== 'disabled' && all.includes(k)).map(([k]) => k) : []);
  const groups = new Map<string, Json[]>();
  for (const t of themes) { const g = String(t.group ?? ''); groups.set(g, [...(groups.get(g) ?? []), t]); }
  const names = list(meta?.activeThemes), sets = list(meta?.activeSets).filter((k) => all.includes(k));
  const isOn = (t: Json) => names.includes(t.group ? `${String(t.group)}/${String(t.name)}` : String(t.name)) || names.includes(String(t.id));
  const fits = (t: Json) => sets.length > 0 && setsOf(t).length > 0 && setsOf(t).every((k) => sets.includes(k));
  const active = [...groups.values()].flatMap((g): Json[] => { const one = g.find(isOn) ?? (names.length ? undefined : g.find(fits) ?? g[0]); return one ? [one] : []; });
  const order = (on: Iterable<string>) => { const s = new Set(on); return all.filter((k) => s.has(k)); };
  const base = order(sets.length ? sets : active.flatMap(setsOf)), used = base.length ? base : all;
  const modes = active.flatMap((t) => (groups.get(String(t.group ?? '')) ?? []).filter((x) => x !== t).map((x) => {
    const mine = new Set(setsOf(t)), kept = new Set(active.filter((y) => y !== t).flatMap(setsOf));
    return { name: String(x.name ?? 'Mode'), sets: order([...used.filter((k) => !mine.has(k) || kept.has(k)), ...setsOf(x)]) };
  }));
  const on = new Set([...used, ...modes.flatMap((m) => m.sets)]);
  return { sets: used, modes, off: all.filter((k) => !on.has(k)) };
}

/** The values of `other` that differ, as a mode of the tokens; its own tokens join them. */
export function withMode(tokens: KitTokens, name: string, other: KitTokens): KitTokens {
  const out: KitTokens = { ...tokens };
  for (const [n, t] of Object.entries(other)) {
    const own = out[n];
    if (!own) out[n] = t;
    else if (own.type === t.type && own.value !== t.value) out[n] = { ...own, modes: { ...own.modes, [name]: t.value } };
  }
  return out;
}

/** The tokens of a file, the names of the ones this app has no type or value for, and the token sets not in use in it. */
export function tokensFromFile(text: string): { tokens: KitTokens; skipped: string[]; off: string[] } {
  let root: unknown;
  try { root = JSON.parse(text); } catch { throw new Error('The file is not valid JSON.'); }
  if (!isObj(root)) throw new Error('The file has no design tokens.');
  const { sets, modes, off } = pickSets(root), file = root, pick = (names: string[]) => names.map((k) => file[k] as Json);
  const base = readSets(sets ? pick(sets) : [root]), skipped = new Set(base.skipped);
  let { tokens } = base;
  for (const m of modes) { const more = readSets(pick(m.sets)); more.skipped.forEach((n) => skipped.add(n)); tokens = withMode(tokens, m.name, more.tokens); }
  if (!Object.keys(tokens).length) throw new Error('The file has no design tokens this app can read.');
  return { tokens, skipped: [...skipped], off };
}

function readSets(sets: readonly Json[]): { tokens: KitTokens; skipped: string[] } {
  const tokens: KitTokens = {}, skipped: string[] = [];
  for (const set of sets) {
    const here = new Set<string>();
    const put = (path: string[], type: string, raw: unknown, description?: string) => {
      const name = nameOf(path), token = read(type, raw);
      if (!token || !name || here.has(name)) { skipped.push(path.join('.')); return; }
      here.add(name);
      tokens[name] = { ...token, ...(description ? { description } : {}) };
    };
    const at = (path: string[]) => path.reduce<unknown>((n, p) => (isObj(n) && Object.hasOwn(n, p) ? n[p] : undefined), set);
    const merge = (base: Json, over: Json): Json => {
      const out: Json = { ...base };
      for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(out[k]) && !isToken(v) ? merge(out[k] as Json, v) : v;
      return out;
    };
    const walk = (node: Json, path: string[], inherited: unknown, extended: string[]) => {
      const type = node.$type ?? inherited;
      if (isToken(node)) {
        const raw = '$value' in node ? node.$value : node.value, kind = String(node.$type ?? node.type ?? type), d = node.$description ?? node.description, description = typeof d === 'string' ? d : undefined;
        if (!COMPOSITES.includes(kind) || refPath(raw)) { put(path, kind, raw, description); return; }
        (Array.isArray(raw) ? raw : [raw]).forEach((part, i, every) => {
          const inside = every.length > 1 ? [...path, String(i + 1)] : path;
          if (!isObj(part)) skipped.push(inside.join('.'));
          else for (const [k, v] of Object.entries(part)) put([...inside, k], Object.hasOwn(PARTS, k) ? PARTS[k] : '', v);
        });
        return;
      }
      const from = refPath(node.$extends ?? node.$ref), key = from?.join('.'), base = from && key && !extended.includes(key) ? at(from) : undefined;
      if (isObj(base) && !isToken(base) && key) { const { $extends: _e, $ref: _r, ...own } = node; walk(merge(base, own), path, inherited, [...extended, key]); return; }
      for (const [k, v] of Object.entries(node)) if ((!k.startsWith('$') || k === '$root') && k !== '__proto__' && isObj(v)) walk(v, [...path, k], type, extended);
    };
    walk(set, [], undefined, []);
  }
  for (const t of Object.values(tokens)) {
    const last = parseTokenAlias(t.value) === null ? undefined : end(tokens, t);
    if (last) t.type = last.type;
  }
  // One token the app cannot read (a formula, an alias to a skipped one) does not stop the rest.
  const bad = Object.keys(tokens).filter((name) => { try { validateTokens(chain(tokens, name)); return false; } catch { return true; } });
  for (const name of bad) { delete tokens[name]; skipped.push(name); }
  return { tokens, skipped };
}

/** A token and the ones its alias goes through. */
function chain(tokens: KitTokens, name: string): KitTokens {
  const out: KitTokens = {};
  for (let cur: string | null = name; cur !== null && tokens[cur] && !out[cur]; cur = parseTokenAlias(tokens[cur].value)) out[cur] = tokens[cur];
  return out;
}
/** The token an alias ends in; undefined when it goes nowhere. */
function end(tokens: KitTokens, from: KitToken): KitToken | undefined {
  let t: KitToken | undefined = from;
  for (let i = 0; t && i < 20; i++) { const next = parseTokenAlias(t.value); if (next === null) return t; t = tokens[next]; }
  return undefined;
}

export type TokenFormat = 'w3c' | 'penpot';
const families = (v: string) => v.split(',').map((f) => f.trim().replace(/^(['"])(.*)\1$/, '$2')).filter(Boolean);
function size(v: string | number): { value: number; unit: string } | undefined {
  const m = /^(-?\d+(?:\.\d+)?)(px|rem)?$/.exec(String(v).trim());
  return m ? { value: Number(m[1]), unit: m[2] ?? 'px' } : undefined;
}
function write({ type, value }: KitToken, format: TokenFormat): { $type: string; $value: unknown } | undefined {
  const w3c = format === 'w3c', some = ($type: string, $value: unknown) => ($value === undefined ? undefined : { $type, $value });
  if (type === 'color') return some('color', w3c ? colorObject(String(value)) : colorHex(String(value)));
  if (type === 'dimension') { const s = size(value); return some('dimension', s && (w3c ? s : `${s.value}${s.unit}`)); }
  if (type === 'fontFamily') { const f = families(String(value)); return some(w3c ? 'fontFamily' : 'fontFamilies', f.length > 1 ? (w3c ? f : f.join(', ')) : f[0]); }
  if (type === 'number') return some('number', w3c ? Number(value) : String(value));
  return w3c ? some('string', String(value)) : undefined;
}

/** The tokens as a file (Penpot: with their modes as themes), and the names of the ones that format has no way to write (with the ones that point to them). */
export function tokensToFile(tokens: KitTokens, format: TokenFormat = 'w3c', set = 'Tokens'): { text: string; left: string[] } {
  const clean = (n: string) => n.trim().replace(/[/$.]+/g, '-'), title = clean(set) || 'Tokens', modes = format === 'penpot' ? tokenModes(tokens) : [];
  const base = treeOf(tokensIn(tokens), format);
  let file: Json = base.tree;
  if (format === 'penpot') {
    const sets = modes.length ? ['Default', ...modes].map((m) => `${title}/${clean(m)}`) : [title];
    file = Object.fromEntries(sets.map((s, i) => [s, i ? treeOf(tokensIn(tokens, modes[i - 1]), format, (n) => tokens[n].modes?.[modes[i - 1]] !== undefined).tree : base.tree]));
    file.$themes = modes.length ? sets.map((s, i) => ({ id: s, name: i ? modes[i - 1] : 'Default', group: title, description: '', isSource: false, selectedTokenSets: { [sets[0]]: 'enabled', [s]: 'enabled' } })) : [];
    file.$metadata = { tokenSetOrder: sets, activeThemes: modes.length ? [`${title}/Default`] : [], activeSets: [sets[0]] };
  }
  return { text: `${JSON.stringify(file, null, 2)}\n`, left: base.left };
}

function treeOf(tokens: KitTokens, format: TokenFormat, only: (name: string) => boolean = () => true): { tree: Json; left: string[] } {
  const entries = Object.entries(tokens).map(([name, t]) => { const last = end(tokens, t); return { name, t, out: last && write(last, format) }; });
  const kept = entries.filter((e) => e.out), names = new Set(kept.map((e) => e.name)), groups = new Set<string>();
  for (const n of names) for (let i = n.indexOf('.'); i > 0; i = n.indexOf('.', i + 1)) groups.add(n.slice(0, i));
  // A token that is also a group of tokens: the standard calls it $root; Penpot has no such thing.
  const outName = (n: string) => {
    if (!groups.has(n)) return n;
    let own = format === 'w3c' ? `${n}.$root` : `${n}.root`;
    while (names.has(own) || groups.has(own)) own += '-';
    return own;
  };
  const tree: Json = Object.create(null) as Json;
  for (const { name, t, out } of kept.filter((e) => only(e.name))) {
    const path = outName(name).split('.'), alias = parseTokenAlias(t.value);
    let at = tree;
    for (const part of path.slice(0, -1)) at = (at[part] ??= Object.create(null) as Json) as Json;
    at[path[path.length - 1]] = { $type: out!.$type, $value: alias === null ? out!.$value : `{${outName(alias)}}`, ...(t.description ? { $description: t.description } : {}) };
  }
  return { tree, left: entries.filter((e) => !e.out).map((e) => e.name) };
}
