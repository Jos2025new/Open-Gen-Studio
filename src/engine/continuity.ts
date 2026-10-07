import type { PlanContinuity, PlanStep, PlanSubject } from './types';

/** Actual content inputs only: scheduling and prompt text are not preservation sources. */
function inputs(step: PlanStep, subjects: PlanSubject[]): string[] {
  const own = step.kind === 'image' || step.kind === 'model3d' ? step.refs
    : step.kind === 'video' ? [step.firstFrame, step.lastFrame, ...(step.refs ?? [])].filter((x): x is string => Boolean(x))
    : step.kind === 'op' ? [step.input, ...(step.more ?? []), ...(typeof step.params.music === 'string' && step.params.music ? [step.params.music] : [])]
    : step.kind === 'layer' && step.source ? [step.source] : [];
  // Only image/video subject mentions are transported by the current subject contract.
  if (step.kind !== 'image' && step.kind !== 'video') return own;
  const names = new Set([...step.prompt.matchAll(/(?<![\p{L}\p{N}._-])@([\p{L}\p{N}_-]{1,32})/gu)].map(m => m[1].toLowerCase()));
  return [...own, ...subjects.filter(s => names.has(s.name.toLowerCase())).map(s => s.from)];
}

export function continuityErrors(groups: PlanContinuity[], steps: PlanStep[], subjects: PlanSubject[] = []): string[] {
  const byId = new Map(steps.map(s => [s.id, s]));
  const key = (ref: string) => ref.replace(/#1$/, '');
  const errors: string[] = [];
  for (const group of groups) {
    const source = key(group.source);
    const memo = new Map<string, boolean>();
    const connected = (ref: string, visited: Set<string>): boolean => {
      if (key(ref) === source) return true;
      if (memo.has(key(ref))) return memo.get(key(ref))!;
      const id = ref.split('#')[0];
      if (id === source.split('#')[0] || visited.has(id)) return false;
      const step = byId.get(id);
      if (!step) return false;
      const next = new Set(visited).add(id);
      const result = inputs(step, subjects).some(r => connected(r, next));
      memo.set(key(ref), result);
      return result;
    };
    for (const id of group.steps) {
      const step = byId.get(id);
      if (!step) errors.push(`continuity: unknown consuming step "${id}".`);
      else if (key(id) === source || !inputs(step, subjects).some(r => connected(r, new Set([id])))) {
        errors.push(`continuity: ${id} must receive ${group.source} to preserve "${group.preserve}", directly or through a derived content input. Add the appropriate refs/input/first_frame; repeated text or scheduling is not a reference. If this is an intentional independent result or change, correct the declared scope instead.`);
      }
    }
  }
  return errors;
}
