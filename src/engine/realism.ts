import { REALISM_POLICY } from './modelRules';
export type Realism = 'photographic' | 'ugc' | 'studio' | 'none';
export const REALISM_MODES: readonly Realism[] = ['photographic', 'ugc', 'studio', 'none'];

const CLAUSE: Record<Exclude<Realism, 'none'>, string> = {
  photographic: 'Photographic realism: believable natural light with slight imperfections, physical surface textures with fine natural detail, plausible lens optics and depth of field, restrained retouching that keeps skin and fabric texture.',
  ugc: 'Candid phone-camera realism: available light, mild exposure and white-balance imperfection, casual framing, natural skin texture and small real-world flaws, light sensor noise.',
  studio: 'Studio photographic realism: controlled soft key light with natural falloff, accurate materials and reflections, plausible lens optics, clean but restrained retouching that keeps real texture.',
};

// A prompt that asks for another medium is not photographic, unless it asks for a photoreal render of it.
const NOT_PHOTO = /\b(illustrat\w*|anime|manga|cartoon|comic|vector|pixel art|painting|watercolou?r|sketch|drawing|3d render|cgi|low[- ]poly|flat design|poster|logo|icon|sticker|typography|ilustraci\w+|dibujo|pintura|acuarela)\b/i;
const ASKS_PHOTO = /\b(photo-?real\w*|photograph\w*|photo)\b/i;
const HAS_PHOTO_VOCAB = /\b(\d+ ?mm|f\/\d|softbox|golden hour|bokeh|depth of field|dslr|35mm)/i;
const SHORT = 'Natural light, real textures, plausible lens, restrained retouching.';

/** Shot sheets: concrete camera, light and texture per kind of scene (no brands, no resolution or quality words). */
export const SHOTS: Record<string, { camera: string; light: string; texture: string; words?: RegExp }> = {
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
const SHOT_ORDER = ['pet', 'food', 'product', 'interior', 'landscape', 'portrait', 'street'];
const HAS_CAMERA = /\b\d+(-\d+)? ?mm\b|f\/\d/i;
const HAS_LIGHT = /\b(light|lit|softbox|window|flash|sun\w*|golden hour|daylight|lamp)\b/i;

/** The sheet for a prompt: the one the agent named, ugc / studio by mode, else the first whose words match. */
export function pickShot(prompt: string, mode: Realism, shot?: string): string | undefined {
  if (shot && SHOTS[shot]) return shot;
  if (mode === 'ugc' || mode === 'studio') return mode;
  return SHOT_ORDER.find((id) => SHOTS[id].words?.test(prompt));
}

/** The one place realism enters a prompt. Default photographic; nothing for 'none', another medium, a style reference, JSON or a prompt that is already photographic. */
export function withRealism(prompt: string, mode: Realism = 'photographic', modelId = '', shot?: string): string {
  const text = prompt.trim();
  if (!text || mode === 'none' || text.startsWith('{') || /= style reference only/.test(text)) return prompt;
  if (NOT_PHOTO.test(text) && !ASKS_PHOTO.test(text)) return prompt;
  const policy = REALISM_POLICY.find((x) => x.match.test(modelId))?.policy;
  if (policy === 'none') return prompt;
  const hasCamera = HAS_CAMERA.test(text);
  if (hasCamera || HAS_PHOTO_VOCAB.test(text)) {
    // Already photographic: add only the light that is missing (never a second camera).
    const s = SHOTS[pickShot(text, mode, shot) ?? 'studio'];
    return hasCamera && !HAS_LIGHT.test(text) && policy !== 'short' ? `${text} ${s.light}, ${s.texture}.` : prompt;
  }
  if (policy === 'short') return `${text} ${SHORT}`;
  const id = pickShot(text, mode, shot);
  if (!id) return `${text} ${CLAUSE[mode]}`;
  const s = SHOTS[id];
  return `${text} ${s.camera}, ${s.light}, ${s.texture}.`;
}

const REALISM_NEGATIVE = 'cartoon, illustration, painting, 3d render, airbrushed skin, plastic skin';
/** Fills the negative prompt when realism was applied and the model has that field, unless one is already set. */
export const negFor = <S extends { negative?: string }>(settings: S, applied: unknown): S => (applied && !settings.negative ? { ...settings, negative: REALISM_NEGATIVE } : settings);

/** Realism for a generation request: new images by default; edits of a source image only when set explicitly (the source's style rules). */
export function opRealism(g: { op?: unknown; settings: { realism?: Realism; shot?: string } }, kind: string, prompt: string, modelId = ''): string {
  if (kind !== 'image' || (g.op && !g.settings.realism)) return prompt;
  return withRealism(prompt, g.settings.realism, modelId, g.settings.shot);
}

export const withRealismSetting = <S extends object>(settings: S, kind: string, realism?: Realism, shot?: string): S => (kind === 'image' && (realism || shot) ? { ...settings, ...(realism ? { realism } : {}), ...(shot ? { shot } : {}) } : settings);
