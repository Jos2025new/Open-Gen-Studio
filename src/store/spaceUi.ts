import type { UiState } from './store';
import type { AdvancedValue, OpId } from '../engine/types';

/** One-use input for Tools; never part of pickUi's persisted projection. */
export interface ToolSeed {
  generationId: string;
  assetId: string;
  parentId?: string;
  op: OpId;
  params: Record<string, AdvancedValue>;
  modelRef?: string;
}

/** The two viewers are exclusive; a Tools seed lives only while that Space is open. */
export function finishSpaceUi(ui: UiState, before: UiState): void {
  if (ui.space !== 'tools') ui.toolSeed = undefined;
  if (ui.textView && ui.textView !== before.textView) ui.lightbox = null;
  else if (ui.lightbox && ui.lightbox !== before.lightbox) ui.textView = null;
}
