import type { Layer, LayerGroup } from '../types';
import type { RememberedExport } from './exportSettings';

export interface DesignDoc {
  id: string;
  name: string;
  width: number;
  height: number;
  background: string | null;
  layers: Layer[];
  /** Layer folders: a name for a run of layers that hide, lock, select and move together. */
  groups?: LayerGroup[];
  paintMode?: 'drawing' | 'design';
  /** Guides dragged from the rulers, in page units: vertical lines at x, horizontal lines at y. */
  guides?: { x: number[]; y: number[] };
  activeLayerId: string | null;
  /** Working-copy link to a Library entry (`view: 'studio'` hides it from the full Designer). */
  library?: { subjectId: string; versionId: string; docRev?: string; view?: 'studio' };
  /** Preserved when a Studio-only working doc is detached so it stays hidden from the full Designer. */
  view?: 'studio';
  lastExport?: RememberedExport;
  createdAt: number;
  updatedAt: number;
}
