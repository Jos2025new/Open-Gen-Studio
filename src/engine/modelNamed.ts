import { lineKey } from './variants';
import { userNamed } from './modelNaming';
import type { PlanContext } from './plan';
import type { MediaKind } from './types';

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

/** After a switch, a request that names no model must first ask whether to continue with the switched one; undefined when it need not. */
export async function followUpProblem(ctx: PlanContext, confirmedRef: string, kind: MediaKind): Promise<string | undefined> {
  const to = ctx.switchedTo?.(kind);
  const [sw, conf] = to ? await Promise.all([ctx.getModel(to.modelRef), ctx.getModel(confirmedRef)]) : [];
  if (!to || !sw || !conf || userNamed([conf.model.name], ctx.requestText?.() ?? '')) return undefined;
  return `The user switched ${kind} to ${sw.model.name} (${to.modelRef}) last time and has not said whether to continue with it; call confirm_settings for ${kind} with model ${to.modelRef} first (the app asks: continue with ${sw.model.name} or go back to ${conf.model.name}).`;
}
