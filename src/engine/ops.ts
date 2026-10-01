import type { AdvancedValue, AssetKind, OpId } from './types';

export interface OpField {
  key: string;
  label: string;
  type: 'choice' | 'text';
  options?: Array<{ value: string; label: string }>;
  default: string;
  placeholder?: string;
  required?: boolean;
}

/** Which engine runs the operation. 'edit' = an image model that accepts a source image; 'local' = free, in the browser. */
export type OpEngine = 'edit' | 'upscale' | 'remove_bg' | 'video' | 'local' | 'video_upscale' | 'video_edit' | 'video_extend' | 'transcribe' | 'voice' | 'inpaint' | 'remove_object';

export interface OpDef {
  id: OpId;
  label: string;
  description: string;
  input: AssetKind;
  /** 'text' = the result is text (transcription), shown in the card and usable as a prompt. */
  output: AssetKind | 'text';
  engine: OpEngine;
  fields: OpField[];
  /** Shown as a one-click chip on generation cards. */
  quick: boolean;
  /** Needs a mask drawn in Sketch: launched from there, not from menus, nodes or the agent. */
  viaSketch?: boolean;
  /** Takes several clips (join_clips): planned by the agent in chat, not offered on a single asset. */
  multiInput?: boolean;
  /** Returns the instruction prompt sent to the model (edit / video engines). */
  instruction?: (p: Record<string, AdvancedValue>) => string;
}

const opt = (...pairs: Array<[string, string]>) => pairs.map(([value, label]) => ({ value, label }));

const PRESERVE = 'Keep the subject identity, composition, pose, materials and every detail unchanged.';

export const OPS: Record<OpId, OpDef> = {
  relight: {
    id: 'relight',
    label: 'Relight',
    description: 'Change the lighting while preserving the subject.',
    input: 'image',
    output: 'image',
    engine: 'edit',
    quick: true,
    fields: [
      {
        key: 'preset',
        label: 'Light',
        type: 'choice',
        default: 'golden-hour',
        options: opt(
          ['golden-hour', 'Golden hour'],
          ['softbox', 'Studio softbox'],
          ['overcast', 'Soft overcast'],
          ['rim', 'Rim / backlight'],
          ['neon', 'Neon night'],
          ['candle', 'Candlelight'],
          ['moonlight', 'Moonlight'],
          ['chiaroscuro', 'Dramatic chiaroscuro'],
        ),
      },
      {
        key: 'direction',
        label: 'From',
        type: 'choice',
        default: 'left',
        options: opt(['left', 'Left'], ['right', 'Right'], ['top', 'Top'], ['front', 'Front'], ['behind', 'Behind'], ['below', 'Below']),
      },
      {
        key: 'intensity',
        label: 'Intensity',
        type: 'choice',
        default: 'medium',
        options: opt(['subtle', 'Subtle'], ['medium', 'Medium'], ['strong', 'Strong']),
      },
      { key: 'note', label: 'Note', type: 'text', default: '', placeholder: 'Optional detail, e.g. warm fill on the face' },
    ],
    instruction: (p) => {
      const names: Record<string, string> = {
        'golden-hour': 'warm golden-hour sunlight',
        softbox: 'clean studio softbox lighting',
        overcast: 'soft diffused overcast daylight',
        rim: 'strong rim light / backlight with a subtle fill',
        neon: 'saturated neon night lighting (magenta and cyan)',
        candle: 'warm flickering candlelight',
        moonlight: 'cool blue moonlight',
        chiaroscuro: 'dramatic chiaroscuro lighting with deep shadows',
      };
      const light = names[String(p.preset)] ?? String(p.preset);
      const strength: Record<string, string> = {
        subtle: 'subtle intensity: a gentle shift, the original look stays recognizable',
        medium: 'medium intensity',
        strong: 'strong intensity',
      };
      // Lighting only: the model must not redraw, restyle or add anything (it tended to add suns, flares and scenery).
      return [
        `Relighting edit only. Change only the lighting: ${light} coming from the ${p.direction}, ${strength[String(p.intensity)] ?? `${p.intensity} intensity`}.`,
        'Recompute shadows, highlights, reflections and color temperature so they match this light, and nothing else.',
        'Keep everything else exactly as it is: the same subject, face, hair, pose, clothing, proportions, framing, crop, camera angle, background and art style.',
        'Do not add or remove anything: no visible light sources (sun, lamps, lens flares, glows, bokeh), no new objects, scenery, floor, sky or background detail.',
      ].join(' ') + note(p);
    },
  },
  angle: {
    id: 'angle',
    label: 'Change angle',
    description: 'Re-render the same scene from another camera angle.',
    input: 'image',
    output: 'image',
    engine: 'edit',
    quick: true,
    fields: [
      {
        key: 'angle',
        label: 'Camera',
        type: 'choice',
        default: 'three-quarter-left',
        options: opt(
          ['front', 'Front'],
          ['three-quarter-left', '3/4 left'],
          ['three-quarter-right', '3/4 right'],
          ['profile-left', 'Left profile'],
          ['profile-right', 'Right profile'],
          ['back', 'From behind'],
          ['top-down', 'Top-down'],
          ['high', 'High angle'],
          ['low', 'Low angle'],
          ['close-up', 'Close-up'],
          ['wide', 'Wide shot'],
        ),
      },
      { key: 'note', label: 'Note', type: 'text', default: '', placeholder: 'Optional detail' },
    ],
    instruction: (p) => {
      const names: Record<string, string> = {
        front: 'a straight frontal view',
        'three-quarter-left': 'a three-quarter view from the left',
        'three-quarter-right': 'a three-quarter view from the right',
        'profile-left': 'a left side profile view',
        'profile-right': 'a right side profile view',
        back: 'a view from behind',
        'top-down': "a top-down bird's-eye view",
        high: 'a high camera angle looking down',
        low: 'a low camera angle looking up',
        'close-up': 'a tighter close-up framing',
        wide: 'a wider establishing shot',
      };
      return `Change only the camera viewpoint: show the exact same subject and scene from ${names[String(p.angle)] ?? p.angle}, re-rendering perspective and occlusion consistently. Keep identity, face, outfit, materials, colors, lighting and style. Do not add new objects, people or scenery.${note(p)}`;
    },
  },
  upscale: {
    id: 'upscale',
    label: 'Upscale',
    description: 'Increase resolution and recover fine detail.',
    input: 'image',
    output: 'image',
    engine: 'upscale',
    quick: true,
    fields: [{ key: 'factor', label: 'Scale', type: 'choice', default: '2', options: opt(['2', '2×'], ['4', '4×']) }],
    instruction: (p) => `Upscale this image ${p.factor}x. Only sharpen and recover fine texture and detail. Keep content, composition, colors, faces and any text exactly as they are; do not add, remove or reinterpret anything.`,
  },
  remove_bg: {
    id: 'remove_bg',
    label: 'Remove background',
    description: 'Cut out the subject on a transparent background.',
    input: 'image',
    output: 'image',
    engine: 'remove_bg',
    quick: true,
    fields: [],
    instruction: () => 'Remove the background completely and keep only the main subject on a transparent background with clean edges.',
  },
  reframe: {
    id: 'reframe',
    label: 'Reframe',
    description: 'Extend the scene to a new aspect ratio.',
    input: 'image',
    output: 'image',
    engine: 'edit',
    quick: false,
    fields: [
      {
        key: 'aspect',
        label: 'Format',
        type: 'choice',
        default: '16:9',
        options: opt(['1:1', '1:1'], ['4:5', '4:5'], ['3:4', '3:4'], ['2:3', '2:3'], ['9:16', '9:16'], ['16:9', '16:9'], ['3:2', '3:2'], ['21:9', '21:9']),
      },
      { key: 'note', label: 'Note', type: 'text', default: '', placeholder: 'What to reveal in the new area' },
    ],
    // Outpainting only: the original stays untouched and the margins continue what is already at the edges.
    instruction: (p) => {
      const n = typeof p.note === 'string' ? p.note.trim() : '';
      return [
        `Outpainting only: extend the canvas to a ${p.aspect} frame.`,
        'The original image stays exactly as it is, whole and centered: do not redraw, restyle, relight, move, resize or crop anything in it.',
        'Fill only the new margins by continuing what is already at its edges, with the same background, color, texture, level of detail, lighting and style. A plain or flat background continues as the same plain background.',
        n ? `In the new area, add only this: ${n}.` : 'Do not add anything that is not already there: no new objects, scenery, floor, ground, sky, horizon or extra detail.',
      ].join(' ');
    },
  },
  // Buzzy / Higgsfield: a multi-view sheet anchors an identity that repeats across steps. Always a 2×2 grid of equal
  // panels so Grid-split can turn it into separate reference views.
  reference_sheet: {
    id: 'reference_sheet',
    label: 'Reference sheet',
    description: 'A 2×2 reference sheet (turnaround, expressions or outfits) of a character, object or place, to keep it identical in later steps.',
    input: 'image',
    output: 'image',
    engine: 'edit',
    quick: false,
    fields: [
      { key: 'subject', label: 'Subject', type: 'choice', default: 'character', options: opt(['character', 'Character'], ['object', 'Object / product'], ['location', 'Place']) },
      { key: 'sheet', label: 'Sheet', type: 'choice', default: 'turnaround', options: opt(['turnaround', 'Turnaround'], ['expressions', 'Expressions'], ['outfits', 'Outfits']) },
      { key: 'aspect', label: 'Format', type: 'choice', default: '16:9', options: opt(['16:9', '16:9'], ['3:2', '3:2'], ['4:3', '4:3'], ['1:1', '1:1']) },
      { key: 'count', label: 'Candidates', type: 'choice', default: '1', options: opt(['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']) },
      { key: 'note', label: 'Note', type: 'text', default: '', placeholder: 'e.g. full body, sneakers' },
    ],
    instruction: (p) => `${sheetLayout(String(p.subject), String(p.sheet))} ${SHEET_RULES}${note(p)}`,
  },
  variations: {
    id: 'variations',
    label: 'Variations',
    description: 'New takes that keep subject and style.',
    input: 'image',
    output: 'image',
    engine: 'edit',
    quick: false,
    fields: [
      { key: 'strength', label: 'Change', type: 'choice', default: 'medium', options: opt(['subtle', 'Subtle'], ['medium', 'Medium'], ['strong', 'Strong']) },
      { key: 'count', label: 'Images', type: 'choice', default: '2', options: opt(['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']) },
    ],
    instruction: (p) => `Create a ${p.strength} variation of this image. Change only the composition, pose or details. Keep the same subject and identity, style and palette. Do not add new subjects, text or logos.`,
  },
  edit: {
    id: 'edit',
    label: 'Edit with prompt',
    description: 'Describe any change to apply.',
    input: 'image',
    output: 'image',
    engine: 'edit',
    quick: false,
    fields: [{ key: 'instruction', label: 'Change', type: 'text', default: '', placeholder: 'e.g. make the jacket red', required: true }],
    instruction: (p) => `Change only this: ${String(p.instruction).trim().replace(/\.$/, '')}. Keep everything else identical: subject and identity, composition and framing, lighting, colors and style. Do not add anything else.`,
  },
  animate: {
    id: 'animate',
    label: 'Animate',
    description: 'Turn the image into a video (image to video).',
    input: 'image',
    output: 'video',
    engine: 'video',
    quick: true,
    fields: [{ key: 'motion', label: 'Motion', type: 'text', default: '', placeholder: 'e.g. slow dolly in, hair moving in the wind' }],
    instruction: (p) => String(p.motion).trim() || 'Subtle natural motion with a slow cinematic camera push-in.',
  },
  extract_frame: {
    id: 'extract_frame',
    label: 'Extract frame',
    description: 'Save a frame as an image: first, last or at a given second (free).',
    input: 'video',
    output: 'image',
    engine: 'local',
    quick: true,
    fields: [
      { key: 'which', label: 'Frame', type: 'choice', default: 'last', options: opt(['first', 'First'], ['last', 'Last'], ['time', 'At second…']) },
      { key: 'seconds', label: 'Second', type: 'text', default: '', placeholder: 'At second… e.g. 2.5' },
    ],
  },
  continue: {
    id: 'continue',
    label: 'Continue shot',
    description: 'New clip that starts from the last frame.',
    input: 'video',
    output: 'video',
    engine: 'video',
    quick: true,
    fields: [{ key: 'motion', label: 'Next', type: 'text', default: '', placeholder: 'What happens next' }],
    instruction: (p) => String(p.motion).trim() || 'Continue the action naturally from this frame with consistent motion and camera.',
  },
  contact_sheet: {
    id: 'contact_sheet',
    label: 'Nine-grid',
    description: 'A 3×3 contact sheet: the same scene from nine camera angles.',
    input: 'image',
    output: 'image',
    engine: 'edit',
    quick: false,
    fields: [{ key: 'note', label: 'Note', type: 'text', default: '', placeholder: 'Optional detail, e.g. keep the rain' }],
    instruction: (p) =>
      `Create a 3×3 contact sheet: nine equal panels in a grid with thin gutters, each showing this exact scene from a different camera angle and shot size (wide, medium, close-up, low angle, high angle, over the shoulder, profile, top-down, detail). ${PRESERVE}${note(p)}`,
  },
  grid_split: {
    id: 'grid_split',
    label: 'Grid-split',
    description: 'Cut a grid image (like a nine-grid) into separate images (free).',
    input: 'image',
    output: 'image',
    engine: 'local',
    quick: false,
    fields: [{ key: 'grid', label: 'Grid', type: 'choice', default: '3', options: opt(['2', '2×2'], ['3', '3×3']) }],
  },
  join_clips: {
    id: 'join_clips',
    label: 'Join clips',
    description: 'Join clips in order into one video: input is the first clip, more the rest (free, on this computer).',
    input: 'video',
    output: 'video',
    engine: 'local',
    quick: false,
    multiInput: true,
    fields: [],
  },
  video_upscale: {
    id: 'video_upscale',
    label: 'Upscale video',
    description: 'Raise resolution and restore detail of a clip.',
    input: 'video',
    output: 'video',
    engine: 'video_upscale',
    quick: true,
    fields: [],
  },
  video_edit: {
    id: 'video_edit',
    label: 'Edit video',
    description: 'Describe a change to apply to the whole clip.',
    input: 'video',
    output: 'video',
    engine: 'video_edit',
    quick: false,
    fields: [{ key: 'instruction', label: 'Change', type: 'text', default: '', placeholder: 'e.g. make it night with neon reflections', required: true }],
    instruction: (p) => `${String(p.instruction).trim()}. Apply only this change; keep the same aspect ratio, framing (no crop or zoom), motion, timing and everything else identical.`,
  },
  video_extend: {
    id: 'video_extend',
    label: 'Extend video',
    description: 'Continue the clip from its last frame with new action.',
    input: 'video',
    output: 'video',
    engine: 'video_extend',
    quick: false,
    fields: [{ key: 'instruction', label: 'Then', type: 'text', default: '', placeholder: 'e.g. the camera pulls back as she walks into the rain', required: true }],
    instruction: (p) =>
      `Extend this video, continuing seamlessly from its last frame: ${String(p.instruction).trim()}. Keep the same aspect ratio, framing, characters, setting, style, lighting and camera language.`,
  },
  edit_region: {
    id: 'edit_region',
    label: 'Edit region',
    description: 'Change only the painted area of an image.',
    input: 'image',
    output: 'image',
    engine: 'inpaint',
    quick: false,
    viaSketch: true,
    fields: [{ key: 'instruction', label: 'Change', type: 'text', default: '', placeholder: 'e.g. a red umbrella', required: true }],
    instruction: (p) => `${String(p.instruction).trim()}. Change only the masked area and blend it seamlessly with the rest of the image.`,
  },
  remove_object: {
    id: 'remove_object',
    label: 'Remove object',
    description: 'Erase the painted object and fill in the background.',
    input: 'image',
    output: 'image',
    engine: 'remove_object',
    quick: false,
    viaSketch: true,
    fields: [],
    instruction: () => 'Remove the masked object completely and fill the area with the surrounding background, matching light, texture and perspective.',
  },
  create_voice: {
    id: 'create_voice',
    label: 'Create Kling voice',
    description: 'Make a reusable Kling voice from 5–30 s of clean speech (for subjects).',
    input: 'audio',
    output: 'text',
    engine: 'voice',
    quick: false,
    fields: [],
  },
  transcribe: {
    id: 'transcribe',
    label: 'Transcribe',
    description: 'Turn speech into text you can reuse as a prompt.',
    input: 'audio',
    output: 'text',
    engine: 'transcribe',
    quick: true,
    fields: [
      {
        key: 'language',
        label: 'Language',
        type: 'choice',
        default: 'auto',
        options: opt(['auto', 'Detect'], ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['pt', 'Portuguese'], ['it', 'Italian'], ['ja', 'Japanese'], ['zh', 'Chinese']),
      },
    ],
  },
};

const SHEET_RULES =
  'A 2×2 grid of four equal panels with thin white gutters, on a plain neutral grey background, even studio light, the same scale in every panel, no text, no labels, no props that are not part of the subject. Keep the identity, proportions (head size, build, height), hair length and style, colors, materials and every established detail exactly as in the source; do not stylize it differently. Characters are original and adults read as adults.';

/** The four panels of a reference sheet by subject and sheet type. */
export function sheetLayout(subject: string, sheet: string): string {
  if (sheet === 'expressions') return 'Reference sheet of this character: four head-and-shoulders panels with neutral, happy, angry and surprised expressions, same angle and lighting.';
  if (sheet === 'outfits') return `Reference sheet of this ${subject === 'character' ? 'character' : 'subject'}: four full panels, the same identity in four different outfits or finishes, same pose and angle.`;
  if (subject === 'location') return 'Reference sheet of this place: panel 1 establishing wide shot, panel 2 top-down plan view, panel 3 close detail of its main materials, panel 4 reverse angle.';
  if (subject === 'object' || subject === 'product') return 'Reference sheet of this object: panel 1 front, panel 2 side, panel 3 back, panel 4 top-down, centered and whole in each.';
  return 'Character turnaround reference sheet: panel 1 face close-up, panel 2 full-body front, panel 3 full-body profile, panel 4 full-body back, relaxed neutral pose.';
}

function note(p: Record<string, AdvancedValue>): string {
  const n = typeof p.note === 'string' ? p.note.trim() : '';
  // The source image is the identity: a note adds or changes only what it names.
  return n ? ` Additional direction (where it disagrees with the source image, the image wins unless this asks for a change): ${n}.` : '';
}

/** Operations offered in menus and nodes; mask operations start from Sketch. */
export function opsFor(kind: AssetKind): OpDef[] {
  return Object.values(OPS).filter((o) => o.input === kind && !o.viaSketch && !o.multiInput);
}

export function defaultOpParams(op: OpDef): Record<string, AdvancedValue> {
  return Object.fromEntries(op.fields.map((f) => [f.key, f.default]));
}

export function opCount(op: OpDef, params: Record<string, AdvancedValue>): number {
  if (op.id === 'variations' || op.id === 'reference_sheet') return Math.max(1, Math.min(4, Number(params.count) || 1));
  if (op.id === 'grid_split') return (Number(params.grid) || 3) ** 2;
  return 1;
}

export const OP_IDS = Object.keys(OPS) as OpId[];
/** What the agent may plan: it cannot draw masks. */
export const AGENT_OP_IDS = OP_IDS.filter((id) => !OPS[id].viaSketch);
