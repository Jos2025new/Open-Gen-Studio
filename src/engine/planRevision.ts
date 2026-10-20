import type { RawPlan } from './plan';
import type { Plan, PlanContinuity } from './types';

/*
 * A revision changes only what was asked: the plan's style and continuity (shared preservation) are part of the plan
 * even when the agent does not repeat them. What the agent omits is copied from the plan being revised; what it
 * writes wins. The notes go to `raw.carried` (the normalizer starts its adjustments with them), so the agent reads
 * them in the approval result and in the next comment ("keep this in mind for revisions").
 */

/** The plan the user commented on, if still waiting. */
function revisedPlan(session: { feed: Array<{ id: string; type: string }>; agent: { revising?: string } }): Plan | undefined {
  const item = session.feed.find((f) => f.id === session.agent.revising) as { type: string; status?: string; plan?: Plan } | undefined;
  return item?.type === 'plan' && item.status === 'awaiting' ? item.plan : undefined;
}

/** Fills the style and continuity a revision left out from the plan it replaces; returns what it did. */
export function carryOverRevision(raw: RawPlan, session: Parameters<typeof revisedPlan>[0]): string[] {
  const prev = revisedPlan(session);
  const notes: string[] = [];
  if (!prev) return notes;
  if (raw.style == null && prev.style) {
    raw.style = prev.style;
    notes.push(`You omitted the style; the previous one was kept: ${prev.style}`);
  }
  if (raw.continuity == null && prev.continuity?.length) {
    const ids = new Set((raw.steps ?? []).map((s) => s.id));
    const kept: PlanContinuity[] = [];
    let dropped = 0;
    for (const g of prev.continuity) {
      const steps = g.steps.filter((id) => ids.has(id));
      // A source that was a step of the old plan must still exist; assets and layers always do.
      const sourceGone = !/^(asset|layer):/.test(g.source) && !ids.has(g.source.split('#')[0]);
      if (sourceGone || !steps.length) dropped++;
      else kept.push({ ...g, steps });
    }
    if (kept.length) raw.continuity = kept;
    if (kept.length || dropped) notes.push(`You omitted the continuity; the previous one was kept for ${kept.length} group${kept.length === 1 ? '' : 's'}${dropped ? ` (${dropped} dropped because ${dropped === 1 ? 'its' : 'their'} steps were removed)` : ''}`);
  }
  raw.carried = notes;
  return notes;
}
