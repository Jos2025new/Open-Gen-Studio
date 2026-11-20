import type { PortType } from '../types';
import { defineNode, type NodeDescriptor, type PortInfo } from './descriptor';
import { deliverGenerated } from './deliver';

const PROMPT: PortInfo = { id: 'prompt', type: 'text', label: 'Prompt', multi: false };

/** The shared descriptor of the four generation kinds: they differ in ports and output, not in contract. */
export function generationNode(kind: 'image' | 'video' | 'audio' | 'model3d', ports: { inputs: PortInfo[]; output: PortType | ((textOutput?: boolean) => PortType) }): NodeDescriptor {
  return defineNode({
    kind,
    version: 1,
    params: ['title', 'prompt', 'modelRef', 'settings', 'outputIndex', 'subjects', 'textOutput'],
    inputs: () => ports.inputs.map((p) => ({ ...p })),
    output: (data) => (typeof ports.output === 'function' ? ports.output('textOutput' in data ? data.textOutput : undefined) : ports.output),
    required: [],
    affects: { prompt: true, ref: true, clip: true, first: true, last: true, refVideo: true, audio: true, lyrics: true },
    evaluate: deliverGenerated,
    actions: ['generate'],
  });
}
export { PROMPT };
