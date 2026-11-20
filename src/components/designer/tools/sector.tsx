import { EllipseToolFields } from '../ShapeKindFields';
import { shapeTool } from './shape';

export const sector = shapeTool('sector', {
  fields: () => <EllipseToolFields tool="sector" />,
});
