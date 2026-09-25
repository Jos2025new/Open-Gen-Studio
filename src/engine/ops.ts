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
      return `Relight this image with ${light} coming from the ${p.direction}, ${p.intensity} intensity. Adapt shadows, highlights and color temperature consistently. ${PRESERVE}${note(p)}`;
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
      return `Show the exact same subject and scene from ${names[String(p.angle)] ?? p.angle}. Re-render perspective and occlusion consistently; keep identity, outfit, materials, lighting and style.${note(p)}`;
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
    instruction: (p) => `Upscale this image ${p.factor}x. Recover fine texture and sharp detail without changing content, colors or composition.`,
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
    instruction: (p) => `Extend this scene naturally to fill a ${p.aspect} frame (outpainting). Keep the original content intact and centered; continue the environment, lighting and style seamlessly.${note(p)}`,
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
    instruction: (p) => `Create a ${p.strength} variation of this image: same subject, style and palette, with a different composition, pose or details.`,
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
    instruction: (p) => `${String(p.instruction).trim()}. Apply only this change; keep everything else identical.`,
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
    instruction: (p) => `${String(p.instruction).trim()}. Apply only this change; keep motion, timing, framing and everything else identical.`,
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
      `Extend this video, continuing seamlessly from its last frame: ${String(p.instruction).trim()}. Keep the same characters, setting, style, lighting and camera language.`,
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

function note(p: Record<string, AdvancedValue>): string {
  const n = typeof p.note === 'string' ? p.note.trim() : '';
  return n ? ` Additional direction: ${n}.` : '';
}

/** Operations offered in menus and nodes; mask operations start from Sketch. */
export function opsFor(kind: AssetKind): OpDef[] {
  return Object.values(OPS).filter((o) => o.input === kind && !o.viaSketch);
}

export function defaultOpParams(op: OpDef): Record<string, AdvancedValue> {
  return Object.fromEntries(op.fields.map((f) => [f.key, f.default]));
}

export function opCount(op: OpDef, params: Record<string, AdvancedValue>): number {
  if (op.id === 'variations') return Math.max(1, Math.min(4, Number(params.count) || 1));
  if (op.id === 'grid_split') return (Number(params.grid) || 3) ** 2;
  return 1;
}

export const OP_IDS = Object.keys(OPS) as OpId[];
/** What the agent may plan: it cannot draw masks. */
export const AGENT_OP_IDS = OP_IDS.filter((id) => !OPS[id].viaSketch);
