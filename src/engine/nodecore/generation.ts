import { inputPorts, outputPort } from '../flow/graph';
import { defineNode, type NodeDescriptor } from './descriptor';
import { evaluateNode } from './evaluate';

/** The shared descriptor of the four generation kinds: they differ in ports (graph.ts inputPorts), not in contract. */
export function generationNode(kind: 'image' | 'video' | 'audio' | 'model3d'): NodeDescriptor {
  return defineNode({
    kind,
    version: 1,
    params: ['title', 'prompt', 'modelRef', 'settings', 'outputIndex', 'subjects', 'textOutput'],
    inputs: inputPorts,
    output: outputPort,
    required: [],
    affects: { prompt: true, ref: true, clip: true, first: true, last: true, refVideo: true, audio: true, lyrics: true },
    evaluate: evaluateNode,
    actions: ['generate'],
  });
}
