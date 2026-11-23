import type { z } from 'zod';
import type { BudgetPass } from '../budget';
import type { Estimate } from '../types';

/*
 * The command contract (ADR 0030). A command is one thing the app can do, callable the same way by the interface, the
 * agent, a command line and, later, an outside door. Nothing here imports code: a `commands.ts` pays nothing for it.
 */

/** What a command does to the world. It decides who must approve it (see `run.ts`). */
export type Effect = 'read' | 'write' | 'spend' | 'delete';

/** Who is calling. `ui` is typed code after a user's click; the other three come through the boundary. */
export type Caller = 'ui' | 'agent' | 'cli' | 'external';

/**
 * What a command acts on. The caller resolves it and passes it in `on`: no command reads "the active document" by
 * itself, so the agent can act on a document that is not on screen and a shortcut acts on the active one.
 */
export interface Target {
  session?: string;
  doc?: string;
  node?: string;
}
export type TargetKey = keyof Target;

export const COMMAND_REVIEW_CHANGED = 'The approved request changed. Review and approve it again.';

export interface CommandReview {
  signature: string;
  details: string[];
  /** Per-step price ceilings approved by the user for multi-node commands (`node:<id>` -> USD or null). */
  stepCaps?: Record<string, number | null>;
}

export interface CommandContext {
  on: Target;
  caller: Caller;
  signal?: AbortSignal;
  /** Per-sequence budget pass granted by "Allow this time"; never visible to other actions. */
  budgetPass?: BudgetPass;
  reviewed?: CommandReview;
  approvalTicketId?: string;
}

/** `true`, or the reason it cannot run now ("no layer is selected"): the agent reads it, the interface shows it. */
export type Availability = true | string;

export interface CommandSpec<A = unknown, R = unknown> {
  /** Area and verb in dots: `designer.layer.add`. */
  id: string;
  /** What a palette shows. */
  title: string;
  /** One line for the agent: what it does and what it returns. */
  description?: string;
  /** Other ids that reach this command (an old id after a rename, a short name). */
  aliases?: readonly string[];
  /** The arguments. Checked only for callers at the boundary; the interface is typed and is not checked. */
  args: z.ZodType<A>;
  effect: Effect;
  /** The parts of `on` this command cannot run without. */
  needs?: readonly TargetKey[];
  /** The undo histories this call changes, as `kind:id` ("designer:doc_1"). One call or sequence = one step in each. */
  history?: (on: Target, args: A) => string | readonly string[] | null | undefined;
  /** `true`, or why it cannot run now. Without `args` it answers for the target in general (a palette, a list); with
   * them, for that exact call (a layer that does not exist). It must be cheap: the interface asks often.
   */
  available?: (ctx: CommandContext, args?: Partial<A>) => Availability;
  /** Estimated USD cost for `spend` commands, evaluated after earlier steps and `$n` references resolve. */
  estimate?: (ctx: CommandContext, args: A) => Estimate;
  review?: (ctx: CommandContext, args: A) => CommandReview;
  /** What still keeps this command from the contract (it reads something "active" by itself). The check lists it. */
  debt?: string;
  /** The result must be data that survives JSON: a later step of a sequence, the agent or a CLI reads it. */
  run: (ctx: CommandContext, args: A) => R;
}

/** A command of any argument type, as the registry holds them. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCommand = CommandSpec<any, any>;

/** Types a command from its zod schema: `defineCommand({ id, title, args: z.object({...}), effect, run })`. */
export function defineCommand<A, R>(spec: CommandSpec<A, R>): CommandSpec<A, R> {
  return spec;
}

/** One call in its canonical form. `args` may hold `"$1"` or `"$1.id"` inside a sequence. */
export interface Call {
  cmd: string;
  args?: unknown;
  on?: Target;
}
/** Calls in order. `on` here is the default target of every step. */
export interface Sequence {
  seq: Call[];
  on?: Target;
}

export type ErrorCode =
  | 'unknown' // no command with that id or alias
  | 'invalid' // arguments do not match the schema
  | 'target' // `on` lacks something the command needs
  | 'unavailable' // `available()` gave a reason
  | 'ref' // a `$n` that does not point to an earlier step or to a field that exists
  | 'denied' // approval needed and not given
  | 'history' // a history the command names has no adapter
  | 'failed'; // the command threw

export class CommandError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    /** 1-based step of a sequence. */
    readonly step?: number,
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

export type RunResult =
  | { ok: true; results: unknown[] }
  | {
      ok: false;
      error: { code: ErrorCode; message: string; step?: number };
      /** What the steps before the failure returned. */
      results: unknown[];
      /** Some history was put back as it was. */
      rolledBack: boolean;
      /** Histories whose changes stay, as one undo step: the sequence had waited and the user may have edited meanwhile. */
      kept?: string[];
    };
