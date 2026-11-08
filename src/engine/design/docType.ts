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
  lastExport?: RememberedExport;
  createdAt: number;
  updatedAt: number;
}
