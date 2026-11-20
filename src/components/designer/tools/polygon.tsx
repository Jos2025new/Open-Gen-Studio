import { CornerToolFields } from '../ShapeKindFields';
import { shapeTool } from './shape';

export const polygon = shapeTool('polygon', {
  fields: () => <CornerToolFields tool="polygon" />,
});
