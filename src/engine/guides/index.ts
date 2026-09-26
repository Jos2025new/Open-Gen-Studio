import seedance from './seedance.md?raw';

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

export const MODEL_GUIDES: ModelGuide[] = [{ id: 'seedance', name: 'Seedance 2.0 / 2.5', match: /seedance/i, text: seedance }];

export function modelGuide(id: string): ModelGuide | undefined {
  return MODEL_GUIDES.find((g) => g.id === id);
}

export function guideForModel(modelId: string): ModelGuide | undefined {
  return MODEL_GUIDES.find((g) => g.match.test(modelId));
}
