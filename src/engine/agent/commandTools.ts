import { z } from 'zod';
import type { ToolSpec } from '../providers/llm';

/*
 * The agent's door to the command registry (ADR 0030): two tools instead of one per command, so the list of tools the
 * model reads does not grow with the app. This file is specs only; `commandCalls.ts` runs them.
 */

export const COMMAND_TOOLS: ToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'find_commands',
      description:
        'Designer only for now: lists what the app can do as commands, one per line: id {arguments} — what it does [and why it cannot run now]. Call it before run_commands when you do not know an id or its arguments. Free, changes nothing.',
      parameters: {
        type: 'object',
        properties: {
          area: { type: 'string', enum: ['designer'], description: 'Only the commands of this area.' },
          text: { type: 'string', description: 'Words to look for, e.g. "layer opacity".' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_commands',
      description:
        'Designer only for now: runs commands in order, as the user\'s own actions. All or nothing, one undo step per document, free. A step can use an earlier result: "$1" is the result of step 1 and "$1.layer" a field of it. Steps act on the document on screen unless "on" names another one (ids from designer.doc.list). Take ids and arguments from find_commands; never guess them.',
      parameters: {
        type: 'object',
        properties: {
          seq: {
            type: 'array',
            minItems: 1,
            maxItems: 40,
            items: {
              type: 'object',
              properties: {
                cmd: { type: 'string', description: 'A command id, e.g. designer.layer.set.' },
                args: { type: 'object' },
                on: { type: 'object', properties: { doc: { type: 'string' } } },
              },
              required: ['cmd'],
            },
          },
        },
        required: ['seq'],
      },
    },
  },
];

export const findCommandsSchema = z.object({ area: z.string().max(40).optional(), text: z.string().max(120).optional() }).strict();

const step = z.object({ cmd: z.string().min(1).max(80), args: z.record(z.string(), z.unknown()).optional(), on: z.object({ doc: z.string().min(1).max(80) }).strict().optional() }).strict();
/** The agent names a document, never a session: the session is always the one it is talking in. */
export const runCommandsSchema = z.object({ seq: z.array(step).min(1).max(40) }).strict();
