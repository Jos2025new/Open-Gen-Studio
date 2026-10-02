import seedance from './seedance.md?raw';
import wan from './wan.md?raw';
import minimax from './minimax.md?raw';
import grok from './grok.md?raw';
import happyhorse from './happyhorse.md?raw';
import veo from './veo.md?raw';
import flux from './flux.md?raw';
import kling from './kling.md?raw';
import videoEdit from './video-edit.md?raw';
import nanoBanana from './nano-banana.md?raw';
import gptImage from './gpt-image.md?raw';
import seedream from './seedream.md?raw';
import ideogram from './ideogram.md?raw';
import krea from './krea.md?raw';
import zImage from './z-image.md?raw';
import pImage from './p-image.md?raw';
import stepImage from './step-image.md?raw';

/*
 * Prompting guides per model family: how to write for that model (style), next to the schema the app already
 * reads (inputs, limits). Listed in the agent's index as "model:<id>" and loaded with read_guide only when a
 * step uses that family, once per conversation (the result stays in the history).
 */
export interface ModelGuide {
  id: string;
  name: string;
  /** Model ids this guide covers. */
  match: RegExp;
  text: string;
  /** Image guides: loaded only when the image is demanding (text, layout, several references, a complex edit). */
  optional?: boolean;
}

export const MODEL_GUIDES: ModelGuide[] = [
  // General, for any model doing an edit or extend (video_edit / video_extend ops); matched by no model id.
  { id: 'video-edit', name: 'video edit and extend (any model)', match: /$^/, text: videoEdit },
  { id: 'seedance', name: 'Seedance 2.0 / 2.5', match: /seedance/i, text: seedance },
  { id: 'wan', name: 'Wan 3.0 / Wan 3.0 Prime', match: /wan-3/i, text: wan },
  { id: 'minimax', name: 'MiniMax H3 (all tiers)', match: /minimax[-/]h3/i, text: minimax },
  { id: 'grok', name: 'Grok Imagine Video (v1 and 1.5)', match: /grok-imagine-video/i, text: grok },
  { id: 'happyhorse', name: 'HappyHorse 1.0 / 1.1', match: /happy-?horse/i, text: happyhorse },
  { id: 'kling', name: 'Kling 3.0 (std, pro, 4K, turbo)', match: /kling-v3\.0|kling-video\/v3\/|kling-v30/i, text: kling },
  { id: 'flux', name: 'FLUX 3 Video and Video Edit', match: /flux-3(?!-action)|flux3/i, text: flux },
  { id: 'veo', name: 'Veo 3.1 (standard, Fast, Lite)', match: /veo[-_ .]?3[-_ .]?1|veo3[.-]1/i, text: veo },
  { id: 'nano-banana', name: 'Nano Banana (2, Lite, Pro) images', match: /nano-?banana/i, text: nanoBanana, optional: true },
  { id: 'gpt-image', name: 'GPT Image (1.5, 2, 2.5) images', match: /gpt-?image/i, text: gptImage, optional: true },
  { id: 'seedream', name: 'Seedream (4.x, 5.0 Lite / Pro) images', match: /seedream/i, text: seedream, optional: true },
  { id: 'ideogram', name: 'Ideogram V4 images', match: /ideogram/i, text: ideogram, optional: true },
  { id: 'krea', name: 'Krea 2 images', match: /krea/i, text: krea, optional: true },
  { id: 'z-image', name: 'Z-Image images', match: /z-?image/i, text: zImage, optional: true },
  { id: 'p-image', name: 'P-Image images', match: /(^|[/_.-])p-image|prunaai/i, text: pImage, optional: true },
  { id: 'step-image', name: 'Step Image Edit images', match: /step-?image|step1x/i, text: stepImage, optional: true },
];

export function modelGuide(id: string): ModelGuide | undefined {
  return MODEL_GUIDES.find((g) => g.id === id);
}

export function guideForModel(modelId: string): ModelGuide | undefined {
  return MODEL_GUIDES.find((g) => g.match.test(modelId));
}
