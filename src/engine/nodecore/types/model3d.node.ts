import { generationNode, PROMPT } from '../generation';

export default generationNode('model3d', {
  inputs: [PROMPT, { id: 'ref', type: 'image', label: 'Reference images', multi: true }],
  output: 'model3d',
});
