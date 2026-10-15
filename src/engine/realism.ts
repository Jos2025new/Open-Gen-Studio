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

/** The one place realism enters a prompt. Default photographic; nothing for 'none', another medium, a style reference, JSON or a prompt that is already photographic. */
export function withRealism(prompt: string, mode: Realism = 'photographic', modelId = ''): string {
  const text = prompt.trim();
  if (!text || mode === 'none' || text.startsWith('{') || /= style reference only/.test(text) || HAS_PHOTO_VOCAB.test(text)) return prompt;
  if (NOT_PHOTO.test(text) && !ASKS_PHOTO.test(text)) return prompt;
  const policy = REALISM_POLICY.find((x) => x.match.test(modelId))?.policy;
  if (policy === 'none') return prompt;
  return `${text} ${policy === 'short' ? SHORT : CLAUSE[mode]}`;
}

/** Realism for a generation request: new images by default; edits of a source image only when set explicitly (the source's style rules). */
export function opRealism(g: { op?: unknown; settings: { realism?: Realism } }, kind: string, prompt: string, modelId = ''): string {
  if (kind !== 'image' || (g.op && !g.settings.realism)) return prompt;
  return withRealism(prompt, g.settings.realism, modelId);
}

export const withRealismSetting = <S extends object>(settings: S, kind: string, realism?: Realism): S => (realism && kind === 'image' ? { ...settings, realism } : settings);
