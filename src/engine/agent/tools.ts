import { z } from 'zod';
import type { ToolSpec } from '../providers/llm';
import { MAX_PLAN_STEPS, type RawPlan } from '../plan';
import { AGENT_OP_IDS } from '../ops';

/* Tools the agent can call. Inputs are validated with zod before use. */

const stepKinds = ['image', 'video', 'audio', 'model3d', 'op', 'text', 'layer'] as const;

export const TOOLS: ToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'ask_questions',
      description:
        'Guided mode only. Ask 1-4 short, decisive questions that remove real ambiguity before planning. Each question has 2-5 concrete options. Never ask about details you can settle with a sensible choice.',
      parameters: {
        type: 'object',
        properties: {
          intro: { type: 'string', description: 'One short sentence shown above the questions, in the user\'s language.' },
          questions: {
            type: 'array',
            minItems: 1,
            maxItems: 4,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Short identifier, e.g. "style".' },
                question: { type: 'string' },
                options: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 5 },
                allow_custom: { type: 'boolean', description: 'Let the user type their own answer.' },
                multi: { type: 'boolean', description: 'Allow several options.' },
              },
              required: ['id', 'question', 'options'],
            },
          },
        },
        required: ['questions'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_plan',
      description:
        'Propose an executable plan (a DAG of steps). The app validates it, shows it with its cost and runs it after the user approves. Use it for every request that creates or edits media, flows or layouts.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short title, in the user\'s language.' },
          summary: { type: 'string', description: 'One sentence describing the result, in the user\'s language.' },
          steps: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_PLAN_STEPS,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Unique id: s1, s2, … (l1… for layers).' },
                kind: { type: 'string', enum: [...stepKinds] },
                title: { type: 'string', description: 'Short label shown on the card or node.' },
                prompt: { type: 'string', description: 'image/video: full generation prompt (English works best). model3d: the object (shape, materials, style). audio: the music description, or the lyrics theme for a lyrics model.' },
                prompt_from: { type: 'string', description: 'image/video/audio: id of a text step whose text prefixes the prompt.' },
                lyrics_from: { type: 'string', description: 'audio (music models): id of a step whose text becomes the song lyrics (a lyrics step or a text step).' },
                model: { type: 'string', description: 'Model ref "provider::id". Omit to use the user\'s selected model.' },
                aspect: { type: 'string', description: 'e.g. "16:9", "9:16", "1:1", "4:5".' },
                resolution: { type: 'string', description: 'A value from the model options (e.g. "2K", "1080p").' },
                count: { type: 'integer', minimum: 1, maximum: 4 },
                duration: { type: 'number', description: 'video seconds.' },
                audio: { type: 'boolean', description: 'video: generate audio when supported.' },
                refs: {
                  type: 'array',
                  items: { type: 'string' },
                  description:
                    'image: reference/source images (and a video clip for clip models). model3d: the object image (multi-view models: 1–4 views of the same object). video: reference images/videos/audio for reference-to-video models, the keyframe images (in order) for keyframe models, or the audio track for lip-sync / soundtrack models.',
                },
                shots: {
                  type: 'array',
                  items: { type: 'object', properties: { prompt: { type: 'string' }, duration: { type: 'integer', minimum: 1 } }, required: ['prompt', 'duration'] },
                  description: 'video multi-shot models: one prompt per shot, seconds adding up to duration.',
                },
                times: {
                  type: 'array',
                  items: { type: ['number', 'null'] },
                  description: 'video keyframe models: second of each ref, parallel to refs; null = spread evenly. Needs an explicit duration.',
                },
                first_frame: { type: 'string', description: 'video: start image reference.' },
                last_frame: { type: 'string', description: 'video: end image reference.' },
                op: { type: 'string', enum: [...AGENT_OP_IDS] },
                input: { type: 'string', description: 'op: the image or video to transform.' },
                params: { type: 'object', description: 'op parameters; for image/video/audio/model3d steps, model parameters listed in the context (style values; audio: lyrics, is_instrumental, lyrics_optimizer, mode, title).' },
                text: { type: 'string', description: 'text step content, or the text of a text layer.' },
                layer_type: { type: 'string', enum: ['raster', 'text', 'vector'] },
                source: { type: 'string', description: 'raster layer: image reference.' },
                target: { type: 'string', description: 'layer: "base" (layer 1), "new", or an existing layer id of the same type.' },
                style: { type: 'object', description: 'text layer style.' },
                box: {
                  type: 'object',
                  properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' } },
                  description: 'text layer position and wrap width in document pixels.',
                },
                shapes: { type: 'array', items: { type: 'object' }, description: 'vector layer shapes.' },
              },
              required: ['id', 'kind'],
            },
          },
        },
        required: ['title', 'steps'],
      },
    },
  },
];

const questionSchema = z.object({
  id: z.string().min(1).max(40),
  question: z.string().min(1).max(300),
  options: z.array(z.string().min(1).max(120)).min(2).max(6),
  allow_custom: z.boolean().optional(),
  multi: z.boolean().optional(),
});

export const askQuestionsSchema = z.object({
  intro: z.string().max(400).optional(),
  questions: z.array(questionSchema).min(1).max(4),
});

const num = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/).transform(Number)]);

const stepSchema = z
  .object({
    id: z.string().max(40).optional(),
    kind: z.string(),
    title: z.string().max(120).optional(),
    prompt: z.string().max(4000).optional(),
    prompt_from: z.string().optional(),
    lyrics_from: z.string().optional(),
    model: z.string().optional(),
    aspect: z.string().optional(),
    resolution: z.string().optional(),
    count: num.optional(),
    duration: num.optional(),
    audio: z.boolean().optional(),
    seed: num.optional(),
    refs: z.array(z.string()).optional(),
    times: z.array(z.union([num, z.null()])).optional(),
    shots: z.array(z.object({ prompt: z.string().max(512), duration: num })).max(6).optional(),
    first_frame: z.string().optional(),
    last_frame: z.string().optional(),
    op: z.string().optional(),
    input: z.string().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    text: z.string().max(4000).optional(),
    layer_type: z.string().optional(),
    source: z.string().optional(),
    target: z.string().optional(),
    style: z.record(z.string(), z.unknown()).optional(),
    box: z.object({ x: num.optional(), y: num.optional(), width: num.optional() }).optional(),
    shapes: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough();

export const proposePlanSchema = z.object({
  title: z.string().max(200).optional(),
  summary: z.string().max(600).optional(),
  steps: z.array(stepSchema).min(1).max(MAX_PLAN_STEPS),
});

export function parseToolArgs(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: raw.trim() ? JSON.parse(raw) : {} };
  } catch {
    return { ok: false, error: `INVALID_JSON: ${raw.slice(0, 300)}` };
  }
}

export function formatZodError(err: z.ZodError): string {
  return err.issues
    .slice(0, 8)
    .map((i) => `${i.path.join('.') || 'input'}: ${i.message}`)
    .join('; ');
}

export function toRawPlan(v: z.infer<typeof proposePlanSchema>): RawPlan {
  return v as unknown as RawPlan;
}
