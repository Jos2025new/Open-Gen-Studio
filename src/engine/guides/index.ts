import seedance from './seedance.md?raw';
import wan from './wan.md?raw';
import minimax from './minimax.md?raw';
import grok from './grok.md?raw';
import happyhorse from './happyhorse.md?raw';

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
}

export const MODEL_GUIDES: ModelGuide[] = [
  { id: 'seedance', name: 'Seedance 2.0 / 2.5', match: /seedance/i, text: seedance },
  { id: 'wan', name: 'Wan 3.0 / Wan 3.0 Prime', match: /wan-3/i, text: wan },
  { id: 'minimax', name: 'MiniMax H3 (all tiers)', match: /minimax[-/]h3/i, text: minimax },
  { id: 'grok', name: 'Grok Imagine Video (v1 and 1.5)', match: /grok-imagine-video/i, text: grok },
  { id: 'happyhorse', name: 'HappyHorse 1.0 / 1.1', match: /happy-?horse/i, text: happyhorse },
];

export function modelGuide(id: string): ModelGuide | undefined {
  return MODEL_GUIDES.find((g) => g.id === id);
}

export function guideForModel(modelId: string): ModelGuide | undefined {
  return MODEL_GUIDES.find((g) => g.match.test(modelId));
}
