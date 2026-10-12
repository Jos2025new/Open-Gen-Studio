import type { DesignDoc } from '../../src/engine/types';
import type { Scene } from './scene';

/** The stage view: the document's origin at (x, y) on the canvas, at `zoom` px per document px. */
export interface View { zoom: number; x: number; y: number; width: number; height: number }

export interface Engine {
  name: 'canvas2d' | 'webgl2' | 'canvaskit';
  init(scene: Scene, canvas: HTMLCanvasElement): Promise<void>;
  /** A raster layer's editable strokes or position changed: refresh what the engine keeps per layer. */
  layerChanged(doc: DesignDoc, layerId: string): void;
  /** Draws the whole page at the view. Work may be queued; sync() waits for it. */
  render(doc: DesignDoc, view: View): void;
  /** Waits for the GPU to finish the last frame (a one-pixel read, or the engine's equivalent). */
  sync(): void;
  /** The full-resolution page as RGBA (top row first), for pixel comparison. */
  fullPage(doc: DesignDoc): Uint8ClampedArray;
  /** Bytes of canvases/textures the engine holds, estimated from their sizes. */
  textureBytes(): number;
}
