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
        'Lists what the app can do as commands in every area. With neither area nor text: the areas and what each is for. With one: a line per command, id {arguments} — what it does [and why it cannot run now]. All commands and arguments are already in the system prompt; call this only to check why one cannot run now. Free, changes nothing.',
      parameters: {
        type: 'object',
        properties: {
          area: { type: 'string', enum: ['designer', 'nodes', 'studio', 'library', 'skills', 'models', 'sessions'], description: 'Only the commands of this area.' },
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
        'Runs commands of any area in order, as the user\'s own actions. Document edits are grouped for undo. Library saves stay in Library. Commands that spend or delete ask for the user\'s approval once for the whole sequence with its total cost. All command ids and arguments are in the system prompt: call run_commands directly without find_commands. A step can use an earlier result: "$1" is the whole result of step 1 (e.g. data: "$1") and "$1.layer" or "$2.node" a field of it. Designer steps act on the document on screen unless "on" names another one: use "on": "$1.doc" (or {"doc": "$1.doc"}) when step 1 creates the document.',
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
                on: {
                  anyOf: [
                    { type: 'object', properties: { doc: { type: 'string' } }, required: ['doc'] },
                    { type: 'string' },
                  ],
                  description: 'Target document, e.g. {"doc": "$1.doc"} or "$1.doc" for a doc created in step 1.',
                },
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

const onDoc = z.preprocess((v) => (typeof v === 'string' ? { doc: v } : v), z.object({ doc: z.string().min(1).max(80) }).strict());
const step = z.object({ cmd: z.string().min(1).max(80), args: z.record(z.string(), z.unknown()).optional(), on: onDoc.optional() }).strict();
/** The agent names a document, never a session: the session is always the one it is talking in. */
export const runCommandsSchema = z.object({ seq: z.array(step).min(1).max(40) }).strict();
