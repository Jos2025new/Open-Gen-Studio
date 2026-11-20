import type { DesignDoc, Graph, StrokeStyle, TextStyle } from './types';

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 96,
  fontWeight: 700,
  color: '#ffffff',
  align: 'left',
  lineHeight: 1.1,
  letterSpacing: 0,
};

export const DEFAULT_STROKE_STYLE: StrokeStyle = {
  color: '#ffffff',
  size: 8,
  thinning: 0.6,
  smoothing: 0.5,
  streamline: 0.5,
  taperStart: 0,
  taperEnd: 0,
  opacity: 1,
};

export type PageUnit = 'px' | 'mm' | 'in';
export const PAGE_UNITS: PageUnit[] = ['px', 'mm', 'in'];

export interface DesignerTestInfo {
  selection: { layers: string[]; objects: unknown[] };
  history: { undo: number; redo: number; dropped?: number };
  raster: string[];
}

/**
 * Inverted domain hooks for src/store/store.ts: Designer and Nodes modules register their
 * implementations here (and src/engine/storeWiring.ts wires them at startup in main.tsx).
 * This leaf never statically imports design/ or flow/.
 */
export const storeHooks = {
  graphEditProblem: (_sessionId: string, _before: Graph, _after: Graph): string | null => null,
  recordGraph: (_sessionId: string, _before: Graph, _after: Graph): void => undefined,
  pinPaintMode: <T extends Pick<DesignDoc, 'paintMode' | 'layers'>>(doc: T): T => doc,
  /** Registered by storeWiring at startup; fallback preserves saveNow's lazy raster import await boundary. */
  loadRaster: (): Promise<{ flushRaster: () => Promise<void> }> => import('./design/raster'),
  designerTestInfo: (_docId: string | undefined): DesignerTestInfo => ({
    selection: { layers: [], objects: [] },
    history: { undo: 0, redo: 0 },
    raster: [],
  }),
};
