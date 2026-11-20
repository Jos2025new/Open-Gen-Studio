import { shapeLabel } from '../delivery';
import { modelSummary } from '../catalog';
import { PROVIDER_LABELS, shownProvider } from '../providers/types';
import { lineKey, variantRoute } from '../variants';
import type { Asset, Generation } from '../types';

/**
 * What the closing message tells the agent about one finished step: the model and provider that really ran, whether
 * that is the confirmed choice (only the same provider counts: another one is a change it must hear), the size or
 * length that came out and the notes the app wrote on the generation (a credit switch).
 */
export function ranFacts(gen: Generation | undefined, confirmed: Array<{ modelRef: string } | undefined>, first: Asset | undefined): string[] {
  const ran = gen?.modelRef;
  const ranProvider = gen ? shownProvider(gen) : undefined;
  const ranSummary = ran ? modelSummary(ran) : undefined;
  const sameLine = confirmed.filter((c): c is { modelRef: string } => Boolean(c) && c!.modelRef !== ran && Boolean(ranSummary) && Boolean(modelSummary(c!.modelRef)) && lineKey(modelSummary(c!.modelRef)!) === lineKey(ranSummary!));
  const conf = sameLine.find((c) => modelSummary(c.modelRef)!.provider === ranProvider);
  const moved = conf ? undefined : sameLine[0];
  const at = ranProvider && ranProvider !== 'local' ? ` at ${PROVIDER_LABELS[ranProvider]}` : '';
  const made = ran
    ? `made with ${ranSummary?.name ?? ran}${at}${conf ? ` (the ${variantRoute(ranSummary!)} variant of the confirmed ${modelSummary(conf.modelRef)!.name}: the same model, not a change)` : ''}${moved ? ` (NOT the confirmed provider: ${modelSummary(moved.modelRef)!.name} was confirmed at ${PROVIDER_LABELS[modelSummary(moved.modelRef)!.provider]})` : ''}`
    : '';
  return [made, first?.width && first.height ? `${shapeLabel(first.width, first.height)}, ${first.width}×${first.height}` : '', first?.duration ? `${Math.round(first.duration)}s` : '', ...(gen?.notes ?? [])].filter(Boolean);
}
