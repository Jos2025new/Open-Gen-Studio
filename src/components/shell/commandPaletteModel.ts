import { allCommands, argsSchema, availability } from '../../engine/commands';
import type { Target } from '../../engine/commands';
import type { AnyCommand } from '../../engine/commands/types';
import type { Workspace } from '../../engine/types';

/*
 * What the command palette shows, without the DOM: which commands it offers, the sections of an empty query, the
 * search across areas, and how a command's arguments become fields. ADR 0030 holds the contract.
 */

export type FieldKind = 'text' | 'number' | 'integer' | 'boolean' | 'enum' | 'layer';
export interface PaletteField {
  name: string;
  kind: FieldKind;
  required: boolean;
  options?: string[];
  default?: unknown;
}

interface Json { type?: string; properties?: Record<string, Json>; required?: string[]; enum?: unknown[]; anyOf?: Json[]; const?: unknown; default?: unknown }

/** A property as one field, or `undefined` when it needs more than a single simple control (object, array, record, mixed union). */
function fieldOf(name: string, s: Json, required: boolean): PaletteField | undefined {
  let node = s;
  if (node.anyOf) {
    const rest = node.anyOf.filter((part) => part.type !== 'null');
    if (rest.length && rest.every((part) => part.const !== undefined && typeof part.const === 'string')) node = { enum: rest.map((part) => part.const), default: s.default };
    else if (rest.length === 1) node = { ...rest[0], default: s.default ?? rest[0].default };
    else return undefined;
  }
  const base = { name, required: required && node.default === undefined, ...(node.default !== undefined ? { default: node.default } : {}) };
  if (node.enum) return node.enum.length && node.enum.every((v) => typeof v === 'string') ? { ...base, kind: 'enum', options: node.enum as string[] } : undefined;
  if (node.const !== undefined) return typeof node.const === 'string' ? { ...base, kind: 'enum', options: [node.const] } : undefined;
  if (node.type === 'string') return { ...base, kind: name === 'layer' ? 'layer' : 'text' };
  if (node.type === 'number' || node.type === 'integer') return { ...base, kind: node.type };
  if (node.type === 'boolean') return { ...base, kind: 'boolean' };
  return undefined;
}

/** The fields of a command's arguments, in schema order; `null` when anything in them is not a plain value, so the palette does not offer the command. */
export function fieldsOf(spec: AnyCommand): PaletteField[] | null {
  const schema = argsSchema(spec) as Json;
  if (schema.type !== 'object') return null;
  const need = new Set(schema.required ?? []);
  const fields: PaletteField[] = [];
  for (const [name, prop] of Object.entries(schema.properties ?? {})) {
    const field = fieldOf(name, prop, need.has(name));
    if (!field) return null;
    fields.push(field);
  }
  return fields;
}

/** Every command the palette offers (all areas) and the ones it leaves out because their arguments are not plain values. */
export function offered(): { commands: AnyCommand[]; leftOut: string[] } {
  const commands: AnyCommand[] = [];
  const out: AnyCommand[] = [];
  for (const spec of allCommands()) (fieldsOf(spec) ? commands : out).push(spec);
  return { commands, leftOut: out.map((spec) => spec.id).sort() };
}

export const areaOf = (id: string): string => id.slice(0, id.indexOf('.'));
export const areaName = (id: string): string => { const a = areaOf(id); return a.charAt(0).toUpperCase() + a.slice(1); };

/** The area the workspace on screen is about. */
export function workspaceArea(workspace: Workspace): string {
  return workspace === 'designer' ? 'designer' : workspace === 'node' ? 'nodes' : 'studio';
}

/** Shortcuts of commands, by id. Empty until a command has a key listed in `engine/shortcuts.ts`. */
export const COMMAND_SHORTCUTS: Record<string, string> = {};

export interface PaletteRow {
  id: string;
  title: string;
  area: string;
  effect: AnyCommand['effect'];
  /** `true`, or why it cannot run now. */
  available: true | string;
  /** What shows on the right: the reason when it cannot run, else shortcut or area, plus `· spends` / `· deletes`. */
  detail: string;
  /** Arguments that need a form; also true for spend and delete, which never run on the first Enter. */
  needsStep: boolean;
  fields: PaletteField[];
}

export interface PaletteSection { label?: string; rows: PaletteRow[] }

const SUFFIX: Partial<Record<AnyCommand['effect'], string>> = { spend: ' · spends', delete: ' · deletes' };
export const effectNote = (effect: AnyCommand['effect']): string => SUFFIX[effect] ?? '';

/** A label a person can read: the title, or the id's last words when a command has none. Never shown as a raw id. */
export const labelOf = (spec: AnyCommand): string => spec.title?.trim() || spec.id.split('.').slice(1).join(' ').replace(/[._-]+/g, ' ').trim();

function rowOf(spec: AnyCommand, on: Target, mode: 'plain' | 'search'): PaletteRow | null {
  const fields = fieldsOf(spec);
  if (!fields) return null;
  const available = availability(spec, { on, caller: 'ui' });
  const base = mode === 'search' ? (COMMAND_SHORTCUTS[spec.id] ?? areaName(spec.id)) : '';
  const detail = available !== true ? available : `${base}${effectNote(spec.effect)}`.replace(/^ · /, '');
  return { id: spec.id, title: labelOf(spec), area: areaOf(spec.id), effect: spec.effect, available, detail, needsStep: fields.length > 0 || spec.effect === 'spend' || spec.effect === 'delete', fields };
}

export const HERE_MAX = 6;
export const RECENT_MAX = 4;
export const SEARCH_MAX = 12;
const recent: string[] = [];
/** Remembers a command run from the palette (memory only). */
export function rememberRun(id: string): void {
  const at = recent.indexOf(id);
  if (at >= 0) recent.splice(at, 1);
  recent.unshift(id);
  recent.length = Math.min(recent.length, RECENT_MAX);
}
export function recentIds(): readonly string[] { return recent; }
export function clearRecent(): void { recent.length = 0; }

/** Words of the query must all appear in the title, id or an alias. Title matches come first, then id order. */
function matches(spec: AnyCommand, words: string[]): number {
  const title = spec.title.toLowerCase();
  const rest = [spec.id, ...(spec.aliases ?? [])].join(' ').toLowerCase();
  if (!words.every((w) => title.includes(w) || rest.includes(w))) return -1;
  return words.every((w) => title.startsWith(w) || title.includes(` ${w}`)) ? 0 : words.every((w) => title.includes(w)) ? 1 : 2;
}

/** The sections to show: `Here` and `Recent` for an empty query, otherwise one list of matches from every area. */
export function paletteSections(input: { query: string; on: Target; workspace: Workspace }): PaletteSection[] {
  const words = input.query.toLowerCase().split(/\s+/).filter(Boolean);
  const specs = allCommands();
  if (!words.length) {
    const area = `${workspaceArea(input.workspace)}.`;
    const here: PaletteRow[] = [];
    for (const spec of specs.filter((s) => s.id.startsWith(area)).sort((a, b) => a.id.localeCompare(b.id))) {
      if (here.length >= HERE_MAX) break;
      const row = rowOf(spec, input.on, 'plain');
      if (row && row.available === true) here.push(row);
    }
    const back: PaletteRow[] = [];
    for (const id of recent) {
      const spec = specs.find((s) => s.id === id);
      const row = spec && rowOf(spec, input.on, 'search');
      if (row) back.push(row);
    }
    return [{ label: 'Here', rows: here }, { label: 'Recent', rows: back }].filter((s) => s.rows.length);
  }
  const ranked: Array<{ rank: number; spec: AnyCommand }> = [];
  for (const spec of specs) {
    const rank = matches(spec, words);
    if (rank >= 0) ranked.push({ rank, spec });
  }
  ranked.sort((a, b) => a.rank - b.rank || a.spec.id.localeCompare(b.spec.id));
  // Broad words match many commands: the best ranked come first, and the list is capped so it stays useful.
  const rows = ranked.map(({ spec }) => rowOf(spec, input.on, 'search')).filter((row): row is PaletteRow => row !== null).slice(0, SEARCH_MAX);
  return rows.length ? [{ rows }] : [];
}

/** Arguments from what the user typed: empty optional fields are left out. Values are strings, numbers or booleans. */
export function buildArgs(fields: PaletteField[], values: Record<string, string | boolean | undefined>): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const field of fields) {
    const v = values[field.name];
    if (v === undefined || v === '') continue;
    if (field.kind === 'number' || field.kind === 'integer') { const n = Number(v); args[field.name] = Number.isFinite(n) ? n : v; }
    else args[field.name] = v;
  }
  return args;
}

/** Ctrl+K or Cmd+K. Kept here so the Home key guard and the palette agree on it. */
export const isPaletteKey = (e: KeyboardEvent): boolean => (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k';
