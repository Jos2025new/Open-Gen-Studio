import { EllipseToolFields } from '../ShapeKindFields';
import { shapeTool } from './shape';

export const arc = shapeTool('arc', {
  strokeOnly: true,
  fields: () => <EllipseToolFields tool="arc" />,
});
