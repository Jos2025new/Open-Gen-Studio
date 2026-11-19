import type { NodeDescriptor, NodeKindId } from './descriptor';

/** Auto-collected like the commands of ADR 0030: a file in `types/` is a type; there is no list to keep. */
const files = import.meta.glob<{ default: NodeDescriptor }>('./types/*.node.ts', { eager: true });

const byKind = new Map<NodeKindId, NodeDescriptor>();
for (const [file, mod] of Object.entries(files)) {
  const d = mod.default;
  if (byKind.has(d.kind)) throw new Error(`${file}: node type "${d.kind}" is already declared; one descriptor per type.`);
  byKind.set(d.kind, d);
}

export const descriptorOf = (kind: NodeKindId): NodeDescriptor | undefined => byKind.get(kind);
export const descriptors = (): NodeDescriptor[] => [...byKind.values()];
