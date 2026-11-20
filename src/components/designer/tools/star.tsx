import { CornerToolFields } from '../ShapeKindFields';
import { shapeTool } from './shape';

export const star = shapeTool('star', {
  fields: () => <CornerToolFields tool="star" />,
});
