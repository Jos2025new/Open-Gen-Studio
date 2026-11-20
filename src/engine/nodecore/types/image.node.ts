import { generationNode, PROMPT } from '../generation';

export default generationNode('image', {
  inputs: [
    PROMPT,
    { id: 'ref', type: 'image', label: 'References', multi: true },
    // Clip models (Nano Banana 2 reference-to-image): a trimmed reference video.
    { id: 'clip', type: 'video', label: 'Video clip', multi: true },
  ],
  output: 'image',
});
