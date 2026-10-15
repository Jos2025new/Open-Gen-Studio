import { refMentionStyle } from './params';

export const REF_ROLES = ['identity', 'pose', 'style', 'lighting', 'clothing', 'expression', 'background'] as const;
export type RefRole = typeof REF_ROLES[number];
/** A ref in a plan: the plain id, or the id with the role the image plays. */
export type RefSpec = string | { ref: string; role?: RefRole; note?: string };
export interface RoleRef { ref: string; role: RefRole; note?: string }

const PHRASE: Record<RefRole, string> = {
  identity: 'identity: keep face and body',
  pose: 'pose reference only: do not copy its identity or background',
  style: 'style reference only: do not copy its subject or content',
  lighting: 'lighting reference only: match its light, do not copy its content',
  clothing: 'clothing reference only: take the garments, do not copy its person or background',
  expression: 'expression reference only: take the facial expression, do not copy its identity',
  background: 'background reference only: use the setting, do not copy its people or objects',
};

export const refId = (r: RefSpec): string => (typeof r === 'string' ? r : r.ref);

/** Plain ids plus the refs that carry a role; problems for roles that cannot be applied. */
export function splitRefs(refs: RefSpec[] | undefined): { ids: string[]; roles: RoleRef[]; problems: string[] } {
  const ids: string[] = [];
  const roles: RoleRef[] = [];
  const problems: string[] = [];
  for (const r of refs ?? []) {
    if (typeof r === 'string') { ids.push(r); continue; }
    if (!r?.ref?.trim()) { problems.push(`a ref with role "${r?.role ?? ''}" has no "ref".`); continue; }
    if (r.role && !(REF_ROLES as readonly string[]).includes(r.role)) { problems.push(`unknown role "${r.role}". Use ${REF_ROLES.join(', ')}.`); continue; }
    ids.push(r.ref);
    if (r.role) roles.push({ ref: r.ref, role: r.role, note: r.note?.trim() || undefined });
  }
  return { ids, roles, problems };
}

/** "Image 1 = identity: keep face and body. Image 2 = pose reference only: …", in the model's mention syntax. */
export function rolesPhrase(modelId: string, orderedImages: string[], roles: RoleRef[], promptRefs?: string): string {
  const style = refMentionStyle(modelId, promptRefs);
  const name = (i: number) => (style ? style.template.replace('{n}', String(i + (style.zeroBased ? 0 : 1))) : `Image ${i + 1}`);
  return roles
    .map((r) => ({ r, i: orderedImages.indexOf(r.ref) }))
    .filter((x) => x.i >= 0)
    .sort((a, b) => a.i - b.i)
    .map(({ r, i }) => `${name(i)} = ${PHRASE[r.role]}${r.note ? ` (${r.note.replace(/[.\s]+$/, '')})` : ''}.`)
    .join(' ');
}

/** The roles an edit op takes for its extra images; the first is the default. */
export const OP_REF_ROLES: Partial<Record<string, RefRole[]>> = {
  edit: ['pose', 'expression', 'clothing'],
  relight: ['lighting'],
  replace_background: ['background'],
};

/** "Image 2 = lighting reference only…" for the extra images of an edit op (the source is Image 1). */
export function opRolesLine(params: Record<string, unknown>, source: string, modelRef: string, schema?: { slots: { promptRefs?: string } }): string {
  const raw = params._refRoles;
  if (typeof raw !== 'string' || !raw) return '';
  const got = JSON.parse(raw) as Array<{ asset: string; role: RefRole; note?: string }>;
  const line = rolesPhrase(modelRef, [source, ...got.map((g) => g.asset)], got.map((g) => ({ ref: g.asset, role: g.role, note: g.note })), schema?.slots.promptRefs);
  return line ? `${line} ` : '';
}

/** Op-step refs: ids with their role (default = the op's first role); problems for roles the op does not take. */
export function opRefList(opId: string, ids: string[], roles: RoleRef[]): { refs: Array<{ ref: string; role: RefRole; note?: string }>; problems: string[] } {
  const allowed = OP_REF_ROLES[opId];
  if (!allowed) return { refs: [], problems: [`op "${opId}" takes no refs.`] };
  const problems: string[] = [];
  const refs = ids.map((ref) => {
    const found = roles.find((r) => r.ref === ref);
    const role = found?.role ?? allowed[0];
    if (!allowed.includes(role)) problems.push(`op "${opId}" takes refs with role ${allowed.join(' or ')}, not "${role}".`);
    return { ref, role, note: found?.note };
  });
  return { refs, problems };
}

/** Refs written as { ref, role } become plain ids on the raw steps; returns the roles per step id. */
export function normalizeStepRefs(steps: Array<{ id?: string; refs?: RefSpec[] }>, errors: string[]): Map<string, RoleRef[]> {
  const byStep = new Map<string, RoleRef[]>();
  for (const s of steps) {
    if (!s.refs?.some((r) => typeof r !== 'string')) continue;
    const { ids, roles, problems } = splitRefs(s.refs);
    errors.push(...problems.map((m) => `Step ${s.id}: ${m}`));
    s.refs = ids;
    byStep.set(s.id!, roles);
  }
  return byStep;
}

/** The role sentence of a media step, with its trailing space ('' without roles); a role on a ref that is not an image is an error. */
export function stepRolesLine(roles: RoleRef[] | undefined, images: string[], modelId: string, promptRefs: string | undefined, where: string, errors: string[]): string {
  for (const r of roles ?? []) if (!images.includes(r.ref)) errors.push(`${where}: role "${r.role}" is on "${r.ref}", which is not an image in refs.`);
  return roles?.length ? `${rolesPhrase(modelId, images, roles, promptRefs)} ` : '';
}

/** The refs of an op step, checked: only edit ops take them, with their roles, and they must be images. */
export function opStepRefs(engine: string, opId: string, ids: string[], roles: RoleRef[] | undefined, where: string, errors: string[], kindOf: (ref: string, where: string) => string | null | undefined): Array<{ ref: string; role: RefRole; note?: string }> {
  const got = engine === 'edit' ? opRefList(opId, ids, roles ?? []) : { refs: [], problems: [`op "${opId}" takes no refs.`] };
  errors.push(...got.problems.map((m) => `${where}: ${m}`));
  for (const r of got.refs) if (!['image', 'raster', undefined, null].includes(kindOf(r.ref, where))) errors.push(`${where}: ref "${r.ref}" must be an image.`);
  return got.refs;
}
