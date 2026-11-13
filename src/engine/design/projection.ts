import type { DepthOrder, ObjectDepth } from '../objectMeta';

/*
 * The one place where depth becomes what is seen (docs/propuesta-objetos-y-profundidad.md, section 2): every renderer,
 * hit test and export takes its objects through here, so a camera, parallax or a depth sort change this file only.
 * Today it is the identity: `z` is 0 by default and the order is the list's, so everything looks as before.
 */
export function project<T extends ObjectDepth>(items: readonly T[], order: DepthOrder = 'list'): readonly T[] {
  // 'depth' and 'mixed' will sort by z here; no geometry is projected yet.
  void order;
  return items;
}
