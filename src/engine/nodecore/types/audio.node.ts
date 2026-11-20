import { generationNode, PROMPT } from '../generation';

export default generationNode('audio', {
  inputs: [
    PROMPT,
    // Song lyrics: a text node, a lyrics node or a transcription.
    { id: 'lyrics', type: 'text', label: 'Lyrics', multi: false },
  ],
  // A song can come out as its transcription: then it is text.
  output: (textOutput) => (textOutput ? 'text' : 'audio'),
});
