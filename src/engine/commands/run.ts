import { z } from 'zod';
import type { BudgetPass } from '../budget';
import { FREE, UNKNOWN, sumEstimates } from '../pricing';
import type { Estimate } from '../types';
import { echo } from './echo';
import { Transactions, takeStateSnapshot } from './history';
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

/** Microtask turns a step gets to finish before it counts as having waited. A step with no real wait needs a handful. */
const HOPS = 64;

/**
 * Awaits a step. Microtasks all run before the browser handles the next event, so a step that settles within them
 * finished in the task it started in and nobody else ran. One that does not has waited (a decode, a download): the
 * open histories are told, and a later failure will not put them back over what the user did meanwhile.
 */
async function settle<T>(pending: PromiseLike<T>, txs: Transactions): Promise<T> {
  let done = false;
  const watched = Promise.resolve(pending).then(
    (value) => {
      done = true;
      return value;
    },
    (error: unknown) => {
      done = true;
      throw error;
    },
  );
  for (let hop = 0; hop < HOPS && !done; hop++) await null;
  if (!done) txs.waited();
  return watched;
}

function openHistories(spec: AnyCommand, on: Target, args: unknown, txs: Transactions): void {
  const keys = spec.history?.(on, args);
  if (!keys) return;
  for (const key of typeof keys === 'string' ? [keys] : keys) txs.touch(key);
}

function check(spec: AnyCommand, ctx: CommandContext, args: unknown): void {
  const missing = missingTarget(spec, ctx.on);
  if (missing) throw new CommandError('target', missing);
  const can = spec.available ? spec.available(ctx, args as never) : true;
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
    check(spec, ctx, args);
    openHistories(spec, on, args, txs);
    result = spec.run(ctx, args);
  } catch (error) {
    finish(error ?? new Error('failed'));
    throw error;
  }
  if (thenable(result)) {
    return settle(result, txs).then(
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
  estimate: Estimate;
}
export interface ApprovalRequest {
  caller: Caller;
  steps: ApprovalStep[];
  estimate: Estimate;
}
export type ApprovalOutcome = boolean | { approved: boolean; budgetPass?: BudgetPass };
/** Shows the user what is about to happen and answers yes or no. One question per sequence, never one per step. */
export type Approver = (request: ApprovalRequest) => ApprovalOutcome | Promise<ApprovalOutcome>;

let approver: Approver | null = null;

/** Sets who asks the user. With none set, whatever needs approval is refused. */
export function setApprover(fn: Approver | null): void {
  approver = fn;
}

export function getApprover(): Approver | null {
  return approver;
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

function canResolveRefs(value: unknown, ran: boolean[]): boolean {
  if (typeof value === 'string') {
    if (value.startsWith('$$')) return true;
    const m = REF.exec(value);
    return !m || Boolean(ran[Number(m[1]) - 1]);
  }
  if (Array.isArray(value)) return value.every((item) => canResolveRefs(item, ran));
  if (value !== null && typeof value === 'object') return Object.values(value).every((item) => canResolveRefs(item, ran));
  return true;
}

function partialRefs(value: unknown, at: number, results: unknown[], ran: boolean[]): unknown {
  if (typeof value === 'string') {
    if (value.startsWith('$$')) return value;
    const m = REF.exec(value);
    if (!m || !ran[Number(m[1]) - 1]) return value;
    return refs(value, at, results);
  }
  if (Array.isArray(value)) return value.map((item) => partialRefs(item, at, results, ran));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, partialRefs(v, at, results, ran)]));
  }
  return value;
}

// --- The boundary ---------------------------------------------------------------------------------------------------

const MAX_STEPS = 40;

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
  approver?: Approver;
}

let sequences = 0;

/**
 * Runs `{ cmd, args, on }` or `{ seq: [...], on }` for a caller at the boundary. Everything that can be checked is
 * checked before the first step runs. A sequence is all or nothing in the undo histories it touches: if a step fails,
 * they go back to where they were (money already spent is not undone, and the result says which steps ran). The one
 * exception is a sequence that waited on a step: its histories are kept, as one undo step each (`kept`).
 */
export async function run(input: unknown, options: RunOptions): Promise<RunResult> {
  const results: unknown[] = [];
  const txs = new Transactions();
  const steps: { spec: AnyCommand; rawArgs: unknown; rawOn: Target; args: unknown; on: Target; ready: boolean; onReady: boolean; ran: boolean }[] = [];
  const fail = (error: unknown, step?: number): RunResult => {
    const known = error instanceof CommandError;
    const code: ErrorCode = known ? error.code : 'failed';
    const touched = txs.size;
    let kept: string[] = [];
    try {
      kept = txs.end(false);
    } catch {
      /* the first error is the one to report */
    }
    const at = (known && error.step) || step;
    const ranResults = steps.length ? results.filter((_, i) => steps[i]?.ran) : results;
    return { ok: false, error: { code, message: message(error), ...(at ? { step: at } : {}) }, results: ranResults, rolledBack: touched > kept.length, ...(kept.length ? { kept } : {}) };
  };

  const shaped = (input !== null && typeof input === 'object' && 'seq' in input ? sequenceShape : callShape).safeParse(input);
  if (!shaped.success) return fail(new CommandError('invalid', `Expected { cmd, args?, on? } or { seq: [...], on? }: ${shaped.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`));
  const calls = 'seq' in shaped.data ? shaped.data.seq : [shaped.data];
  const base: Target = 'seq' in shaped.data ? (shaped.data.on ?? {}) : {};

  // Before anything runs: every command exists, references point back, and what holds no reference is already valid.
  try {
    calls.forEach((call, i) => {
      const spec = command(call.cmd);
      if (!spec) throw new CommandError('unknown', `No command "${call.cmd}".`, i + 1);
      const rawOn: Target = { ...base, ...call.on };
      refs(call.args, i + 1);
      refs(rawOn, i + 1);
      const ready = !hasRefs(call.args);
      const args = ready ? parseArgs(spec, call.args, i + 1) : call.args;
      const onReady = !hasRefs(rawOn);
      if (onReady) {
        const missing = missingTarget(spec, rawOn);
        if (missing) throw new CommandError('target', missing, i + 1);
      }
      steps.push({ spec, rawArgs: call.args, rawOn, args, on: rawOn, ready, onReady, ran: false });
    });
  } catch (error) {
    return fail(error);
  }

  const activeApprover = options.approver ?? approver;
  const lastAskIndex = steps.reduce((last, { spec }, i) => (needsApproval(spec.effect, options.caller) ? i : last), -1);
  if (lastAskIndex >= 0 && !activeApprover) {
    const firstAsk = steps.findIndex(({ spec }) => needsApproval(spec.effect, options.caller));
    return fail(new CommandError('denied', "This needs the user's approval and nothing here can ask for it.", firstAsk + 1));
  }

  const seq = steps.length > 1 ? ++sequences : undefined;
  let budgetPass: BudgetPass | undefined;
  const runStep = (i: number, bufferedEchoes?: (() => void)[]): Promise<void> | void => {
    const step = steps[i];
    const { spec } = step;
    const at = Date.now();
    const t0 = performance.now();
    let args = step.args;
    let on = step.on;
    const said = (error?: unknown) => {
      const entry = () =>
        echo({ cmd: spec.id, args, on, caller: options.caller, ok: error === undefined, ms: performance.now() - t0, at, ...(error === undefined ? {} : { error: message(error) }), ...(seq ? { seq } : {}) });
      if (bufferedEchoes && error === undefined) bufferedEchoes.push(entry);
      else entry();
    };
    try {
      if (options.signal?.aborted) throw new CommandError('failed', 'Stopped.');
      if (!step.onReady) {
        const target = targetShape.safeParse(refs(step.rawOn, i + 1, results));
        if (!target.success) throw new CommandError('ref', `${spec.id}: a reference in "on" must give an id (text).`);
        on = target.data;
        step.on = on;
        step.onReady = true;
      }
      if (!step.ready) {
        args = parseArgs(spec, refs(step.rawArgs, i + 1, results), i + 1);
        step.args = args;
        step.ready = true;
      }
      const ctx: CommandContext = { on, caller: options.caller, signal: options.signal, ...(budgetPass ? { budgetPass } : {}) };
      check(spec, ctx, args);
      openHistories(spec, on, args, txs);
      // A synchronous step is not awaited: between two of them nothing else can run, the user's edits included.
      const out: unknown = spec.run(ctx, args);
      if (thenable(out)) {
        return settle(out, txs).then(
          (val) => {
            results[i] = val ?? null;
            step.ran = true;
            said();
          },
          (error: unknown) => {
            said(error ?? new Error('failed'));
            throw { error, step: i + 1 };
          },
        );
      }
      results[i] = out ?? null;
      step.ran = true;
      said();
    } catch (error) {
      said(error ?? new Error('failed'));
      throw { error, step: i + 1 };
    }
  };

  if (lastAskIndex >= 0 && activeApprover) {
    const restoreSnapshot = takeStateSnapshot();
    const bufferedEchoes: (() => void)[] = [];
    try {
      for (let i = 0; i < lastAskIndex; i++) {
        const step = steps[i];
        const ran = steps.map((s) => s.ran);
        if (!needsApproval(step.spec.effect, options.caller) && canResolveRefs(step.rawOn, ran) && canResolveRefs(step.rawArgs, ran)) {
          const pending = runStep(i, bufferedEchoes);
          if (pending) await pending;
        }
      }
    } catch (failure) {
      const { error, step } = failure as { error: unknown; step: number };
      const out = fail(error, step);
      restoreSnapshot();
      return out;
    }

    const ran = steps.map((s) => s.ran);
    const asks: ApprovalStep[] = [];
    try {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (!needsApproval(step.spec.effect, options.caller)) continue;
        if (!step.onReady && canResolveRefs(step.rawOn, ran)) {
          const target = targetShape.safeParse(refs(step.rawOn, i + 1, results));
          if (!target.success) throw new CommandError('ref', `${step.spec.id}: a reference in "on" must give an id (text).`, i + 1);
          step.on = target.data;
          step.onReady = true;
          const missing = missingTarget(step.spec, step.on);
          if (missing) throw new CommandError('target', missing, i + 1);
        }
        if (!step.ready && canResolveRefs(step.rawArgs, ran)) {
          step.args = parseArgs(step.spec, refs(step.rawArgs, i + 1, results), i + 1);
          step.ready = true;
        }
        const previewOn = step.onReady ? step.on : (partialRefs(step.rawOn, i + 1, results, ran) as Target);
        const previewArgs = step.ready ? step.args : partialRefs(step.rawArgs, i + 1, results, ran);
        let estimate: Estimate = FREE;
        if (step.spec.effect === 'spend') {
          try {
            estimate = step.spec.estimate ? step.spec.estimate({ on: previewOn, caller: options.caller, signal: options.signal }, previewArgs) : UNKNOWN;
          } catch {
            estimate = UNKNOWN;
          }
        }
        asks.push({ step: i + 1, cmd: step.spec.id, title: step.spec.title, effect: step.spec.effect, args: previewArgs, on: previewOn, estimate });
      }
    } catch (error) {
      for (const s of steps) s.ran = false;
      const out = fail(error);
      restoreSnapshot();
      return out;
    }

    const spendEstimates = asks.filter((a) => a.effect === 'spend').map((a) => a.estimate);
    const estimate = spendEstimates.length ? sumEstimates(spendEstimates) : FREE;
    let yes = false;
    try {
      const outcome = await activeApprover({ caller: options.caller, steps: asks, estimate });
      yes = typeof outcome === 'boolean' ? outcome : outcome.approved;
      if (typeof outcome === 'object' && outcome.approved) budgetPass = outcome.budgetPass;
    } catch (error) {
      for (const s of steps) s.ran = false;
      const out = fail(error, asks[0].step);
      restoreSnapshot();
      return out;
    }
    if (!yes) {
      for (const s of steps) s.ran = false;
      const out = fail(new CommandError('denied', 'The user did not approve it.', asks[0].step));
      restoreSnapshot();
      return out;
    }
    for (const flush of bufferedEchoes) flush();
  }

  for (let i = 0; i < steps.length; i++) {
    if (steps[i].ran) continue;
    try {
      const pending = runStep(i);
      if (pending) await pending;
    } catch (failure) {
      const { error, step } = failure as { error: unknown; step: number };
      return fail(error, step);
    }
  }
  try {
    txs.end(true);
  } catch (error) {
    return fail(error);
  }
  return { ok: true, results };
}
