import { LineToolFields } from '../ShapeKindFields';
import { shapeTool } from './shape';

export const line = shapeTool('line', {
  trace(path, { x0, y0, x1, y1 }) {
    path.moveTo(x0, y0);
    path.lineTo(x1, y1);
  },
  strokeOnly: true,
  fill: false,
  fields: () => <LineToolFields tool="line" />,
});
