import { z } from 'zod';
import { echo } from './echo';
import { Transactions } from './history';
import { command, missingTarget } from './registry';
import { CommandError, type AnyCommand, type Caller, type CommandContext, type CommandSpec, type Effect, type ErrorCode, type RunResult, type Target } from './types';

/*
 * The two ways in (ADR 0030).
 *  - `invoke`: typed code, after a user's click. No argument check, no approval; synchronous when the command is.
 *  - `run`: the boundary, for the agent, a command line and outside callers. It checks everything, asks for approval
 *    once, never throws, and runs one call or a sequence where `"$1"` is the result of step 1.
 * Both go through the same commands, the same undo transactions and the same echo.
 */

const thenable = (value: unknown): value is PromiseLike<unknown> => typeof (value as PromiseLike<unknown> | null)?.then === 'function';
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function openHistories(spec: AnyCommand, on: Target, args: unknown, txs: Transactions): void {
  const keys = spec.history?.(on, args);
  if (!keys) return;
  for (const key of typeof keys === 'string' ? [keys] : keys) txs.touch(key);
}

function check(spec: AnyCommand, ctx: CommandContext): void {
  const missing = missingTarget(spec, ctx.on);
  if (missing) throw new CommandError('target', missing);
  const can = spec.available ? spec.available(ctx) : true;
  if (can !== true) throw new CommandError('unavailable', can);
}

/**
 * Runs a command from typed code: a button, a shortcut, the end of a gesture. Returns what the command returns (a
 * promise only if the command is asynchronous) and throws what it throws. The caller resolves the target.
 */
export function invoke<A, R>(spec: CommandSpec<A, R>, args: A, on: Target = {}): R {
  const ctx: CommandContext = { on, caller: 'ui' };
  const at = Date.now();
  const t0 = performance.now();
  const txs = new Transactions();
  const finish = (error?: unknown) => {
    const ok = error === undefined;
    try {
      txs.end(ok);
    } finally {
      echo({ cmd: spec.id, args, on, caller: 'ui', ok, ms: performance.now() - t0, at, ...(ok ? {} : { error: message(error) }) });
    }
  };
  let result: R;
  try {
    check(spec, ctx);
    openHistories(spec, on, args, txs);
    result = spec.run(ctx, args);
  } catch (error) {
    finish(error ?? new Error('failed'));
    throw error;
  }
  if (thenable(result)) {
    return result.then(
      (value) => {
        finish();
        return value;
      },
      (error: unknown) => {
        finish(error ?? new Error('failed'));
        throw error;
      },
    ) as R;
  }
  finish();
  return result;
}

// --- Approval -------------------------------------------------------------------------------------------------------

export interface ApprovalStep {
  /** 1-based. */
  step: number;
  cmd: string;
  title: string;
  effect: Effect;
  args: unknown;
  on: Target;
}
export interface ApprovalRequest {
  caller: Caller;
  steps: ApprovalStep[];
}
/** Shows the user what is about to happen and answers yes or no. One question per sequence, never one per step. */
export type Approver = (request: ApprovalRequest) => boolean | Promise<boolean>;

let approver: Approver | null = null;

/** Sets who asks the user. With none set, whatever needs approval is refused. */
export function setApprover(fn: Approver | null): void {
  approver = fn;
}

/** Spending and deleting always ask when the caller is not the user's own click; from outside, writing asks too. */
export function needsApproval(effect: Effect, caller: Caller): boolean {
  if (caller === 'ui') return false;
  return effect === 'spend' || effect === 'delete' || (caller === 'external' && effect === 'write');
}

// --- References between steps ---------------------------------------------------------------------------------------

/** `"$2"` is the result of step 2; `"$2.layer.id"` a field of it. `"$$2"` is the text "$2". Whole strings only. */
const REF = /^\$(\d+)((?:\.[A-Za-z0-9_]+)*)$/;

/** Walks arguments. `at` is the 1-based step being read; with `results`, references are replaced by their values. */
function refs(value: unknown, at: number, results?: unknown[]): unknown {
  if (typeof value === 'string') {
    if (value.startsWith('$$')) return results ? value.slice(1) : value;
    const m = REF.exec(value);
    if (!m) return value;
    const n = Number(m[1]);
    if (n < 1 || n >= at) throw new CommandError('ref', `"${value}" must point to an earlier step (1 to ${at - 1}). For the text itself, write "$${value}".`, at);
    if (!results) return value;
    let found: unknown = results[n - 1];
    for (const key of m[2].split('.').filter(Boolean)) {
      found = found !== null && typeof found === 'object' ? (found as Record<string, unknown>)[key] : undefined;
      if (found === undefined) throw new CommandError('ref', `"${value}": the result of step ${n} has no "${key}".`, at);
    }
    return found;
  }
  if (Array.isArray(value)) {
    let out: unknown[] | undefined;
    value.forEach((item, i) => {
      const next = refs(item, at, results);
      if (next !== item) (out ??= value.slice())[i] = next;
    });
    return out ?? value;
  }
  if (value !== null && typeof value === 'object') {
    let out: Record<string, unknown> | undefined;
    for (const [key, item] of Object.entries(value)) {
      const next = refs(item, at, results);
      if (next !== item) (out ??= { ...value })[key] = next;
    }
    return out ?? value;
  }
  return value;
}

function hasRefs(value: unknown): boolean {
  if (typeof value === 'string') return value.startsWith('$$') || REF.test(value);
  if (Array.isArray(value)) return value.some(hasRefs);
  return value !== null && typeof value === 'object' && Object.values(value).some(hasRefs);
}

// --- The boundary ---------------------------------------------------------------------------------------------------

export const MAX_STEPS = 40;

const targetShape = z.object({ session: z.string().optional(), doc: z.string().optional(), node: z.string().optional() }).strict();
const callShape = z.object({ cmd: z.string().min(1), args: z.unknown().optional(), on: targetShape.optional() }).strict();
const sequenceShape = z.object({ seq: z.array(callShape).min(1).max(MAX_STEPS), on: targetShape.optional() }).strict();

function parseArgs(spec: AnyCommand, args: unknown, step: number): unknown {
  const parsed = spec.args.safeParse(args ?? {});
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'args'}: ${issue.message}`).join('; ');
  throw new CommandError('invalid', `${spec.id}: ${issues}`, step);
}

export interface RunOptions {
  caller: Exclude<Caller, 'ui'>;
  signal?: AbortSignal;
}

let sequences = 0;

/**
 * Runs `{ cmd, args, on }` or `{ seq: [...], on }` for a caller at the boundary. Everything that can be checked is
 * checked before the first step runs. A sequence is all or nothing in the undo histories it touches: if a step fails,
 * they go back to where they were (money already spent is not undone, and the result says which steps ran).
 */
export async function run(input: unknown, options: RunOptions): Promise<RunResult> {
  const results: unknown[] = [];
  const txs = new Transactions();
  const fail = (error: unknown, step?: number): RunResult => {
    const known = error instanceof CommandError;
    const code: ErrorCode = known ? error.code : 'failed';
    const rolledBack = txs.size > 0;
    try {
      txs.end(false);
    } catch {
      /* the first error is the one to report */
    }
    const at = (known && error.step) || step;
    return { ok: false, error: { code, message: message(error), ...(at ? { step: at } : {}) }, results, rolledBack };
  };

  const shaped = (input !== null && typeof input === 'object' && 'seq' in input ? sequenceShape : callShape).safeParse(input);
  if (!shaped.success) return fail(new CommandError('invalid', `Expected { cmd, args?, on? } or { seq: [...], on? }: ${shaped.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`));
  const calls = 'seq' in shaped.data ? shaped.data.seq : [shaped.data];
  const base: Target = 'seq' in shaped.data ? (shaped.data.on ?? {}) : {};

  // Before anything runs: every command exists, references point back, and what holds no reference is already valid.
  const steps: { spec: AnyCommand; args: unknown; on: Target; ready: boolean }[] = [];
  try {
    calls.forEach((call, i) => {
      const spec = command(call.cmd);
      if (!spec) throw new CommandError('unknown', `No command "${call.cmd}".`, i + 1);
      const on: Target = { ...base, ...call.on };
      refs(call.args, i + 1);
      refs(on, i + 1);
      const ready = !hasRefs(call.args);
      const args = ready ? parseArgs(spec, call.args, i + 1) : call.args;
      if (!hasRefs(on)) {
        const missing = missingTarget(spec, on);
        if (missing) throw new CommandError('target', missing, i + 1);
      }
      steps.push({ spec, args, on, ready });
    });
  } catch (error) {
    return fail(error);
  }

  const asks = steps.flatMap(({ spec, args, on }, i): ApprovalStep[] => (needsApproval(spec.effect, options.caller) ? [{ step: i + 1, cmd: spec.id, title: spec.title, effect: spec.effect, args, on }] : []));
  if (asks.length) {
    let yes = false;
    try {
      yes = approver ? await approver({ caller: options.caller, steps: asks }) : false;
    } catch (error) {
      return fail(error, asks[0].step);
    }
    if (!yes) return fail(new CommandError('denied', approver ? 'The user did not approve it.' : 'This needs the user\'s approval and nothing here can ask for it.', asks[0].step));
  }

  const seq = steps.length > 1 ? ++sequences : undefined;
  for (let i = 0; i < steps.length; i++) {
    const { spec, ready } = steps[i];
    const at = Date.now();
    const t0 = performance.now();
    let args = steps[i].args;
    let on = steps[i].on;
    const said = (error?: unknown) =>
      echo({ cmd: spec.id, args, on, caller: options.caller, ok: error === undefined, ms: performance.now() - t0, at, ...(error === undefined ? {} : { error: message(error) }), ...(seq ? { seq } : {}) });
    try {
      if (options.signal?.aborted) throw new CommandError('failed', 'Stopped.');
      const target = targetShape.safeParse(refs(on, i + 1, results));
      if (!target.success) throw new CommandError('ref', `${spec.id}: a reference in "on" must give an id (text).`);
      on = target.data;
      if (!ready) args = parseArgs(spec, refs(args, i + 1, results), i + 1);
      check(spec, { on, caller: options.caller, signal: options.signal });
      openHistories(spec, on, args, txs);
      const result = await spec.run({ on, caller: options.caller, signal: options.signal }, args);
      results.push(result ?? null);
      said();
    } catch (error) {
      said(error ?? new Error('failed'));
      return fail(error, i + 1);
    }
  }
  try {
    txs.end(true);
  } catch (error) {
    return fail(error);
  }
  return { ok: true, results };
}
