import { generationNode, PROMPT } from '../generation';

export default generationNode('video', {
  inputs: [
    PROMPT,
    { id: 'first', type: 'image', label: 'First frame', multi: false },
    { id: 'last', type: 'image', label: 'Last frame', multi: false },
    // Reference-to-video models take these as references; keyframe models pin them in order.
    { id: 'ref', type: 'image', label: 'References / keyframes', multi: true },
    { id: 'refVideo', type: 'video', label: 'Reference videos', multi: true },
    // Lip-sync speech, a soundtrack or reference audio, as the model takes it.
    { id: 'audio', type: 'audio', label: 'Audio', multi: true },
  ],
  output: 'video',
});
