import { placeGuide, removeGuide } from '../../../engine/design/guides';
import { RULER } from '../stageTheme';
import type { GestureMap } from './types';

export const guideGestures = {
  guide: {
    skipReleaseGuides: true,
    move({ state: { setGuidePreview }, d, p }) {
      d.at = d.axis === 'x' ? p.x : p.y;
      setGuidePreview({ axis: d.axis, index: d.index, at: d.at });
    },
    up({ state, d, e }) {
      const { sessionId, doc, view, toDoc, setGuidePreview } = state;
      // A quick drag may send no move before release.
      if (e) { const p = toDoc(e.clientX, e.clientY); d.at = d.axis === 'x' ? p.x : p.y; }
      state.showGuides({});
      setGuidePreview(null);
      // Dropped back on its ruler: a new guide is not made, an existing one is removed.
      const onRuler = (d.axis === 'x' ? view.x + d.at * view.zoom : view.y + d.at * view.zoom) < RULER;
      if (onRuler) { if (d.index != null) removeGuide(sessionId, doc.id, d.axis, d.index); }
      else placeGuide(sessionId, doc.id, d.axis, d.at, d.index);
    },
  },
} satisfies Partial<GestureMap>;
