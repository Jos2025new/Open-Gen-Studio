export interface ParsedRef {
  type: 'step' | 'asset' | 'layer';
  id: string;
  index: number;
}

export function parseRef(ref: string): ParsedRef | null {
  const r = ref.trim();
  if (r.startsWith('asset:')) return { type: 'asset', id: r.slice(6), index: 0 };
  if (r.startsWith('layer:')) return { type: 'layer', id: r.slice(6), index: 0 };
  const m = /^([A-Za-z][\w-]*)(?:#(\d+))?$/.exec(r);
  if (!m) return null;
  return { type: 'step', id: m[1], index: m[2] ? Math.max(0, Number(m[2]) - 1) : 0 };
}
