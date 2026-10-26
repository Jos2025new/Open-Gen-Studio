import type { ModelSchema, ModelSummary } from './types';

/*
 * The model maker's own sheet (docs/features/agente-auto-tarjeta.md, "Fichas oficiales"): what a model takes per call,
 * from its official documentation. A provider's own figure always wins; the sheet stands in where the provider does not
 * declare one (the max was assumed), and adds rules no schema declares, such as references + results per call.
 * Every figure carries the official page it comes from; third-party hosts do not count.
 */

export interface OfficialSheet {
  model: string;
  kind: 'image' | 'video';
  /** Matches provider ids and names of this model. */
  match: RegExp;
  /** Reference or input images per call. */
  refsMax?: number;
  /** Reference images + generated images per call. */
  totalMax?: number;
  source: string;
}

const BYTEPLUS = 'https://docs.byteplus.com/en/docs/modelark/1541523';

/**
 * Checked 2026-10-25 against each maker's page. More specific entries first (the first match wins). Where the provider's
 * id does not say the variant (Seedream 5 without Lite), the lower official figure applies. Left out: Recraft and
 * Ideogram (limits differ per variant or are not stated), Z-Image (text only), StepFun (retired 2026-10-10).
 */
export const OFFICIAL_SHEETS: OfficialSheet[] = [
  { model: 'Seedream 5.0 Lite', kind: 'image', match: /seedream[-_ ./]*v?5([._-]?0)?[-_ ./]*lite/i, refsMax: 14, totalMax: 15, source: BYTEPLUS },
  { model: 'Seedream 5.0 (Pro, Flash)', kind: 'image', match: /seedream[-_ ./]*v?5/i, refsMax: 10, totalMax: 15, source: BYTEPLUS },
  { model: 'Seedream 4.x', kind: 'image', match: /seedream[-_ ./]*v?4/i, refsMax: 14, totalMax: 15, source: BYTEPLUS },
  { model: 'Nano Banana 2 / Pro', kind: 'image', match: /nano[-_ ]?banana[-_ ]?(2|pro)|gemini[-_ .]?3([._-]?1)?[-_ ](pro|flash)[-_ ]image/i, refsMax: 14, source: 'https://ai.google.dev/gemini-api/docs/image-generation' },
  { model: 'GPT Image', kind: 'image', match: /gpt[-_ .]?image/i, refsMax: 16, source: 'https://developers.openai.com/api/reference/resources/images/methods/edit' },
  { model: 'FLUX 3 Image', kind: 'image', match: /flux[-_ .]?3/i, refsMax: 10, source: 'https://docs.bfl.ml/flux_3/flux3_image_layout.md' },
  { model: 'Qwen Image 3.0', kind: 'image', match: /qwen[-_ ]?image[-_ .]?3/i, refsMax: 3, source: 'https://www.alibabacloud.com/help/en/model-studio/qwen-image-generation-and-editing-api-reference' },
  { model: 'Qwen Image 2.1', kind: 'image', match: /qwen[-_ ]?image[-_ .]?2[._-]?1/i, refsMax: 10, source: 'https://www.alibabacloud.com/help/en/model-studio/qwen-image-generation-and-editing-api-reference' },
  { model: 'Grok Imagine Image', kind: 'image', match: /grok[-_ ]?imagine[-_ ]?image/i, refsMax: 5, source: 'https://docs.x.ai/docs/guides/image-generations' },
  { model: 'P-Image-Edit', kind: 'image', match: /p-image[-_ ]?edit/i, refsMax: 5, source: 'https://docs.pruna.ai/en/stable/docs_pruna_endpoints/performance_models/p-image-edit.html' },
];

export function officialSheet(m: Pick<ModelSummary, 'id' | 'name' | 'kind'>): OfficialSheet | undefined {
  return OFFICIAL_SHEETS.find((s) => s.kind === m.kind && (s.match.test(m.id) || s.match.test(m.name)));
}

/** The schema with the official sheet filled in where the provider is silent; unchanged when there is no sheet. */
export function withOfficialLimits(schema: ModelSchema, model: Pick<ModelSummary, 'id' | 'name' | 'kind'>): ModelSchema {
  const sheet = officialSheet(model);
  const img = schema.slots.images;
  if (!sheet || !img) return schema;
  const official = img.from === 'assumed' && img.multiple && sheet.refsMax != null;
  if (!official && !sheet.totalMax) return schema;
  const images = { ...img, ...(official ? { max: sheet.refsMax!, from: 'official' as const } : {}), ...(sheet.totalMax ? { total: sheet.totalMax } : {}) };
  return { ...schema, slots: { ...schema.slots, images } };
}

/** How many reference images fit next to `count` results: the max, and the per-call budget when the sheet has one. */
export function refsCap(slot: { max: number; total?: number } | undefined, count = 1): number {
  if (!slot) return 0;
  return slot.total ? Math.min(slot.max, Math.max(0, slot.total - count)) : slot.max;
}
