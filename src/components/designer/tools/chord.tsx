import { EllipseToolFields } from '../ShapeKindFields';
import { shapeTool } from './shape';

export const chord = shapeTool('chord', {
  fields: () => <EllipseToolFields tool="chord" />,
});
