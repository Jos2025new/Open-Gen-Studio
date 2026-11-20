import { runFill } from '../StageSample';
import { FillSettings } from '../FillSettings';
import type { ToolDescriptor } from './types';

export const fill = {
  down: ({ state: { sessionId }, current, p, e }) => runFill(sessionId, current, p, e),
  quick: ['threshold', 'fillGap', 'fillSource', 'colorPair'],
  settings: FillSettings,
  contextTarget: () => 'new layer',
} satisfies ToolDescriptor;
