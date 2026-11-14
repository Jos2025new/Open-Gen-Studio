import { collect } from './collect';

/*
 * The door to the commands: importing this file loads every `commands.ts` of the app and registers what they export.
 * A `commands.ts` imports `./types` (or `defineCommand`) and never this file, so there is no cycle.
 */

/** What was found at load. `skipped` are files named like the convention that export no `commands`. */
export const collected = collect(import.meta.glob(['/src/**/commands.ts', '/src/**/*.commands.ts'], { eager: true }));

export { defineCommand, CommandError } from './types';
export type { Availability, Call, Caller, CommandContext, CommandSpec, Effect, ErrorCode, RunResult, Sequence, Target } from './types';
export { allCommands, argsSchema, availability, command, findCommands } from './registry';
export type { FindQuery, FoundCommand } from './registry';
export { invoke, run, setApprover, needsApproval, MAX_STEPS } from './run';
export type { ApprovalRequest, ApprovalStep, Approver, RunOptions } from './run';
export { lastCommands, subscribeEcho } from './echo';
export type { EchoEntry } from './echo';
export { registerHistory } from './history';
export type { HistoryAdapter, HistoryTx } from './history';
