import { selectIdle, selectMove, selectPress, selectUp } from '../StageSelect';
import { eventMods } from '../../../engine/design/modifierGate';
import type { GestureMap, PointerPress, ToolDescriptor } from './types';
import { SelectOps } from '../ToolSettingsFields';

function beginSelection({ state, current, p, e }: PointerPress) {
  const { drag, selectShape, view, setSelDraft } = state;
  drag.current = selectPress({ doc: current, p, shape: selectShape, mods: eventMods(e), zoom: view.zoom }, setSelDraft);
}
const gestures = {
  select: {
    move({ state: { setSelDraft, view }, d, p, e }) {
      setSelDraft(selectMove(d, p, view.zoom, eventMods(e)));
    },
    up({ state: { sessionId, doc, selDraft, view, setSelDraft }, d }) {
      selectUp(d, { sessionId, doc, draft: selDraft, zoom: view.zoom });
      setSelDraft(null);
    },
  },
} satisfies Partial<GestureMap>;

export const select = {
  down: beginSelection,
  hover: ({ state: { setSelDraft }, p, e }) => selectIdle(p, eventMods(e), setSelDraft),
  gestures,
  quick: ['selectMode', 'wandTolerance', 'wandExpand', 'selectOps', 'selectActions'],
  settings: SelectOps,
  bareSettings: true,
  hideSelectionChip: true,
  contextTarget: (layer) => layer?.name ?? null,
} satisfies ToolDescriptor;
