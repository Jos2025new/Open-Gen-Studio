import { useStore } from '../store/store';
import { AGENT_HIDDEN, createsCommandDoc } from './agent/commandCalls';
import { findCommandsSchema } from './agent/commandTools';
import { argsSchema, command, findCommands, run, type Approver, type RunResult } from './commands';
import { activeDoc } from './design/actions';
import { z } from 'zod';

const hidden = (id: string) => Object.hasOwn(AGENT_HIDDEN, id);
const findSchema = findCommandsSchema.extend({ schema: z.string().min(1).max(120).optional() });

function activeContext() {
  const session = useStore.getState().activeSessionId;
  return { session, doc: activeDoc(session)?.id ?? null };
}

export function findExternalCommands(input: unknown) {
  const parsed = findSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: 'invalid', message: 'Expected area, text or schema as strings.' } };
  const { area, text, schema } = parsed.data;
  const context = activeContext();
  const spec = schema ? command(schema) : undefined;
  if (schema && (!spec || hidden(spec.id))) return { ok: false, error: { code: 'unknown', message: 'No visible command matches schema.' } };
  const commands = findCommands({
    area, text, caller: 'external', signatures: true,
    on: { session: context.session, doc: context.doc ?? undefined },
  }).filter((item) => spec ? item.id === spec.id : !hidden(item.id));
  return { ok: true, context, commands: spec ? commands.map((item) => ({ ...item, args: argsSchema(spec) })) : commands };
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const target = (value: unknown) => value === undefined || record(value);

export async function runExternalCommands(input: unknown, approver: Approver, signal?: AbortSignal): Promise<RunResult> {
  const options = { caller: 'external', approver, signal } as const;
  if (!record(input) || !target(input.on)) return run(input, options);
  const sequence = Array.isArray(input.seq);
  const calls = sequence ? input.seq as unknown[] : [input];
  const context = activeContext();
  const supplied = record(input.on) ? input.on : {};
  const session = supplied.session === undefined ? context.session : supplied.session;
  const doc = supplied.doc === undefined && typeof session === 'string' ? activeDoc(session)?.id : supplied.doc;
  const on = { ...supplied, session, ...(doc !== undefined ? { doc } : {}) };
  let docRef: string | undefined;
  let creatorSession: unknown;
  const seq = [];
  for (const [index, call] of calls.entries()) {
    const spec = record(call) && typeof call.cmd === 'string' ? command(call.cmd) : undefined;
    if (spec && hidden(spec.id)) {
      return { ok: false, error: { code: 'denied', message: `${spec.id} is unavailable externally: ${AGENT_HIDDEN[spec.id]}.`, step: index + 1 }, results: [], rolledBack: false };
    }
    if (!sequence || !record(call) || !target(call.on)) {
      seq.push(call);
      continue;
    }
    const override = record(call.on) ? call.on : {};
    const stepSession = override.session === undefined ? session : override.session;
    let stepDoc: unknown;
    if (override.doc === undefined && spec?.needs?.includes('doc')) {
      if (supplied.doc === undefined && docRef && stepSession === creatorSession) stepDoc = docRef;
      else if (supplied.doc === undefined && stepSession !== session && typeof stepSession === 'string') stepDoc = activeDoc(stepSession)?.id ?? '';
    }
    seq.push(stepDoc === undefined ? call : { ...call, on: { ...override, doc: stepDoc } });
    if (spec && createsCommandDoc(spec.id, record(call.args) ? call.args.space : undefined)) {
      docRef = `$${index + 1}.doc`;
      creatorSession = stepSession;
    }
  }
  return run(sequence ? { ...input, seq, on } : { ...input, on }, options);
}
