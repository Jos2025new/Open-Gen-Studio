import type { NodeDescriptor, NodeKindId } from './descriptor';

/** Auto-collected like the commands of ADR 0030: a file in `types/` is a type; there is no list to keep. */
const files = import.meta.glob<{ default: NodeDescriptor }>('./types/*.node.ts', { eager: true });

/** The one place a file becomes a type: the glob below feeds it, and a test feeds it a file of its own. */
export function collect(modules: Record<string, { default: NodeDescriptor }>): Map<NodeKindId, NodeDescriptor> {
  const out = new Map<NodeKindId, NodeDescriptor>();
  for (const [file, mod] of Object.entries(modules)) {
    const d = mod.default;
    if (out.has(d.kind)) throw new Error(`${file}: node type "${d.kind}" is already declared; one descriptor per type.`);
    out.set(d.kind, d);
  }
  return out;
}
const byKind = collect(files);

export const descriptorOf = (kind: NodeKindId): NodeDescriptor | undefined => byKind.get(kind);
export const descriptors = (): NodeDescriptor[] => [...byKind.values()];
