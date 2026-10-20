import { lineKey } from './variants';
import { userNamed } from './modelNaming';
import type { PlanContext } from './plan';

/**
 * Whether the plan's model is another model line than the confirmed one AND the user named it in the current request
 * (ctx.requestText: this turn and its answers, never the whole history). Then the user's words win over the card.
 */
export async function namedOverConfirmed(ctx: PlanContext, written: string, confirmedRef: string): Promise<boolean> {
  if (!ctx.requestText) return false;
  const [found, conf] = await Promise.all([ctx.getModel(written), ctx.getModel(confirmedRef)]);
  if (!found || !conf || lineKey(found.model) === lineKey(conf.model)) return false;
  return userNamed([found.model.name, written], ctx.requestText());
}
