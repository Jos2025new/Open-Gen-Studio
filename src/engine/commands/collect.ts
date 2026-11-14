import { register } from './registry';
import type { AnyCommand } from './types';

/*
 * Each area keeps its commands in a `commands.ts` next to its `actions.ts` (or `<name>.commands.ts` where a file of
 * that name already exists) and exports them as `commands`. Nothing lists those files by hand: `index.ts` finds them.
 */

export interface Collected {
  /** Files that gave commands, with how many. */
  loaded: { file: string; count: number }[];
  /** Files with the name of the convention and no `commands` export: debt for the check to list, not an error. */
  skipped: string[];
}

const isCommand = (value: unknown): value is AnyCommand =>
  value !== null && typeof value === 'object' && typeof (value as AnyCommand).id === 'string' && typeof (value as AnyCommand).run === 'function' && !!(value as AnyCommand).args;

/** Registers the `commands` export of every module given (file path -> module). */
export function collect(modules: Record<string, unknown>): Collected {
  const out: Collected = { loaded: [], skipped: [] };
  for (const file of Object.keys(modules).sort()) {
    const list = (modules[file] as { commands?: unknown } | null)?.commands;
    if (!Array.isArray(list)) {
      out.skipped.push(file);
      continue;
    }
    list.forEach((spec, i) => {
      if (!isCommand(spec)) throw new Error(`${file}: commands[${i}] is not a command (it needs id, args and run).`);
      register(spec, file);
    });
    out.loaded.push({ file, count: list.length });
  }
  return out;
}
