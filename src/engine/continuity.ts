import type { ModelSchema, PlanContinuity, PlanStep, PlanSubject, Subject } from './types';

const promptTexts = (step: PlanStep) => step.kind === 'image' || step.kind === 'video' || step.kind === 'model3d' || step.kind === 'audio'
  ? [step.prompt, ...(step.kind === 'video' ? step.settings.shots?.map(s => s.prompt) ?? [] : [])]
  : [];
const mentioned = (step: PlanStep) => [...new Set(promptTexts(step).flatMap(p => [...p.matchAll(/(?<![\p{L}\p{N}._-])@([\p{L}\p{N}_-]{1,32})/gu)].map(m => m[1].toLowerCase())))];
const libraryRefs = (s: Subject) => [s.frontalAssetId, ...(s.refAssetIds ?? []), s.videoAssetId].filter((x): x is string => Boolean(x)).map(x => `asset:${x}`);
export const transportsNamedSubjects = (slots?: ModelSchema['slots']) => Boolean(slots?.elements?.max || (!slots?.keyframes && (slots?.images?.max || slots?.mixedRefs?.max)));

/** Actual content inputs only: scheduling and prompt text are not preservation sources. */
function inputs(step: PlanStep, subjects: PlanSubject[], library: Subject[], implicitSubjects: boolean): string[] {
  const own = step.kind === 'image' || step.kind === 'model3d' ? step.refs
    : step.kind === 'video' ? [step.firstFrame, step.lastFrame, ...(step.refs ?? [])].filter((x): x is string => Boolean(x))
    : step.kind === 'op' ? [step.input, ...(step.more ?? []), ...(typeof step.params.music === 'string' && step.params.music ? [step.params.music] : [])]
    : step.kind === 'layer' && step.source ? [step.source] : [];
  // Only image/video subject mentions are transported by the current subject contract.
  if (step.kind !== 'image' && step.kind !== 'video') return own;
  if (!implicitSubjects) return own;
  const names = new Set(mentioned(step));
  const localNames = new Set(subjects.map(s => s.name.toLowerCase()));
  return [...own, ...subjects.filter(s => names.has(s.name.toLowerCase())).map(s => s.from), ...library.filter(s => names.has(s.name.toLowerCase()) && !localNames.has(s.name.toLowerCase())).flatMap(s => s.frontalAssetId ? [`asset:${s.frontalAssetId}`] : [])];
}

export function continuityErrors(groups: PlanContinuity[], steps: PlanStep[], subjects: PlanSubject[] = [], library: Subject[] = [], transport?: ((step: PlanStep) => boolean) | Record<string, ModelSchema>): string[] {
  const canTransport = (step: PlanStep) => typeof transport === 'function' ? transport(step) : transport ? transportsNamedSubjects(transport['modelRef' in step ? step.modelRef : '']?.slots) : true;
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
      const result = inputs(step, subjects, library, canTransport(step)).some(r => connected(r, next));
      memo.set(key(ref), result);
      return result;
    };
    for (const id of group.steps) {
      const step = byId.get(id);
      if (!step) errors.push(`continuity: unknown consuming step "${id}".`);
      else if (key(id) === source || !inputs(step, subjects, library, canTransport(step)).some(r => connected(r, new Set([id])))) {
        errors.push(`continuity: ${id} must receive ${group.source} to preserve "${group.preserve}", directly or through a derived content input. Add the appropriate refs/input/first_frame; repeated text or scheduling is not a reference. If this is an intentional independent result or change, correct the declared scope instead.`);
      }
    }
  }
  return errors;
}

/** Agent proposals with a recurring named subject must declare all visual consumers of one actual source. */
export function recurringSubjectErrors(steps: PlanStep[], subjects: PlanSubject[], library: Subject[], groups: PlanContinuity[]): string[] {
  const consumers = new Map<string, Set<string>>();
  for (const step of steps) if (step.kind === 'image' || step.kind === 'video') {
    for (const name of mentioned(step)) {
      if (!subjects.some(s => s.name.toLowerCase() === name) && !library.some(s => s.name.toLowerCase() === name)) continue;
      const ids = consumers.get(name) ?? new Set<string>();
      ids.add(step.id);
      consumers.set(name, ids);
    }
  }
  const errors: string[] = [];
  for (const [name, ids] of consumers) {
    const local = subjects.find(s => s.name.toLowerCase() === name);
    const existing = library.find(s => s.name.toLowerCase() === name);
    const sources = local ? [local.from] : existing ? libraryRefs(existing) : [];
    if (!sources.length) {
      if (ids.size > 1) errors.push(`continuity: recurring @${name} needs an image or video source.`);
      continue;
    }
    const consumers = new Set(ids);
    for (const source of sources) {
      const sourceId = source.replace(/#1$/, '');
      const sourceStep = steps.find(s => s.id === sourceId)?.id;
      if (sourceStep) consumers.delete(sourceStep);
    }
    if (consumers.size < 2) continue;
    const matches = sources.map(source => ({ source, groups: groups.filter(g => g.source.replace(/#1$/, '') === source.replace(/#1$/, '')) }));
    if (matches.some(({ groups: matching }) => {
      const covered = new Set(matching.flatMap(g => g.steps));
      return [...consumers].every(id => covered.has(id));
    })) continue;
    const partial = matches.find(({ groups: matching }) => matching.length);
    const missing = partial ? [...consumers].filter(id => !new Set(partial.groups.flatMap(g => g.steps)).has(id)) : [];
    const source = partial?.source ?? sources[0];
    errors.push(partial
      ? `continuity: @${name} must list every consuming step for ${source}; add ${missing.join(', ')} to its continuity steps.`
      : `continuity: @${name} is used by ${[...consumers].join(', ')}; declare one actual source (${sources.join(' or ')}), preserved identity, and all consuming steps.`);
  }
  return errors;
}

export function exposeShotSubjects(prompt: string, shots: Array<{ prompt: string; duration: number }> | undefined, max: number): string {
  const names = [...new Set((shots ?? []).filter(s => s.prompt.trim() && s.duration >= 1).slice(0, max).flatMap(s => [...s.prompt.matchAll(/(?<![\p{L}\p{N}._-])@([\p{L}\p{N}_-]{1,32})/gu)].map(m => m[1])))];
  const missing = names.filter(name => !new RegExp(`(?<![\\p{L}\\p{N}._-])@${name}(?![\\p{L}\\p{N}_-])`, 'iu').test(prompt));
  return missing.length ? `${prompt}\n\nReferences used in shots: ${missing.map(name => `@${name}`).join(', ')}` : prompt;
}

export function applyPlanStyle(step: PlanStep, style: string): void {
  const apply = (prompt: string) => prompt.includes(style) ? prompt : `${prompt}\n\nStyle: ${style}`;
  if (step.kind !== 'image' && step.kind !== 'video') return;
  step.prompt = apply(step.prompt);
  if (step.kind === 'video' && step.settings.shots) step.settings.shots = step.settings.shots.map(shot => ({ ...shot, prompt: apply(shot.prompt) }));
}
