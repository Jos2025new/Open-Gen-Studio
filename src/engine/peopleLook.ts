import type { Settings } from '../store/store';

/**
 * The look of people the user does not describe (2026-10-18). Many image and video models trained in China
 * (Seedream, Seedance, Wan, Kling, MiniMax, Z-Image, Qwen, Hunyuan) render an unspecified "young woman" as East Asian;
 * the user asked for Western people unless they say otherwise. Editable in Settings → Agent.
 */
export const DEFAULT_PEOPLE_LOOK = 'Western: European or Latin American, varied; East Asian only when the user asks';

export const LOOK_RULE =
  'Look: every person a prompt creates gets a visible look (skin tone, hair, facial features or origin) from the user\'s words, else the "default look for people" line; never leave it unstated, many models (Seedream, Seedance, Wan, Kling, MiniMax, Z-Image, Qwen) turn an unspecified person East Asian. A reference or start image that shows the person sets their look: cite it, do not describe or change it.';

/** The look from Settings, or the default when empty. */
export function peopleLook(settings: Pick<Settings, 'peopleLook'>): string {
  return settings.peopleLook?.trim() || DEFAULT_PEOPLE_LOOK;
}

/** Context line the rule points to. */
export function peopleLookLine(settings: Pick<Settings, 'peopleLook'>): string {
  return `default look for people the user does not describe: ${peopleLook(settings)}`;
}
