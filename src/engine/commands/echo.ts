import type { Caller, Target } from './types';

/*
 * The last commands that ran, newest last: what "repeat", macros, examples for the agent and fault traces read.
 * A ring of fixed size; arguments are kept by reference, so a command must take ids, never pixels, as arguments.
 */

export interface EchoEntry {
  cmd: string;
  args: unknown;
  on: Target;
  caller: Caller;
  ok: boolean;
  /** How long it took. */
  ms: number;
  /** When it started (Date.now()). */
  at: number;
  error?: string;
  /** Steps of one sequence share this number. */
  seq?: number;
}

export const ECHO_SIZE = 50;

const ring: EchoEntry[] = [];
const listeners = new Set<() => void>();

export function echo(entry: EchoEntry): void {
  ring.push(entry);
  if (ring.length > ECHO_SIZE) ring.shift();
  for (const fn of listeners) fn();
}

/** The last `count` commands, oldest first. */
export function lastCommands(count = ECHO_SIZE): EchoEntry[] {
  return ring.slice(-count);
}

export function subscribeEcho(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function clearEcho(): void {
  ring.length = 0;
}
