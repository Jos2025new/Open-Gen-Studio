import { LineToolFields } from '../ShapeKindFields';
import { shapeTool } from './shape';

export const arrow = shapeTool('arrow', {
  strokeOnly: true,
  fill: false,
  customPath: 'arrow',
  fields: () => <LineToolFields tool="arrow" />,
});
