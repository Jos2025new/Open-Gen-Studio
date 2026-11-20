import { describe, expect, it } from 'vitest';
import { inputPorts, outputPort } from '../src/engine/flow/graph';
import { OPS } from '../src/engine/ops';
import type { Asset, GraphNodeData, PortType } from '../src/engine/types';

/* Equivalence oracle: the per-kind `switch` that lived in flow/graph.ts before the ports moved into the descriptors. */
type P = { id: string; type: PortType; label: string; multi: boolean };
const gen = (id: string, type: PortType, label: string, multi: boolean): P => ({ id, type, label, multi });
function legacyOutput(data: GraphNodeData, assets: Record<string, Asset>): PortType | null {
  switch (data.kind) {
    case 'text': return 'text';
    case 'image': return 'image';
    case 'model3d': return 'model3d';
    case 'video': return 'video';
    case 'audio': return data.textOutput ? 'text' : 'audio';
    case 'tool': return OPS[data.op].output;
    case 'asset': return data.assetId ? assets[data.assetId]?.kind ?? null : null;
    case 'ref':
      if (data.type === 'chat' || data.type === 'agent' || data.type === 'prompt') return 'text';
      if (data.type === 'designer.doc' || data.type === 'space' || data.type === 'library') return 'image';
      return null;
  }
  return null;
}
function legacyInputs(data: GraphNodeData): P[] {
  const prompt = gen('prompt', 'text', 'Prompt', false);
  switch (data.kind) {
    case 'image': return [prompt, gen('ref', 'image', 'References', true), gen('clip', 'video', 'Video clip', true)];
    case 'model3d': return [prompt, gen('ref', 'image', 'Reference images', true)];
    case 'video': return [prompt, gen('first', 'image', 'First frame', false), gen('last', 'image', 'Last frame', false), gen('ref', 'image', 'References / keyframes', true), gen('refVideo', 'video', 'Reference videos', true), gen('audio', 'audio', 'Audio', true)];
    case 'audio': return [prompt, gen('lyrics', 'text', 'Lyrics', false)];
    case 'tool': return [gen('input', OPS[data.op].input, 'Input', false)];
    default: return [];
  }
}

const SYSTEM = ['chat', 'agent', 'provider', 'model', 'session', 'space', 'designer.doc', 'library', 'toolset', 'prompt', 'mediaSettings'];
const assets = { a1: { id: 'a1', kind: 'video' }, a2: { id: 'a2', kind: 'image' } } as unknown as Record<string, Asset>;
const fixtures = (): GraphNodeData[] => [
  { kind: 'text', title: 't', text: 'x' },
  { kind: 'asset', title: 'a', assetId: null },
  { kind: 'asset', title: 'a', assetId: 'a1' },
  { kind: 'asset', title: 'a', assetId: 'a2' },
  { kind: 'asset', title: 'a', assetId: 'missing' },
  ...(['image', 'video', 'model3d', 'audio'] as const).flatMap((kind) => [{ kind, title: 'g', prompt: '' }, { kind, title: 'g', prompt: '', textOutput: true }]),
  ...Object.keys(OPS).map((op) => ({ kind: 'tool', title: 't', op, params: {} })),
  ...SYSTEM.map((type) => ({ kind: 'ref', type, ref: 'r', title: 'r' })),
] as unknown as GraphNodeData[];

describe('ports in the descriptors equal the former central switch', () => {
  it('input ports and output type match for every kind, op and system type', () => {
    for (const d of fixtures()) {
      const label = `${d.kind}/${'op' in d ? d.op : 'type' in d ? d.type : ''}`;
      expect(inputPorts(d), label).toEqual(legacyInputs(d));
      expect(outputPort(d, assets), label).toEqual(legacyOutput(d, assets));
    }
  });
});
