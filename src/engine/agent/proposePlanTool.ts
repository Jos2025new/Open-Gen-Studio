import type { ToolSpec } from '../providers/llm';
import { MAX_PLAN_STEPS } from '../plan';
import { AGENT_OP_IDS } from '../ops';
import { MEDIA_KINDS } from '../types';
import { LAYER_DOC } from './layerDoc';

/* The propose_plan tool schema offered to the agent. Split from tools.ts to stay under the 30 KB limit. */

const stepKinds = [...MEDIA_KINDS, 'op', 'text', 'layer'] as const;

export const PROPOSE_PLAN_TOOL: ToolSpec = {
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
        continuity: {
          type: 'array', maxItems: 12,
          description: 'Declare shared preservation requirements when outputs must keep identity, geometry, product details, style or other properties. Each source is an existing asset:<id>/layer:<id> or a source step (possibly the first requested output); steps lists its consumers, excluding the source itself. Consumers must receive it through compatible actual content inputs or derived inputs, not repeated text. Omit for independent work. Does not save, generate or regenerate anything.',
          items: { type: 'object', properties: { source: { type: 'string' }, preserve: { type: 'string', description: 'What must remain, not the changes.' }, steps: { type: 'array', items: { type: 'string' } } }, required: ['source', 'preserve', 'steps'] },
        },
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
              prompt: { type: 'string', description: 'image/video: full generation prompt, at most 4000 characters (English, except quoted dialogue and on-screen text). model3d: the object (shape, materials, style). audio: the music description, or the lyrics theme for a lyrics model.' },
              prompt_from: { type: 'string', description: 'image/video/audio: id of a text step whose text prefixes the prompt.' },
              lyrics_from: { type: 'string', description: 'audio (music models): id of a step whose text becomes the song lyrics (a lyrics step or a text step).' },
              user_requested: { type: 'boolean', description: 'Required with model: true only when the user requested it in this request; false for a recommendation or inherited selection.' },
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
              storyboard: { type: 'string', description: 'video: the storyboard or panel sheet among its inputs, if any; never first_frame.' },
              last_frame: { type: 'string', description: 'video: end image reference.' },
              op: { type: 'string', enum: [...AGENT_OP_IDS] },
              input: { type: 'string', description: 'op: the image or video to transform (join_clips: the first clip).' },
              more: { type: 'array', items: { type: 'string' }, description: 'join_clips: the other clips, in order.' },
              params: { type: 'object', description: 'op parameters; for image/video/audio/model3d steps, model parameters listed in the context (style values; audio: lyrics, is_instrumental, lyrics_optimizer, mode, title).' },
              text: { type: 'string', description: 'text step content, or the text of a text layer.' },
              layer_type: { type: 'string', enum: ['raster', 'text', 'vector'] },
              source: { type: 'string', description: `raster layer: ${LAYER_DOC.source}` },
              target: { type: 'string', description: `layer: ${LAYER_DOC.target}` },
              style: { type: 'object', description: `text layer style ${LAYER_DOC.style}` },
              box: {
                type: 'object',
                properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' } },
                description: LAYER_DOC.box,
              },
              shapes: {
                type: 'array',
                items: { type: 'object' },
                description: LAYER_DOC.shapes,
              },
              strokes: {
                type: 'array',
                items: { type: 'object' },
                description: LAYER_DOC.strokes,
              },
            },
            required: ['id', 'kind'],
          },
        },
      },
      required: ['title', 'steps'],
    },
  },
};
