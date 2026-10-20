/*
 * The number the user confirmed on the card is the number of candidates of an image step. Whether a step takes it:
 * - one image step: always (its variations are checked against it by the normalizer);
 * - several image steps: each one that does not write its own count (a count the agent writes, e.g. "3 of her" or a
 *   reference sheet, wins). Without a confirmed card (direct generation) the composer's count applies instead.
 */
export function countFollowsCard(steps: Array<{ kind?: string }>, step: { count?: number; variations?: unknown[] }): boolean {
  if (Array.isArray(step.variations) && step.variations.length > 1) return false;
  return steps.filter((x) => x.kind === 'image').length === 1 || step.count == null;
}
