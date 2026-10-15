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
