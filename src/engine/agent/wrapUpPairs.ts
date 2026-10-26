import { useStore } from '../../store/store';
import { parseRef } from '../plan';
import type { LlmContentPart, PlanFeedItem } from '../types';
import { attachmentParts } from './attachments';

const MAX_PAIRS = 3;

/**
 * The wrap-up after an edit plan: for each op step on an existing image (edits run as ops, ADR 0009; an image step with
 * a reference is a new picture, not an edit) that produced one image, the original then the result, each labelled, with the change that was asked. Anything ambiguous or not
 * showable is left out; empty when the plan edited nothing.
 */
export async function editPairParts(item: PlanFeedItem): Promise<LlmContentPart[]> {
  const assets = useStore.getState().assets;
  const parts: LlmContentPart[] = [];
  let pairs = 0;
  for (const st of item.plan.steps) {
    if (pairs >= MAX_PAIRS) break;
    const source = st.kind === 'op' ? parseRef(st.input) : null;
    const out = item.stepOutputs?.[st.id]?.assetIds ?? [];
    if (source?.type !== 'asset' || out.length !== 1 || assets[source.id]?.kind !== 'image' || assets[out[0]]?.kind !== 'image') continue;
    const asked = ((st.kind === 'op' && st.note) || st.title).slice(0, 200);
    const original = await attachmentParts([source.id]);
    const result = await attachmentParts([out[0]]);
    if (![original, result].every((p) => p.some((x) => x.type === 'image_url'))) continue;
    parts.push({ type: 'text', text: `Edit ${st.id}, change asked: "${asked}". ORIGINAL (asset:${source.id}):` }, ...original, { type: 'text', text: `RESULT (asset:${out[0]}):` }, ...result);
    pairs++;
  }
  return parts;
}

/** Replaces the factual wrap-up rule when the pairs are attached: the agent has seen the result and can check it. */
export const WRAPUP_COMPARE_RULE =
  'MUST reply in at most 3 short sentences. Original and result images are attached: compare them and say whether the asked change happened and any visible defect; describe only differences you can see; if a detail cannot be checked at this size, say so instead of assuming. Name the model as the summary’s "made with" says, in your own words (never its notation or ids); say something differs from what was asked in size or shape only when the summary says "delivered differs". Then offer 1-2 next steps or leaving it as is. Text only: no tools, no new plan.';
