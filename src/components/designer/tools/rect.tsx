import { cornerRadii, traceRoundRect } from '../../../engine/design/shapeLook';
import { shapeTool } from './shape';

export const rect = shapeTool('rect', {
  corners: true,
  trace(path, _drag, style, box) {
    const r = cornerRadii({ ...style, w: box.w, h: box.h });
    traceRoundRect(path, box, r.rx, r.ry);
  },
});
