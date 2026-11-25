import { TOKEN_TYPES, type KitToken, type KitTokens } from './libraryTypes';

/* Pure flat grouped tokens: alias parsing and validation. */
const NAME_RE = /^[\p{L}\p{N}_-]+(\.[\p{L}\p{N}_-]+)*$/u;
const ALIAS_RE = /^\{([^{}]+)\}$/;
const COLOR_RE = /^(#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\([^)]+\)|[a-z]+)$/i;
const DIM_RE = /^-?\d+(\.\d+)?(px|rem|em|%|pt|vw|vh|ch)?$/;

export function parseTokenAlias(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return ALIAS_RE.exec(value.trim())?.[1] ?? null;
}

function validLiteral({ type, value: v }: KitToken): boolean {
  if (type === 'color') return typeof v === 'string' && COLOR_RE.test(v.trim());
  if (type === 'dimension') return (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && DIM_RE.test(v.trim()));
  if (type === 'fontFamily') return typeof v === 'string' && v.trim().length > 0;
  if (type === 'number') return typeof v === 'number' && Number.isFinite(v);
  return type === 'string' && typeof v === 'string';
}

/** The modes the tokens have besides their own value. */
export const tokenModes = (tokens: KitTokens = {}): string[] => [...new Set(Object.values(tokens).flatMap((t) => Object.keys(t.modes ?? {})))];
/** The tokens with the values of one mode. */
export const tokensIn = (tokens: KitTokens, mode?: string): KitTokens => Object.fromEntries(Object.entries(tokens).map(([name, { modes, ...t }]) => [name, { ...t, value: (mode !== undefined ? modes?.[mode] : undefined) ?? t.value }]));

/** The value a token ends in, following its aliases. */
/** The edits made from `base` to `mine`, over what the entry has now: what changed meanwhile and was not edited stays. */
export function mergeTokens(base: KitTokens, mine: KitTokens, live: KitTokens): KitTokens {
  const out: KitTokens = {}, text = JSON.stringify;
  for (const [name, t] of Object.entries(live)) if (!base[name] || mine[name]) out[name] = t;
  for (const [name, t] of Object.entries(mine)) if (text(base[name]) !== text(t)) out[name] = t;
  return out;
}

export function resolveToken(tokens: KitTokens, name: string, mode?: string): string | number | undefined {
  let cur: string | null = name;
  for (let i = 0; cur !== null && i < 20; i++) {
    const value: string | number | undefined = (mode !== undefined ? tokens[cur]?.modes?.[mode] : undefined) ?? tokens[cur]?.value, next = parseTokenAlias(value);
    if (next === null) return value;
    cur = next;
  }
  return undefined;
}

export function validateTokens(tokens: KitTokens): void {
  for (const mode of tokenModes(tokens)) validateTokens(tokensIn(tokens, mode));
  for (const [name, tok] of Object.entries(tokens)) {
    if (!NAME_RE.test(name)) throw new Error(`Invalid token name "${name}".`);
    if (!(TOKEN_TYPES as readonly string[]).includes(tok.type)) throw new Error(`Invalid token type "${String(tok.type)}" for "${name}".`);
    const target = parseTokenAlias(tok.value);
    if (target !== null) {
      const ref = tokens[target];
      if (!ref) throw new Error(`Token "${name}" references missing alias "{${target}}".`);
      if (ref.type !== tok.type) throw new Error(`Token "${name}" alias "{${target}}" has type "${ref.type}", expected "${tok.type}".`);
    } else if (!validLiteral(tok)) throw new Error(`Invalid value for ${tok.type} token "${name}".`);
  }
  const state = new Map<string, 1 | 2>();
  for (const name of Object.keys(tokens)) {
    let cur: string | null = name;
    const path: string[] = [];
    while (cur !== null) {
      const s = state.get(cur);
      if (s === 2) break;
      if (s === 1) throw new Error(`Cycle detected in token aliases: ${[...path.slice(path.indexOf(cur)), cur].join(' -> ')}.`);
      state.set(cur, 1); path.push(cur); cur = parseTokenAlias(tokens[cur]?.value);
    }
    for (const p of path) state.set(p, 2);
  }
}
