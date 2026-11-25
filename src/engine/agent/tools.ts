import { SETTINGS_POLICY } from '../procedure';
import { PROVIDER_PARAM } from './changeRules';
import { CONTINUE_IN_CANVAS_TOOL, OPEN_BOARD_TOOL } from './agentCanvas';
import { z } from 'zod';
import type { ToolSpec } from '../providers/llm';
import { MAX_PLAN_STEPS, type RawPlan } from '../plan';
import { MEDIA_KINDS, VISUAL_MEDIA_KINDS } from '../types';
import { DESIGNER_TOOLS } from './designerTools';
import { JOB_TOOLS } from './jobStatus';
import { PROPOSE_PLAN_TOOL } from './proposePlanTool';

/* Tools the agent can call. Inputs are validated with zod before use. */

const confirmSettingsKinds = [VISUAL_MEDIA_KINDS[1], VISUAL_MEDIA_KINDS[0]] as const;

export const editNodeSchema = z.object({ node_id: z.string().min(1), expect_rev: z.string().min(1), title: z.string().optional(), prompt: z.string().optional(), model_ref: z.string().optional(), settings: z.object({
  aspect: z.string().optional(), resolution: z.string().optional(), count: z.number().int().min(1).max(8).optional(), duration: z.number().optional(), audio: z.boolean().optional(), seed: z.number().optional(), negative: z.string().optional(), advanced: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(), extras: z.record(z.string(), z.unknown()).optional(), shots: z.array(z.object({ prompt:z.string(), duration:z.number() })).optional(),
}).strict().optional(), params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional() }).strict();
export const connectNodesSchema = z.object({ source: z.string(), target: z.string(), port: z.string(), replaces: z.string().optional() }).strict();
export const disconnectNodesSchema = z.object({ edge_ids: z.array(z.string()).min(1).max(40) }).strict();
export const nodeIdsSchema = z.object({ node_ids: z.array(z.string()).min(1).max(40) }).strict();

export const TOOLS: ToolSpec[] = [
  { type:'function', function:{ name:'edit_node', description:'Node canvas: edit an existing node. prompt edits generation prompts or text-node text. settings/params merge with existing values. model_ref uses the same model action as the UI. Keeps outputs and connections except those invalidated by a model output change.', parameters:{type:'object',properties:{node_id:{type:'string'},expect_rev:{type:'string',description:'The rev read_graph showed for this node; a changed node is refused.'},title:{type:'string'},prompt:{type:'string'},model_ref:{type:'string'},settings:{type:'object',properties:{aspect:{type:'string'},resolution:{type:'string'},count:{type:'integer'},duration:{type:'number'},audio:{type:'boolean'},seed:{type:'number'},negative:{type:'string'},advanced:{type:'object'},extras:{type:'object'},shots:{type:'array',items:{type:'object'}}}},params:{type:'object'}},required:['node_id','expect_rev']} } },
  { type:'function', function:{ name:'connect_nodes', description:'Node canvas: connect existing nodes to the named target port. Uses UI port/cycle validation. An occupied single-input port needs `replaces`: the edge id (from read_graph) you mean to replace.', parameters:{type:'object',properties:{source:{type:'string'},target:{type:'string'},port:{type:'string'},replaces:{type:'string'}},required:['source','target','port']} } },
  { type:'function', function:{ name:'disconnect_nodes', description:'Node canvas: disconnect existing edge IDs returned by read_graph.', parameters:{type:'object',properties:{edge_ids:{type:'array',items:{type:'string'},minItems:1,maxItems:40}},required:['edge_ids']} } },
  { type:'function', function:{ name:'delete_nodes', description:'Node canvas: delete these existing nodes and their connections. Results stay in the Library; the chat offers Undo. No extra confirmation.', parameters:{type:'object',properties:{node_ids:{type:'array',items:{type:'string'},minItems:1,maxItems:40}},required:['node_ids']} } },
  { type:'function', function:{ name:'restore_nodes', description:'Node canvas: restore a deletion only when the user explicitly asks to recover it. Uses the same snapshot and action as chat Undo, preserving later edits. deletion_id comes from deleted nodes in the context; optional node_ids restores only those nodes.', parameters:{type:'object',properties:{deletion_id:{type:'string'},node_ids:{type:'array',items:{type:'string'},minItems:1,maxItems:40}},required:['deletion_id']} } },
  { type:'function', function:{ name:'run_nodes', description:'Node canvas: propose Run for existing node IDs. The card includes stale/missing ancestors and cost, and waits for the user click, even in Auto. Never creates nodes or runs descendants outside the requested targets.', parameters:{type:'object',properties:{node_ids:{type:'array',items:{type:'string'},minItems:1,maxItems:40}},required:['node_ids']} } },
  {
    type: 'function',
    function: {
      name: 'find_models',
      description:
        'Search the models supported by the app when the user names a model that is not in the context (e.g. "seedance 2.0 fast"). Returns up to 8 refs with inputs and price, only from the app\'s supported catalog. Do not call it when a listed model fits.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The model name as the user said it, e.g. "seedance 2.0 fast".' },
          kind: { type: 'string', enum: [...MEDIA_KINDS], description: 'Optional: only models that make this.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recover_plan',
      description:
        'Resume the latest plan that failed or finished with errors, in the same card. check_status asks the providers again about the jobs they received (only steps with a job id; no new charge for them); retry never runs by itself (it may charge again): it only tells you to ask the user to press "Retry failed" on the plan card. Steps that waited for them run afterwards. Only when the user asks to check or retry; never propose a new plan for a failed one.',
      parameters: {
        type: 'object',
        properties: { action: { type: 'string', enum: ['check_status', 'retry'] } },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_assets',
      description:
        'This session\'s results and uploads (never other sessions), newest first: id, type and file extension, date, model, prompt or operation, settings, inputs. Filter by kind, origin, canvas, date (since: "24h", "7d", "today" or a date) and words (prompt, model, operation, extension like "png" or "glb", id). view: true also sends the first matches (up to 4) as images in the next message — the only way to see a result you were not shown. A 3D model is shown by its current saved view image; previous captures remain separate image assets.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'array', items: { type: 'string', enum: [...MEDIA_KINDS] } },
          query: { type: 'string' },
          canvas: { type: 'string', enum: ['this', 'all'], description: 'this (default): the current canvas; all: every canvas of this session.' },
          since: { type: 'string' },
          origin: { type: 'array', items: { type: 'string', enum: ['generated', 'upload', 'view3d', 'frame', 'design'] } },
          favorites: { type: 'boolean' },
          sort: { type: 'string', enum: ['newest', 'oldest'] },
          limit: { type: 'integer', minimum: 1, maximum: 20 },
          offset: { type: 'integer', minimum: 0 },
          view: { type: 'boolean' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'continue_in_designer',
      description:
        'Any canvas. When the user wants images in the Designer ("pásalo al designer", "continue in the designer"): the app puts each image as a raster layer — by default all as layers of one design (as "layers"); each image its own design (as "documents") only when the user asks for separate canvases. Without asset_ids: every chat image result not in a design yet. Only images: video, audio and 3D have no layers yet and are skipped. Nothing is generated or charged; the user\'s view switches to the Designer (in Studio the board opens on the Designer instead).',
      parameters: {
        type: 'object',
        properties: {
          asset_ids: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'Image asset ids (without "asset:"); omit for every chat image not in a design yet.' },
          as: { type: 'string', enum: ['documents', 'layers'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'continue_in_chat',
      description:
        'Any canvas. When the user wants to return to Chat or take node results there, the app switches to Chat and adds the existing generations as normal result cards. With node_ids, imports only those current node results; without them, imports every current node result not already shown in Chat. It does not copy files, duplicate generations, run providers or charge anything.',
      parameters: {
        type: 'object',
        properties: { node_ids: { type: 'array', items: { type: 'string' }, maxItems: 40, description: 'Optional node ids whose current results should appear in Chat.' } },
      },
    },
  },
  CONTINUE_IN_CANVAS_TOOL,
  OPEN_BOARD_TOOL,
  {
    type: 'function',
    function: {
      name: 'read_graph',
      description:
        'Node canvas only, read-only. Without node_ids: the next page of the node index (offset). With node_ids: each node\'s status, error, model, prompt, output asset (usable in plans) and connections by port. Use it when the index in the context is not enough; it cannot edit nodes.',
      parameters: {
        type: 'object',
        properties: {
          node_ids: { type: 'array', items: { type: 'string' }, maxItems: 10, description: 'Node ids from the index.' },
          offset: { type: 'integer', minimum: 0, description: 'Index page start when no node_ids are given.' },
        },
      },
    },
  },
  ...DESIGNER_TOOLS,
  ...JOB_TOOLS,
  {
    type: 'function',
    function: {
      name: 'read_guide',
      description:
        'Load one skill or workflow from the index when the request fits it and it is not already in the context. Returns its steps, needs and continuity (workflows) or its prompting guidance (skills). Before asking, a workflow gives a short card; ready: true, the full guide.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Index id: "workflow:storyboard", "skill:product", "workflow:<id>/<variant>".' },
          ready: { type: 'boolean' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'confirm_settings',
      description:
        SETTINGS_POLICY + ' Show one card for the image/video kinds in this plan, with the recommended model and its supported values. After confirmation use those values and the returned guide. Images count is per step: distinct requested outputs need distinct steps, not candidates of one prompt.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'What this plan will make, one short line in the user\'s language ("ficha de la creadora (3 opciones) y la corneta").' },
          parts: {
            type: 'array',
            description: 'One entry per kind of step in this plan.',
            items: {
              type: 'object',
              properties: {
          kind: { type: 'string', enum: [...confirmSettingsKinds] },
          purpose: { type: 'string', enum: ['draft', 'normal', 'long'], description: 'Video only (leave out for images): draft (a test), normal (default), long (over 15 s).' },
          start_image: { type: 'boolean', description: 'Video starts from an image (first_frame).' },
          refs: { type: 'integer', description: 'How many reference or source images each step takes (identity, product, style).' },
          count: { type: 'integer', description: 'Video: how many clips the plan makes. Images: how many to generate per image step, 1–4 (your recommendation, e.g. 3 candidates for a sheet; the user can change it on the card).' },
          duration: { type: 'number', description: 'Video: seconds per clip you recommend.' },
          aspect: { type: 'string', description: 'Shape you recommend ("9:16"); leave out to keep a start image\'s shape.' },
          model: { type: 'string', description: 'The model named/selected by the user; omit to use the app recommendation. Recommend another listed model only for a required capability or requested comparison.' },
          user_requested: { type: 'boolean', description: 'True only if the user requested this model, including an accepted alternative or a comparison. False for your recommendation. Never infer a new request from an older choice.' },
          provider: PROVIDER_PARAM,
              },
              required: ['kind', 'user_requested'],
            },
          },
        },
        required: ['parts'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_questions',
      description:
        'Ask 1-4 short, decisive questions that remove real ambiguity before planning, all needed ones together in one card. Each question has 2-5 concrete options and a default: the option you recommend, preselected so one click continues. Never ask about details you can settle with a sensible choice or the user already settled. Auto mode: at most one card, only when a missing answer changes the result or the cost.',
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
                default: { type: 'string', description: 'The recommended option, exactly as written in options; shown preselected.' },
              },
              required: ['id', 'question', 'options'],
            },
          },
        },
        required: ['questions'],
      },
    },
  },
  PROPOSE_PLAN_TOOL,
];

const questionSchema = z.object({
  id: z.string().min(1).max(40),
  question: z.string().min(1).max(300),
  options: z.array(z.string().min(1).max(120)).min(2).max(6),
  allow_custom: z.boolean().optional(),
  multi: z.boolean().optional(),
  default: z.string().max(120).optional(),
});

export const findModelsSchema = z.object({
  query: z.string().min(1).max(120),
  kind: z.enum(MEDIA_KINDS).optional(),
});

export const findAssetsSchema = z.object({
  kind: z.array(z.enum(MEDIA_KINDS)).optional(),
  query: z.string().max(200).optional(),
  canvas: z.enum(['this', 'all']).optional(),
  since: z.string().max(40).optional(),
  origin: z.array(z.enum(['generated', 'upload', 'view3d', 'frame', 'design'])).optional(),
  favorites: z.boolean().optional(),
  sort: z.enum(['newest', 'oldest']).optional(),
  limit: z.number().int().min(1).max(20).optional(),
  offset: z.number().int().min(0).optional(),
  view: z.boolean().optional(),
});

export const continueInDesignerSchema = z.object({
  asset_ids: z.array(z.string().min(1).max(80).transform((x) => x.replace(/^asset:/, ''))).max(20).optional(),
  as: z.enum(['documents', 'layers']).optional(),
});

export const continueInChatSchema = z.object({
  node_ids: z.array(z.string().min(1).max(80)).max(40).optional(),
});

export const readGraphSchema = z.object({
  node_ids: z.array(z.string().min(1).max(80)).max(10).optional(),
  offset: z.number().int().min(0).optional(),
});

export const viewCanvasSchema = z.object({ layer_id: z.string().min(1).max(80).optional() });

export const readGuideSchema = z.object({ id: z.string().min(1).max(80), ready: z.boolean().optional() });

export const recoverPlanSchema = z.object({ action: z.enum(['check_status', 'retry']) });

const num = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/).transform(Number)]);
const settingsPartSchema = z.object({
  kind: z.enum(confirmSettingsKinds),
  purpose: z.unknown().optional().transform((v) => (v === 'draft' || v === 'normal' || v === 'long' ? v : undefined)),
  start_image: z.boolean().optional(),
  refs: z.number().int().min(0).max(20).optional(),
  count: num.pipe(z.number().int().min(1).max(24)).optional(),
  duration: num.pipe(z.number().min(0).max(120)).optional(),
  aspect: z.string().max(20).optional(),
  user_requested: z.boolean().optional(),
  model: z.string().max(200).optional(),
  provider: z.string().max(40).optional(),
});
export const confirmSettingsSchema = z.preprocess(
  (v) => (v && typeof v === 'object' && !('parts' in v) && 'kind' in v ? { summary: (v as { summary?: unknown }).summary, parts: [v] } : v),
  z.object({ summary: z.string().max(300).optional(), parts: z.array(settingsPartSchema).min(1).max(4) }),
);

export const askQuestionsSchema = z.object({
  intro: z.string().max(400).optional(),
  questions: z.array(questionSchema).min(1).max(4),
});

const stepSchema = z
  .object({
    id: z.string().max(40).optional(),
    kind: z.string(),
    title: z.string().max(120).optional(),
    variations: z.array(z.string().max(400)).max(4).optional(),
    prompt: z.string().max(4000).optional(),
    prompt_from: z.string().optional(),
    lyrics_from: z.string().optional(),
    model: z.string().optional(),
    user_requested: z.boolean().optional(),
    purpose: z.enum(['draft', 'normal', 'long']).optional(),
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
    storyboard: z.string().optional(),
    last_frame: z.string().optional(),
    op: z.string().optional(),
    input: z.string().optional(),
    more: z.array(z.string()).max(19).optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    text: z.string().max(4000).optional(),
    layer_type: z.string().optional(),
    source: z.string().optional(),
    target: z.string().optional(),
    style: z.record(z.string(), z.unknown()).optional(),
    box: z.object({ x: num.optional(), y: num.optional(), width: num.optional() }).optional(),
    shapes: z.array(z.record(z.string(), z.unknown())).optional(),
    strokes: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough();

const STEPS_AS_TEXT = Symbol('steps sent as broken text');
const STEPS_HELP =
  'must be a JSON array of step objects, not a string (and no extra or missing brackets). Example: "steps": [{"id": "s1", "kind": "image", "prompt": "..."}, {"id": "s2", "kind": "image", "prompt": "..."}]';

export const proposePlanSchema = z.object({
  continuity: z.array(z.object({ source: z.string().min(1).max(80), preserve: z.string().min(1).transform((s) => s.slice(0, 200)), steps: z.array(z.string().min(1).max(40)).min(1).max(MAX_PLAN_STEPS) })).max(12).optional(),
  title: z.string().max(200).optional(),
  summary: z.string().max(600).optional(),
  revision: z.boolean().optional(),
  total_duration: num.optional(),
  style: z.string().max(600).optional(),
  subjects: z
    .array(z.object({ name: z.string().max(40), kind: z.enum(['character', 'object', 'product', 'location', 'style']).optional(), from: z.string().max(80), description: z.string().max(200).optional() }))
    .max(6)
    .optional(),
  steps: z.preprocess(
    (v) => {
      if (typeof v !== 'string') return v;
      try { return JSON.parse(v); } catch { return STEPS_AS_TEXT; }
    },
    z.unknown().superRefine((v, ctx) => {
      if (v === STEPS_AS_TEXT || !Array.isArray(v)) ctx.addIssue({ code: 'custom', message: STEPS_HELP });
    }).pipe(z.array(stepSchema).min(1).max(MAX_PLAN_STEPS)),
  ),
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

export const CAPABILITIES = [
  'YOU HAVE these tools (call them; do not wonder whether you can):',
  ...TOOLS.map((t) => `- ${t.function.name}: ${t.function.description.split(/(?<=\.)\s/)[0]}`),
  'LIBRARY KITS (moodboard, design-system, brand-kit): reusable graph/token/asset collections (copied with origin on insert, no live link). Read the index (library.item.list/read) before designing; build via library.item.create → Designer/Nodes → designer.group.create → library.item.save (graph, tokens, kits; pass the canvas ID as doc to publish the canvas).',
  'ACTIVE BRAND: when <app_context> has an active moodboard, design system or brand kit, every piece follows it: its colors, fonts and token values exactly, its images as references, its components by library.item.insert; what it does not define, decide in its spirit. Fill a kit by section with library.item.add (Logos, Photos, Icons, Graphics, Charts, Voice, Guidelines, or a new name); colors, fonts and sizes are its tokens (library.item.save); attached font files go in its Fonts section (library.item.add with fonts).',
  'YOU DO NOT HAVE: files, the internet, a shell, or anything outside these tools and <app_context>. Never claim results you did not get from them.',
].join('\n');

export const MUST = `YOU MUST:
- If a tool can answer it, call the tool now; do not speculate about what it would return.
- If only the user has a piece of data, ask_questions; never invent it. Never cite step ids, asset ids or models that the context or a tool did not give you.
- Interpret first: a clear request goes straight to its workflow; open questions (ask_questions / propose settings) come before loading it.
- Think briefly, then act. Doubting your abilities wastes the user's time: your abilities are the tools listed.
- If you cannot do something, say so in one sentence.
- Never claim to have seen what is not visible in the current messages; if a detail is too small to check, say so.`;
