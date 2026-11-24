import { TOKEN_TYPES, type KitToken, type KitTokens } from './libraryTypes';

/* Pure flat grouped tokens: validation, alias resolution, delete (inlining resolved value), and rename. */

const NAME_RE = /^[\p{L}\p{N}_-]+(\.[\p{L}\p{N}_-]+)*$/u;
const ALIAS_RE = /^\{([^{}]+)\}$/;
const HEX_RE = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const CSS_COLOR_FN_RE = /^(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\([^)]+\)$/i;
const NAMED_COLOR_RE = /^[a-z]+$/i;
const DIM_RE = /^-?\d+(\.\d+)?(px|rem|em|%|pt|vw|vh|ch)?$/;

export function parseTokenAlias(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = ALIAS_RE.exec(value.trim());
  return m ? m[1] : null;
}

function validLiteral(token: KitToken): boolean {
  const v = token.value;
  switch (token.type) {
    case 'color': return typeof v === 'string' && (HEX_RE.test(v.trim()) || CSS_COLOR_FN_RE.test(v.trim()) || NAMED_COLOR_RE.test(v.trim()));
    case 'dimension': return (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && DIM_RE.test(v.trim()));
    case 'fontFamily': return typeof v === 'string' && v.trim().length > 0;
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'string': return typeof v === 'string';
    default: return false;
  }
}

export function validateTokens(tokens: KitTokens): void {
  for (const [name, tok] of Object.entries(tokens)) {
    if (!NAME_RE.test(name)) throw new Error(`Invalid token name "${name}".`);
    if (!(TOKEN_TYPES as readonly string[]).includes(tok.type)) throw new Error(`Invalid token type "${String(tok.type)}" for "${name}".`);
    const target = parseTokenAlias(tok.value);
    if (target !== null) {
      const ref = tokens[target];
      if (!ref) throw new Error(`Token "${name}" references missing alias "{${target}}".`);
      if (ref.type !== tok.type) throw new Error(`Token "${name}" alias "{${target}}" has type "${ref.type}", expected "${tok.type}".`);
    } else if (!validLiteral(tok)) {
      throw new Error(`Invalid value for ${tok.type} token "${name}".`);
    }
  }
  const state = new Map<string, 1 | 2>();
  for (const name of Object.keys(tokens)) {
    let cur: string | null = name;
    const path: string[] = [];
    while (cur !== null) {
      const s = state.get(cur);
      if (s === 2) break;
      if (s === 1) throw new Error(`Cycle detected in token aliases: ${[...path.slice(path.indexOf(cur)), cur].join(' -> ')}.`);
      state.set(cur, 1);
      path.push(cur);
      cur = parseTokenAlias(tokens[cur]?.value);
    }
    for (const p of path) state.set(p, 2);
  }
}

export function resolveTokens(tokens: KitTokens): Record<string, string | number> {
  validateTokens(tokens);
  const out: Record<string, string | number> = {};
  const resolveOne = (name: string): string | number => {
    if (name in out) return out[name];
    const tok = tokens[name];
    const target = parseTokenAlias(tok.value);
    const val = target !== null ? resolveOne(target) : tok.value;
    out[name] = val;
    return val;
  };
  for (const name of Object.keys(tokens)) resolveOne(name);
  return out;
}

export function deleteToken(tokens: KitTokens, name: string): KitTokens {
  if (!(name in tokens)) return { ...tokens };
  const resolved = resolveTokens(tokens);
  const inlined = resolved[name];
  const next: KitTokens = {};
  for (const [k, tok] of Object.entries(tokens)) {
    if (k === name) continue;
    next[k] = parseTokenAlias(tok.value) === name ? { ...tok, value: inlined } : { ...tok };
  }
  return next;
}

export function renameToken(tokens: KitTokens, oldName: string, newName: string): KitTokens {
  if (!(oldName in tokens)) throw new Error(`Token "${oldName}" does not exist.`);
  if (!NAME_RE.test(newName)) throw new Error(`Invalid token name "${newName}".`);
  if (oldName === newName) return { ...tokens };
  if (newName in tokens) throw new Error(`Token "${newName}" already exists.`);
  const next: KitTokens = {};
  for (const [k, tok] of Object.entries(tokens)) {
    const key = k === oldName ? newName : k;
    next[key] = parseTokenAlias(tok.value) === oldName ? { ...tok, value: `{${newName}}` } : { ...tok };
  }
  return next;
}
