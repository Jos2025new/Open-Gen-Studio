/** Conservative bound on reachable SVG expansion before invoking a browser rasterizer. */
export function unsafeUseExpansion(root: Element, limit = 8192): boolean {
  const elements = [root, ...Array.from(root.getElementsByTagName('*'))];
  if (!elements.some((el) => el.localName.toLowerCase() === 'use')) return false;
  const ids = new Map<string, Element>();
  for (const el of elements) if (el.id && !ids.has(el.id)) ids.set(el.id, el);
  const memo = new Map<Element, number>(), active = new Set<Element>();
  const resources = new Set(['defs', 'symbol', 'mask', 'filter', 'clippath', 'marker', 'pattern', 'lineargradient', 'radialgradient']);
  const count = (el: Element, referenced: boolean, depth: number): number => {
    const cached = referenced ? memo.get(el) : undefined;
    if (cached !== undefined) return cached;
    if (depth > 128 || active.has(el)) return limit + 1;
    active.add(el);
    const tag = el.localName.toLowerCase();
    let total = referenced || tag === 'use' ? 1 : 0;
    const refs: string[] = [];
    const href = (el.getAttribute('href') ?? el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? '').trim();
    if (href.startsWith('#')) refs.push(href.slice(1));
    for (const attr of Array.from(el.attributes)) for (const match of attr.value.matchAll(/url\(\s*['"]?#([^\s'")]+)['"]?\s*\)/gi)) refs.push(match[1]);
    if (tag === 'style') for (const match of (el.textContent ?? '').matchAll(/url\(\s*['"]?#([^\s'")]+)['"]?\s*\)/gi)) refs.push(match[1]);
    for (const id of refs) {
      const target = ids.get(id);
      if (target) total += count(target, true, depth + 1);
      if (total > limit) break;
    }
    if (total <= limit) for (const child of Array.from(el.children)) {
      if (!referenced && resources.has(child.localName.toLowerCase())) continue;
      total += count(child, referenced, depth + 1);
      if (total > limit) break;
    }
    active.delete(el);
    if (referenced) memo.set(el, Math.min(total, limit + 1));
    return total;
  };
  return count(root, false, 0) > limit;
}
