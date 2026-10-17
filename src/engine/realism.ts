import { REALISM_POLICY } from './modelRules';
/** Registers: balanced (default: natural, neither ad-polished nor degraded), everyday (phone / real footage), cinematic (polished lens-and-light sheets; 'photographic' is its old name). */
export type Realism = 'balanced' | 'everyday' | 'cinematic' | 'photographic' | 'ugc' | 'studio' | 'none';
export const REALISM_MODES: readonly Realism[] = ['balanced', 'everyday', 'cinematic', 'photographic', 'ugc', 'studio', 'none'];
type Register = 'balanced' | 'everyday' | 'cinematic' | 'ugc' | 'studio';
const register = (m: Realism): Register => (m === 'photographic' ? 'cinematic' : (m as Register));

const CLAUSE: { cinematic: string } = {
  cinematic: 'Photographic realism: believable natural light with slight imperfections, physical surface textures with fine natural detail, plausible lens optics and depth of field, restrained retouching that keeps skin and fabric texture.',
};

// A prompt that asks for another medium is not photographic, unless it asks for a photoreal render of it.
const NOT_PHOTO = /\b(illustrat\w*|anime|manga|cartoon|comic|vector|pixel art|painting|watercolou?r|sketch|drawing|3d render|cgi|low[- ]poly|flat design|poster|logo|icon|sticker|typography|ilustraci\w+|dibujo|pintura|acuarela)\b/i;
const ASKS_PHOTO = /\b(photo-?real\w*|photograph\w*|photo)\b/i;
const HAS_PHOTO_VOCAB = /\b(\d+ ?mm|f\/\d|softbox|golden hour|bokeh|depth of field|dslr|35mm)/i;
const SHORT = 'Natural light, real textures, plausible lens, restrained retouching.';

/** Shot sheets: concrete camera, light and texture per kind of scene (no brands, no resolution or quality words). */
export const SHOTS: Record<string, { camera: string; light: string; texture: string; mild?: string; words?: RegExp }> = {
  balanced: { camera: '35 mm at f/4, moderate depth of field, natural perspective', light: 'available or motivated soft light', texture: 'natural skin and material texture with small real-world flaws, restrained retouching, no oversharpening' },
  everyday: { camera: 'Phone camera, wide lens, deep focus, casual framing', light: 'available light with slight exposure and white-balance imperfection', texture: 'small-sensor noise, mild computational HDR look, natural skin and surfaces with small real-world flaws', mild: 'very light sensor noise, natural skin and surfaces, identity and details unchanged' },
  ugc: { camera: 'Main phone camera, slightly tilted casual framing', light: 'ambient light or direct flash', texture: 'natural skin, mild sensor noise' },
  studio: { camera: '85 mm at f/8, seamless backdrop', light: 'controlled soft key light with natural falloff', texture: 'accurate materials and reflections' },
  portrait: { camera: '85 mm at f/1.8, shallow depth of field', light: 'soft light from a side window', texture: 'unretouched skin with visible pores', words: /\b(portrait|woman|man|girl|boy|person|face|model|retrato|mujer|hombre|chic[ao])\b/i },
  pet: { camera: '70-200 mm at f/2.8, fast shutter, eye in sharp focus', light: 'natural daylight', texture: 'fine fur detail', words: /\b(dog|cat|puppy|kitten|pet|horse|bird|perro|gato|running|jumping)\b/i },
  food: { camera: '50 mm macro at f/4', light: 'soft side window light', texture: 'natural steam, crumbs and glossy highlights', words: /\b(food|dish|meal|burger|pizza|coffee|cake|salad|plate|comida|plato)\b/i },
  product: { camera: '100 mm macro at f/8', light: 'soft overhead softbox', texture: 'true materials with fine surface texture and a subtle contact shadow', words: /\b(product|bottle|packaging|mug|cup|watch|shoe|perfume|jar|producto|botella)\b/i },
  interior: { camera: '24 mm at f/8, straight verticals', light: 'window daylight balanced with warm lamps', texture: 'real material textures', words: /\b(interior|room|kitchen|living room|bedroom|architecture|building|facade|habitaci\w+|cocina|edificio)\b/i },
  landscape: { camera: '24 mm at f/8', light: 'natural light at the hour of the scene', texture: 'atmospheric haze, fine foliage and rock detail', words: /\b(landscape|mountain|forest|beach|sunset|valley|lake|desert|paisaje|monta\w+|playa)\b/i },
  street: { camera: '35 mm at f/2, candid framing', light: 'available light', texture: 'Portra 400 film look with natural grain', words: /\b(street|city|market|crowd|cafe|urban|documentary|calle|ciudad|mercado)\b/i },
};
/** Video sheets per register: camera, motion, light, texture, cadence (+ audio). Studio uses the cinematic one. */
const VIDEO_SHOTS: Record<'balanced' | 'everyday' | 'cinematic', { camera: string; motion: string; light: string; texture: string; cadence: string; audio?: string; mild?: string }> = {
  balanced: { camera: '35 mm lens, moderate depth of field, locked-off or light handheld', motion: 'slow motivated camera, no gimbal-perfect glides', light: 'available or motivated soft light', texture: 'natural skin and material texture, restrained retouching, natural motion blur', cadence: '24 fps' },
  everyday: { camera: 'Phone camera, wide lens, deep focus, casual framing, subtle handheld micro-shake', motion: 'small reframing drift, imperfect timing, no smooth glides', light: 'available light with slight auto-exposure and white-balance shifts', texture: 'small-sensor noise, mild computational HDR look, light video compression', cadence: '30 fps phone cadence', audio: 'room tone and phone-mic sound', mild: 'very light sensor noise, identity and details unchanged' },
  cinematic: { camera: '35 mm cinema lens, shallow depth of field', motion: 'slow motivated camera move', light: 'motivated cinematic lighting', texture: 'fine film grain, 180-degree shutter motion blur', cadence: '24 fps' },
};
const HAS_VCAM = /\b(handheld|tripod|dolly|gimbal|steadicam|\d+ ?fps)\b/i;
const SHOT_ORDER = ['pet', 'food', 'product', 'interior', 'landscape', 'portrait', 'street'];
const HAS_CAMERA = /\b\d+(-\d+)? ?mm\b|f\/\d/i;
const HAS_LIGHT = /\b(light|lit|softbox|window|flash|sun\w*|golden hour|daylight|lamp)\b/i;

/** The sheet for a prompt: the one the agent named (scene sheets only in cinematic; ugc / studio anywhere), the register's own, else the first whose words match. */
export function pickShot(prompt: string, mode: Realism, shot?: string): string | undefined {
  const reg = register(mode);
  if (shot && SHOTS[shot] && (reg === 'cinematic' || shot === 'ugc' || shot === 'studio')) return shot;
  if (reg !== 'cinematic') return reg;
  return SHOT_ORDER.find((id) => SHOTS[id].words?.test(prompt));
}

export interface RealismCtx {
  kind?: 'image' | 'video';
  /** Video starts from an image: the look comes from it, so only motion, cadence and audio are added. */
  anchored?: boolean;
  /** Identity references: noise and blur stay mild. */
  refs?: boolean;
}

/** The one place realism enters a prompt. Default balanced; nothing for 'none', another medium, a style reference, JSON or a prompt that is already photographic. */
export function withRealism(prompt: string, mode: Realism = 'balanced', modelId = '', shot?: string, ctx: RealismCtx = {}): string {
  const text = prompt.trim();
  if (!text || mode === 'none' || text.startsWith('{') || /= style reference only/.test(text)) return prompt;
  if (NOT_PHOTO.test(text) && !ASKS_PHOTO.test(text)) return prompt;
  const policy = REALISM_POLICY.find((x) => x.match.test(modelId))?.policy;
  if (policy === 'none') return prompt;
  const reg = register(mode);
  const hasCamera = HAS_CAMERA.test(text);
  if (ctx.kind === 'video') {
    if (hasCamera || HAS_PHOTO_VOCAB.test(text) || HAS_VCAM.test(text)) return prompt;
    const v = VIDEO_SHOTS[reg === 'balanced' || reg === 'everyday' ? reg : reg === 'ugc' ? 'everyday' : 'cinematic'];
    const parts = ctx.anchored ? [v.motion, v.cadence, v.audio] : [v.camera, v.motion, v.light, ctx.refs && v.mild ? v.mild : v.texture, v.cadence, v.audio];
    return `${text} ${parts.filter(Boolean).join(', ')}.`;
  }
  if (hasCamera || HAS_PHOTO_VOCAB.test(text)) {
    // Already photographic: add only the light that is missing (never a second camera).
    const s = SHOTS[pickShot(text, mode, shot) ?? 'studio'];
    return hasCamera && !HAS_LIGHT.test(text) && policy !== 'short' ? `${text} ${s.light}, ${s.texture}.` : prompt;
  }
  if (policy === 'short') return `${text} ${SHORT}`;
  const id = pickShot(text, mode, shot);
  if (!id) return `${text} ${CLAUSE.cinematic}`;
  const s = SHOTS[id];
  return `${text} ${s.camera}, ${s.light}, ${ctx.refs && s.mild ? s.mild : s.texture}.`;
}

const REALISM_NEGATIVE = 'cartoon, illustration, painting, 3d render, airbrushed skin, plastic skin';
/** Fills the negative prompt when realism was applied and the model has that field, unless one is already set. */
export const negFor = <S extends { negative?: string }>(settings: S, applied: unknown): S => (applied && !settings.negative ? { ...settings, negative: REALISM_NEGATIVE } : settings);

/** Realism for a generation request: new images and videos by default; edits of a source only when set explicitly (the source's style rules). */
export function opRealism(g: { op?: unknown; settings: { realism?: Realism; shot?: string }; inputs?: { refs?: unknown[]; firstFrame?: unknown } }, kind: string, prompt: string, modelId = ''): string {
  if ((kind !== 'image' && kind !== 'video') || (g.op && !g.settings.realism)) return prompt;
  return withRealism(prompt, g.settings.realism, modelId, g.settings.shot, { kind, anchored: kind === 'video' && Boolean(g.inputs?.firstFrame), refs: Boolean(g.inputs?.refs?.length) });
}

export const withRealismSetting = <S extends object>(settings: S, kind: string, realism?: Realism, shot?: string): S => ((kind === 'image' || kind === 'video') && (realism || shot) ? { ...settings, ...(realism ? { realism } : {}), ...(shot ? { shot } : {}) } : settings);
