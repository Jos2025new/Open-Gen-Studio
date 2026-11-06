import type { RefObject } from 'react';
import type { DesignDoc } from '../../engine/types';
import type { SampleLoupeHandle } from './SampleLoupe';
import { ctx2d } from '../../lib/media';
import { setUi, toast, useStore } from '../../store/store';
import { fillRegion } from '../../engine/design/fill';
import { secondaryOf, setSecondary } from '../../engine/design/colorPair';
import { renderSource } from '../../engine/design/sampleSource';
import { averageColor, clampRadius, rememberColor, sampleColor } from '../../engine/design/swatches';

/* The eyedropper's gesture, and the Fill's click, kept out of Stage: modifiers, live sampling while dragging, the click's options. */

/** The loupe by the pointer (stage pixels from the view), showing `color`. */
export const showLoupe = (loupe: RefObject<SampleLoupeHandle | null>, view: { x: number; y: number; zoom: number }, p: { x: number; y: number }, color: string | null): void =>
  loupe.current?.show(view.x + p.x * view.zoom, view.y + p.y * view.zoom, color);

/** Pointer up: hide the loupe and keep the color; `p` null (cancelled) keeps nothing. */
export function sampleUp(loupe: RefObject<SampleLoupeHandle | null>, d: SampleDrag, doc: DesignDoc, p: { x: number; y: number } | null): void {
  loupe.current?.hide();
  if (p) endSample(d, doc, p);
}

export type SampleTarget = 'primary' | 'secondary';
type Sheet = { data: Uint8ClampedArray; w: number; h: number };
export interface SampleDrag {
  kind: 'sample'; target: SampleTarget; radius: number; source: 'all' | 'layer';
  /** The source composed once at the first move (null: not yet; false: too big or unreadable, read point by point). */
  sheet: Sheet | null | false; color: string | null; at: number;
}

/** Above this many page pixels the sheet (4 bytes each) is not kept: 16 Mpx = 64 MB. */
export const SHEET_MAX = 16_000_000;
/** Without a sheet, one read per this many ms. */
const SLOW_GAP = 66;

type Mods = { altKey: boolean; ctrlKey: boolean; shiftKey: boolean; metaKey?: boolean };
const COLOR_TOOLS = new Set(['brush', 'fill', 'gradient', 'lineart', 'rect', 'ellipse', 'polygon', 'star', 'sector', 'arc', 'chord', 'line', 'curve', 'arrow', 'text']);

/**
 * Does this press sample a color, and into which one? The eyedropper always does (Shift: the secondary). On a color tool:
 * Ctrl+Shift (not seized by the window manager, works in Lineart too), then Alt (not Lineart, where it bends a stroke); both fill the primary.
 * Ctrl alone is not sampling: it is the Fill with the secondary color (see runFill).
 */
export function samplingGesture(tool: string, e: Mods): SampleTarget | null {
  if (tool === 'eyedropper') return e.shiftKey ? 'secondary' : 'primary';
  if (!COLOR_TOOLS.has(tool)) return null;
  if (e.ctrlKey && e.shiftKey) return 'primary';
  return e.altKey && tool !== 'lineart' ? 'primary' : null;
}

/** Start sampling at the press: the color under the pointer now (a lone click needs nothing more). Null: could not read, already told. */
export function beginSample(doc: DesignDoc, p: { x: number; y: number }, tool: string, e: Mods): SampleDrag | null {
  const target = samplingGesture(tool, e);
  if (!target) return null;
  const { sampleRadius, sampleSource } = useStore.getState().ui.brush;
  const radius = clampRadius(sampleRadius), source = sampleSource === 'layer' ? 'layer' : 'all';
  let reason = '';
  const color = sampleColor(doc, p.x, p.y, { radius, source, onReason: (why) => { reason = why; } });
  if (reason) { toast(reason, 'error'); return null; }
  return { kind: 'sample', target, radius, source, sheet: null, color, at: performance.now() };
}

/** The sheet for the drag: the whole source composed once, so a move is a small window of array reads and never a recompose. */
function sheetOf(d: SampleDrag, doc: DesignDoc): Sheet | false {
  const w = Math.round(doc.width), h = Math.round(doc.height);
  if (w * h > SHEET_MAX) return false;
  const read = renderSource(doc, d.source, { origin: 'color-sample' });
  if (typeof read === 'string') return false;
  return { data: ctx2d(read.canvas).getImageData(0, 0, w, h).data, w, h };
}

/** The color under a moving pointer (null: transparent there). Read from the sheet; on a huge page, a few reads per second. */
export function moveSample(d: SampleDrag, doc: DesignDoc, p: { x: number; y: number }, force = false): string | null {
  if (d.sheet === null) d.sheet = sheetOf(d, doc);
  if (d.sheet) {
    const x = Math.floor(p.x), y = Math.floor(p.y);
    d.color = x < 0 || y < 0 || x >= d.sheet.w || y >= d.sheet.h ? null : averageColor(d.sheet.data, d.sheet.w, d.sheet.h, x, y, d.radius);
    return d.color;
  }
  const now = performance.now();
  if (force || now - d.at >= SLOW_GAP) { d.at = now; d.color = sampleColor(doc, p.x, p.y, { radius: d.radius, source: d.source }); }
  return d.color;
}

/** Release: the last color becomes the primary or the secondary and joins the recent colors. */
export function endSample(d: SampleDrag, doc: DesignDoc, p: { x: number; y: number }): void {
  const color = moveSample(d, doc, p, true);
  if (!color) return void toast('Nothing to pick here: nothing is drawn at this point.', 'info');
  if (d.target === 'secondary') setSecondary(color);
  else { setUi({ brush: { ...useStore.getState().ui.brush, color } }); rememberColor(color); }
}

/**
 * A Fill click with the tool's settings: Ctrl/⌘ fills with the secondary color; Shift flips Connected / All similar for this click.
 */
export function runFill(sessionId: string, doc: DesignDoc, p: { x: number; y: number }, e: Mods): void {
  const { brush, gradient } = useStore.getState().ui;
  const color = e.ctrlKey || e.metaKey ? secondaryOf(brush, gradient) : brush.color;
  try {
    fillRegion(sessionId, doc, p.x, p.y, color, brush.opacity, {
      threshold: brush.fillThreshold, expand: brush.fillExpand, smooth: brush.fillSmooth,
      source: brush.fillSource, gap: brush.fillGap, similar: !!brush.fillSimilar !== e.shiftKey,
    });
  } catch (error) { toast(error instanceof Error ? error.message : 'Could not fill this region.', 'error'); }
}
