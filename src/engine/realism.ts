export type Realism = 'photographic' | 'ugc' | 'studio' | 'none';
export const REALISM_MODES: readonly Realism[] = ['photographic', 'ugc', 'studio', 'none'];

const CLAUSE: Record<Exclude<Realism, 'none'>, string> = {
  photographic: 'Photographic realism: believable natural light with slight imperfections, physical surface textures with fine natural detail, plausible lens optics and depth of field, restrained retouching that keeps skin and fabric texture.',
  ugc: 'Candid phone-camera realism: available light, mild exposure and white-balance imperfection, casual framing, natural skin texture and small real-world flaws, light sensor noise.',
  studio: 'Studio photographic realism: controlled soft key light with natural falloff, accurate materials and reflections, plausible lens optics, clean but restrained retouching that keeps real texture.',
};

// A prompt that asks for another medium is not photographic.
const NOT_PHOTO = /\b(illustrat\w*|anime|manga|cartoon|comic|vector|pixel art|painting|watercolou?r|sketch|drawing|3d render|cgi|low[- ]poly|flat design|ilustraci\w+|dibujo|pintura|acuarela)\b/i;

/** The one place realism enters a prompt: default photographic; 'none' or another medium leaves the prompt alone. */
export function withRealism(prompt: string, mode: Realism = 'photographic'): string {
  const text = prompt.trim();
  if (!text || mode === 'none' || NOT_PHOTO.test(text)) return prompt;
  return `${text} ${CLAUSE[mode]}`;
}

/** Image generations get realism by default; edits of a source image only when realism is set explicitly (the source's style rules). */
export function opRealism(g: { op?: unknown; settings: { realism?: Realism } }, kind: string, prompt: string): string {
  if (kind !== 'image' || (g.op && !g.settings.realism)) return prompt;
  return withRealism(prompt, g.settings.realism);
}

export const withRealismSetting = <S extends object>(settings: S, kind: string, realism?: Realism): S => (realism && kind === 'image' ? { ...settings, realism } : settings);
