import { parseTokenAlias, validateTokens } from './libraryTokens';
import type { KitToken, KitTokens, KitTokenType } from './libraryTypes';

/* Design tokens as a file: the W3C Design Tokens format, also as Penpot and Tokens Studio write it (token sets at the top). */
const TYPES: Record<string, KitTokenType> = {
  color: 'color', dimension: 'dimension', borderRadius: 'dimension', spacing: 'dimension', sizing: 'dimension', borderWidth: 'dimension', strokeWidth: 'dimension', fontSize: 'dimension', fontSizes: 'dimension', letterSpacing: 'dimension',
  number: 'number', opacity: 'number', rotation: 'number', fontWeight: 'number', fontWeights: 'number', lineHeight: 'number',
  fontFamily: 'fontFamily', fontFamilies: 'fontFamily', string: 'string', text: 'string',
};
type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const clean = (part: string) => part.trim().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'token';
const nameOf = (path: readonly string[]) => path.map(clean).join('.');

function literal(type: KitTokenType, raw: unknown): string | number | undefined {
  const v = Array.isArray(raw) && type === 'fontFamily' ? raw.join(', ') : isObj(raw) && 'value' in raw && type === 'dimension' ? `${String(raw.value)}${String(raw.unit ?? 'px')}` : isObj(raw) && typeof raw.hex === 'string' && type === 'color' ? raw.hex : raw;
  if (typeof v !== 'string' && typeof v !== 'number') return undefined;
  const alias = parseTokenAlias(v);
  if (alias !== null) return `{${nameOf(alias.split('.'))}}`;
  if (type === 'number' && typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return type === 'dimension' || type === 'number' ? v : String(v);
}

/** The tokens of a file, and the names of the ones this app has no type or value for. */
export function tokensFromFile(text: string): { tokens: KitTokens; skipped: string[] } {
  let root: unknown;
  try { root = JSON.parse(text); } catch { throw new Error('The file is not valid JSON.'); }
  if (!isObj(root)) throw new Error('The file has no design tokens.');
  const order = isObj(root.$metadata) && Array.isArray(root.$metadata.tokenSetOrder) ? root.$metadata.tokenSetOrder.map(String) : null;
  const sets: Json[] = order ? order.flatMap((k) => (isObj(root[k]) ? [root[k] as Json] : [])) : [root];
  const tokens: KitTokens = {}, skipped: string[] = [];
  const walk = (node: Json, path: string[], inherited?: unknown) => {
    const type = node.$type ?? inherited;
    if ('$value' in node || ('value' in node && 'type' in node)) {
      const kind = TYPES[String(node.$type ?? node.type ?? type)], value = kind && literal(kind, node.$value ?? node.value), name = nameOf(path);
      const description = typeof node.$description === 'string' && node.$description ? node.$description : undefined;
      if (kind && value !== undefined && name) tokens[name] = { type: kind, value, ...(description ? { description } : {}) };
      else skipped.push(path.join('.'));
      return;
    }
    for (const [k, v] of Object.entries(node)) if (!k.startsWith('$') && isObj(v)) walk(v, [...path, k], type);
  };
  for (const set of sets) walk(set, []);
  // One token the app cannot read (a formula, an alias to a skipped one) does not stop the rest.
  for (;;) {
    const bad = Object.keys(tokens).find((name) => { try { validateTokens(chain(tokens, name)); return false; } catch { return true; } });
    if (!bad) break;
    delete tokens[bad]; skipped.push(bad);
  }
  if (!Object.keys(tokens).length) throw new Error('The file has no design tokens this app can read.');
  return { tokens, skipped };
}

/** A token and the ones its alias goes through. */
function chain(tokens: KitTokens, name: string): KitTokens {
  const out: KitTokens = {};
  for (let cur: string | null = name; cur !== null && tokens[cur] && !out[cur]; cur = parseTokenAlias(tokens[cur].value)) out[cur] = tokens[cur];
  return out;
}

export function tokensToFile(tokens: KitTokens): string {
  const root: Json = {};
  for (const [name, t] of Object.entries(tokens) as Array<[string, KitToken]>) {
    const path = name.split('.');
    let at = root;
    for (const part of path.slice(0, -1)) at = (at[part] ??= {}) as Json;
    const last = path[path.length - 1], leaf = { $type: t.type, $value: t.value, ...(t.description ? { $description: t.description } : {}) };
    at[last] = isObj(at[last]) ? { ...(at[last] as Json), ...leaf } : leaf;
  }
  return `${JSON.stringify(root, null, 2)}\n`;
}
