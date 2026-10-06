import { SETTINGS_POLICY } from '../procedure';
import { z } from 'zod';
import type { ToolSpec } from '../providers/llm';
import { MAX_PLAN_STEPS, type RawPlan } from '../plan';
import { AGENT_OP_IDS } from '../ops';

/* Tools the agent can call. Inputs are validated with zod before use. */

const stepKinds = ['image', 'video', 'audio', 'model3d', 'op', 'text', 'layer'] as const;

export const editNodeSchema = z.object({ node_id: z.string().min(1), title: z.string().optional(), prompt: z.string().optional(), model_ref: z.string().optional(), settings: z.object({
  aspect: z.string().optional(), resolution: z.string().optional(), count: z.number().int().min(1).max(8).optional(), duration: z.number().optional(), audio: z.boolean().optional(), seed: z.number().optional(), negative: z.string().optional(), advanced: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(), extras: z.record(z.string(), z.unknown()).optional(), shots: z.array(z.object({ prompt:z.string(), duration:z.number() })).optional(),
}).strict().optional(), params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional() }).strict();
export const connectNodesSchema = z.object({ source: z.string(), target: z.string(), port: z.string() }).strict();
export const disconnectNodesSchema = z.object({ edge_ids: z.array(z.string()).min(1).max(40) }).strict();
export const nodeIdsSchema = z.object({ node_ids: z.array(z.string()).min(1).max(40) }).strict();

export const TOOLS: ToolSpec[] = [
  { type:'function', function:{ name:'edit_node', description:'Node canvas: edit an existing node. prompt edits generation prompts or text-node text. settings/params merge with existing values. model_ref uses the same model action as the UI. Keeps outputs and connections except those invalidated by a model output change.', parameters:{type:'object',properties:{node_id:{type:'string'},title:{type:'string'},prompt:{type:'string'},model_ref:{type:'string'},settings:{type:'object',properties:{aspect:{type:'string'},resolution:{type:'string'},count:{type:'integer'},duration:{type:'number'},audio:{type:'boolean'},seed:{type:'number'},negative:{type:'string'},advanced:{type:'object'},extras:{type:'object'},shots:{type:'array',items:{type:'object'}}}},params:{type:'object'}},required:['node_id']} } },
  { type:'function', function:{ name:'connect_nodes', description:'Node canvas: connect existing nodes to the named target port. Uses UI port/cycle validation and replaces an occupied single-input port.', parameters:{type:'object',properties:{source:{type:'string'},target:{type:'string'},port:{type:'string'}},required:['source','target','port']} } },
  { type:'function', function:{ name:'disconnect_nodes', description:'Node canvas: disconnect existing edge IDs returned by read_graph.', parameters:{type:'object',properties:{edge_ids:{type:'array',items:{type:'string'},minItems:1,maxItems:40}},required:['edge_ids']} } },
  { type:'function', function:{ name:'delete_nodes', description:'Node canvas: delete these existing nodes and their connections. Results stay in the gallery; the chat offers Undo. No extra confirmation.', parameters:{type:'object',properties:{node_ids:{type:'array',items:{type:'string'},minItems:1,maxItems:40}},required:['node_ids']} } },
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
          kind: { type: 'string', enum: ['image', 'video', 'audio', 'model3d'], description: 'Optional: only models that make this.' },
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
        'Resume the latest plan that failed or finished with errors, in the same card. check_status asks the providers again about the jobs they received (only steps with a job id; no new charge for them); retry runs the failed steps again (charged again). Steps that waited for them run afterwards. Only when the user asks to check or retry; never propose a new plan for a failed one.',
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
        'This session\'s results and uploads (never other sessions), newest first: id, type and file extension, date, model, prompt or operation, settings, inputs. Filter by kind, origin, canvas, date (since: "24h", "7d", "today" or a date) and words (prompt, model, operation, extension like "png" or "glb", id). view: true also sends the first matches (up to 4) as images in the next message — the only way to see a result you were not shown. A 3D model is shown by its view image.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'array', items: { type: 'string', enum: ['image', 'video', 'audio', 'model3d'] } },
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
        'Any canvas. When the user wants images in the Designer ("pásalo al designer", "continue in the designer"): the app puts each image as a raster layer — by default all as layers of one design (as "layers"); each image its own design (as "documents") only when the user asks for separate canvases. Without asset_ids: every chat image result not in a design yet. Only images: video, audio and 3D have no layers yet and are skipped. Nothing is generated or charged; the user\'s view switches to the Designer.',
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
  {
    type: 'function',
    function: {
      name: 'continue_in_canvas',
      description:
        'Any canvas. When the user wants to move to or continue on the node canvas ("pasémonos al canvas de nodos", "continuamos en canvas"): the app switches the user\'s view to Nodes and adds every finished chat result as a node with its own result, prompt, model and settings, connected by the inputs it used; nothing runs again and nothing is charged. Returns the new node ids. Call it once; then build on those nodes.',
      parameters: { type: 'object', properties: {} },
    },
  },
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
  {
    type: 'function',
    function: {
      name: 'view_canvas',
      description:
        'Designer only: see the page again, or one layer alone (layer_id), as a reduced image with the scale back to document px. The page already comes with each new request; call this only for a single layer or after changes.',
      parameters: { type: 'object', properties: { layer_id: { type: 'string', description: 'A layer id from the context; omit for the whole page.' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_guide',
      description:
        'Load one skill or workflow from the index in your instructions, when the request fits it and it is not already in the context. Returns its steps, fixed values, needs and continuity (workflows) or its prompting guidance (skills).',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'An index id, e.g. "workflow:storyboard", "skill:product", "model:seedance"; a workflow variant as "workflow:<id>/<variant>".' } },
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
          kind: { type: 'string', enum: ['video', 'image'] },
          purpose: { type: 'string', enum: ['draft', 'normal', 'long'], description: 'Video only (leave out for images): draft (a test), normal (default), long (over 15 s).' },
          start_image: { type: 'boolean', description: 'Video starts from an image (first_frame).' },
          refs: { type: 'integer', description: 'How many reference or source images each step takes (identity, product, style).' },
          count: { type: 'integer', description: 'Video: how many clips the plan makes. Images: how many to generate per image step, 1–4 (your recommendation, e.g. 3 candidates for a sheet; the user can change it on the card).' },
          duration: { type: 'number', description: 'Video: seconds per clip you recommend.' },
          aspect: { type: 'string', description: 'Shape you recommend ("9:16"); leave out to keep a start image\'s shape.' },
          model: { type: 'string', description: 'The model named/selected by the user; omit to use the app recommendation. Recommend another listed model only for a required capability or requested comparison.' },
              },
              required: ['kind'],
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
          revision: { type: 'boolean', description: 'true when this plan changes the pending plan the user just commented on; false or omitted for a different request.' },
          total_duration: { type: 'number', description: 'Seconds the video steps add up to when the user gave a total; the app splits it over the video steps that set no duration.' },
          style: {
            type: 'string',
            description: 'One short style block for the whole plan (medium, palette, lighting, lens or rendering). The app appends it verbatim to every image and video prompt; do not repeat it in the prompts.',
          },
          subjects: {
            type: 'array',
            maxItems: 6,
            description:
              'Named image references across steps. For temporary use of an existing image, use refs in each consuming step instead. from asset:<id> saves to the library when the approved plan runs: use only when the user explicitly asked to save or accepted an offer to save. from an image step is used by this plan only, never saved automatically. Steps mention @Name; the app sends its image in the model syntax and waits for its source step. Reuse existing library names without redefining them.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'One word, e.g. "Reto".' },
                kind: { type: 'string', enum: ['character', 'object', 'product', 'location', 'style'] },
                from: { type: 'string', description: 'asset:<id> or an image step id.' },
                description: { type: 'string', description: 'Short note, in the user\'s language.' },
              },
              required: ['name', 'from'],
            },
          },
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
                model: { type: 'string', description: 'Confirmed or user-named/selected model ref "provider::id" or compatible family; also supported for edit/animate ops. Omit to use the app default/source precedence, not necessarily the composer model.' },
                purpose: { type: 'string', enum: ['draft', 'normal', 'long'], description: 'video without "model": draft (test, cheapest), normal (default), long (over 15 s, up to 30 s). The app picks the cheapest fitting model.' },
                aspect: { type: 'string', description: 'e.g. "16:9", "9:16", "1:1", "4:5".' },
                resolution: { type: 'string', description: 'A value from the model options (e.g. "2K", "1080p").' },
                count: { type: 'integer', minimum: 1, maximum: 4 },
                variations: { type: 'array', items: { type: 'string' }, description: 'image with several results to choose from: one short line per result (as many as count), each a slight variation of what is still open (look, outfit, hair, palette, pose…) inside what the user decided; the prompt holds what they share. Leave out for one result or for copies that must match.' },
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
                first_frame: { type: 'string', description: 'video: start image reference (a clip step starts from its last frame).' },
                last_frame: { type: 'string', description: 'video: end image reference.' },
                op: { type: 'string', enum: [...AGENT_OP_IDS] },
                input: { type: 'string', description: 'op: the image or video to transform (join_clips: the first clip).' },
                more: { type: 'array', items: { type: 'string' }, description: 'join_clips: the other clips, in order.' },
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
                shapes: {
                  type: 'array',
                  items: { type: 'object' },
                  description:
                    'vector layer shapes in document px: {type: rect|ellipse|line, x, y, w, h, fill, stroke, stroke_width, radius} or {type: "path", d, fill, stroke, stroke_width} with absolute commands only (M L C Q S T Z) for precise curves.',
                },
                strokes: {
                  type: 'array',
                  items: { type: 'object' },
                  description:
                    'freehand drawing in document px: [{points: [[x, y] or [x, y, pressure 0-1], …], color, size}]; enough points to follow each curve. vector layer → editable strokes; raster layer (target "new") → painted with the brush on a new layer.',
                },
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
  default: z.string().max(120).optional(),
});

export const findModelsSchema = z.object({
  query: z.string().min(1).max(120),
  kind: z.enum(['image', 'video', 'audio', 'model3d']).optional(),
});

export const findAssetsSchema = z.object({
  kind: z.array(z.enum(['image', 'video', 'audio', 'model3d'])).optional(),
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

export const readGuideSchema = z.object({ id: z.string().min(1).max(80) });

export const recoverPlanSchema = z.object({ action: z.enum(['check_status', 'retry']) });

const settingsPartSchema = z.object({
  kind: z.enum(['video', 'image']),
  // Video only; any other value (an image "purpose") is dropped instead of refusing the card.
  purpose: z.unknown().optional().transform((v) => (v === 'draft' || v === 'normal' || v === 'long' ? v : undefined)),
  start_image: z.boolean().optional(),
  refs: z.number().int().min(0).max(20).optional(),
  count: z.number().int().min(1).max(24).optional(),
  duration: z.number().min(0).max(120).optional(),
  aspect: z.string().max(20).optional(),
  model: z.string().max(200).optional(),
});
// One card per plan: its parts (a single object without "parts" is read as one part, for older calls).
export const confirmSettingsSchema = z.preprocess(
  (v) => (v && typeof v === 'object' && !('parts' in v) && 'kind' in v ? { summary: (v as { summary?: unknown }).summary, parts: [v] } : v),
  z.object({ summary: z.string().max(300).optional(), parts: z.array(settingsPartSchema).min(1).max(4) }),
);

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
    variations: z.array(z.string().max(400)).max(4).optional(),
    prompt: z.string().max(4000).optional(),
    prompt_from: z.string().optional(),
    lyrics_from: z.string().optional(),
    model: z.string().optional(),
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
  title: z.string().max(200).optional(),
  summary: z.string().max(600).optional(),
  revision: z.boolean().optional(),
  total_duration: num.optional(),
  style: z.string().max(600).optional(),
  subjects: z
    .array(z.object({ name: z.string().max(40), kind: z.enum(['character', 'object', 'product', 'location', 'style']).optional(), from: z.string().max(80), description: z.string().max(200).optional() }))
    .max(6)
    .optional(),
  // Some models send the array as a JSON string: a valid one is read; a broken one gets an error that says how to fix it.
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

/** What the agent has and has not, built from TOOLS so it never drifts from the real tool list. */
export const CAPABILITIES = [
  'YOU HAVE these tools (call them; do not wonder whether you can):',
  ...TOOLS.map((t) => `- ${t.function.name}: ${t.function.description.split(/(?<=\.)\s/)[0]}`),
  'YOU DO NOT HAVE: files, the internet, a shell, or anything outside these tools and <app_context>. Never claim results you did not get from them.',
].join('\n');

/** Anti-drift rules: first and last in the system prompt (models weigh the start and the end most). */
export const MUST = `YOU MUST:
- If a tool can answer it, call the tool now; do not speculate about what it would return.
- If only the user has a piece of data, ask_questions; never invent it. Never cite step ids, asset ids or models that the context or a tool did not give you.
- Think briefly, then act. Doubting your abilities wastes the user's time: your abilities are the tools listed.
- If you cannot do something, say so in one sentence.`;
