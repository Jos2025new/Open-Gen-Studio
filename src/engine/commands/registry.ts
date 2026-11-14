import { z } from 'zod';
import type { AnyCommand, Availability, Caller, CommandContext, Effect, Target, TargetKey } from './types';

/* The one list of commands. Looking one up is a Map read: the interface pays nothing measurable for going through it. */

const byId = new Map<string, AnyCommand>();
/** Alias -> id. */
const aliases = new Map<string, string>();
/** Id -> the file that declared it, for messages. */
const sources = new Map<string, string>();
const schemas = new WeakMap<AnyCommand, unknown>();

const ID = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/;

function taken(name: string): string | undefined {
  const id = byId.has(name) ? name : aliases.get(name);
  return id && `"${name}" is already ${id === name ? 'a command' : `an alias of ${id}`}${sources.get(id) ? ` (${sources.get(id)})` : ''}`;
}

/** Adds a command. Throws on a malformed or repeated id or alias: two meanings for one name is a bug, found at load. */
export function register(spec: AnyCommand, source?: string): void {
  const where = source ? ` (${source})` : '';
  for (const name of [spec.id, ...(spec.aliases ?? [])]) {
    if (!ID.test(name)) throw new Error(`Command id "${name}"${where}: use lower-case words joined by dots, like "designer.layer.add".`);
    const clash = taken(name);
    if (clash) throw new Error(`Command ${spec.id}${where}: ${clash}.`);
  }
  byId.set(spec.id, spec);
  if (source) sources.set(spec.id, source);
  for (const alias of spec.aliases ?? []) aliases.set(alias, spec.id);
}

/** The command with this id or alias. */
export function command(name: string): AnyCommand | undefined {
  return byId.get(name) ?? byId.get(aliases.get(name) ?? '');
}

export function allCommands(): AnyCommand[] {
  return [...byId.values()];
}

export function sourceOf(id: string): string | undefined {
  return sources.get(id);
}

/** Empties the registry (tests). */
export function resetRegistry(): void {
  byId.clear();
  aliases.clear();
  sources.clear();
}

/** Why this command cannot run on this target now, or `true`. A missing part of `on` is a reason too. */
export function availability(spec: AnyCommand, ctx: CommandContext): Availability {
  const missing = missingTarget(spec, ctx.on);
  if (missing) return missing;
  return spec.available ? spec.available(ctx) : true;
}

export function missingTarget(spec: AnyCommand, on: Target): string | undefined {
  const lacks = (spec.needs ?? []).filter((key: TargetKey) => !on[key]);
  return lacks.length ? `${spec.id} needs ${lacks.map((key) => `on.${key}`).join(' and ')}.` : undefined;
}

/** The arguments as JSON Schema, for the agent, a CLI or MCP. Built once per command, on first use. */
export function argsSchema(spec: AnyCommand): unknown {
  let schema = schemas.get(spec);
  if (!schema) {
    schema = z.toJSONSchema(spec.args);
    schemas.set(spec, schema);
  }
  return schema;
}

export interface FoundCommand {
  id: string;
  title: string;
  description?: string;
  aliases?: readonly string[];
  effect: Effect;
  needs?: readonly TargetKey[];
  /** Present when `on` was given: `true` or the reason. */
  available?: Availability;
  /** Present when `schemas` was asked for. */
  args?: unknown;
}

export interface FindQuery {
  /** An area: "designer" finds `designer.*`. */
  area?: string;
  /** Words to look for in id, aliases, title and description; all must appear. */
  text?: string;
  /** With a target, each command says whether it can run on it now. */
  on?: Target;
  caller?: Caller;
  schemas?: boolean;
}

/** What the palette and the agent's `find_commands` read: the commands of an area, with whether each can run now. */
export function findCommands(query: FindQuery = {}): FoundCommand[] {
  const words = (query.text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const area = query.area ? `${query.area}.` : '';
  const found: FoundCommand[] = [];
  for (const spec of byId.values()) {
    if (area && !spec.id.startsWith(area)) continue;
    if (words.length) {
      const hay = [spec.id, ...(spec.aliases ?? []), spec.title, spec.description ?? ''].join(' ').toLowerCase();
      if (!words.every((word) => hay.includes(word))) continue;
    }
    const item: FoundCommand = { id: spec.id, title: spec.title, effect: spec.effect };
    if (spec.description) item.description = spec.description;
    if (spec.aliases?.length) item.aliases = spec.aliases;
    if (spec.needs?.length) item.needs = spec.needs;
    if (query.on) item.available = availability(spec, { on: query.on, caller: query.caller ?? 'ui' });
    if (query.schemas) item.args = argsSchema(spec);
    found.push(item);
  }
  return found.sort((a, b) => a.id.localeCompare(b.id));
}
