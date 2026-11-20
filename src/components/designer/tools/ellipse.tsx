import { EllipseToolFields } from '../ShapeKindFields';
import { shapeTool } from './shape';

export const ellipse = shapeTool('ellipse', {
  trace(path, _drag, _style, { x, y, w, h }) {
    path.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  },
  fields: () => <EllipseToolFields tool="ellipse" />,
});
