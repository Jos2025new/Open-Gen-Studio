import { RulerSettings } from '../StrokeRulerOverlay';
import type { ToolDescriptor } from './types';

export const ruler = {
  placeStrokeRuler: true,
  quick: ['rulerSnap', 'rulerClear'],
  settings: ({ doc }) => <RulerSettings docId={doc.id} />,
} satisfies ToolDescriptor;
