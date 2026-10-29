import type { Dispatch, SetStateAction } from 'react';
import { zoomAt, type View } from '../../engine/design/viewCoordinates';

/*
 * Ctrl+wheel zoom that stops at the usual levels (25, 50, 100, 150, 200 %). Single-unit wheel jitter does nothing; a
 * faster spin zooms further per notch, up to MAX_BOOST times the base step. A step that passes a stop, or comes within
 * STOP_BAND of it, lands on that stop, and the next wheel event that arrives within DWELL_MS of it holds there. After
 * IDLE_RESET_MS without a wheel event the gesture starts over. The zoom stays about the cursor (the caller's zoomAt).
 */

/** The zoom levels a wheel gesture stops at. */
export const ZOOM_STOPS = [0.25, 0.5, 1, 1.5, 2];
/** How close (in zoom units) a step must come to a stop to land on it. */
export const STOP_BAND = 0.05;
/** The hold: the next wheel event within this many ms of the landing one stays on the stop. */
export const DWELL_MS = 150;
/** A pause this long between wheel events ends the gesture: its speed and any hold are forgotten. */
export const IDLE_RESET_MS = 1000;

const RATE = 0.0022; // the base zoom per unit of deltaY (as the wheel zoomed before the stops)
const MAX_BOOST = 3; // the cap on the speed factor
const SPEED_GAIN = 0.5; // how much each unit of deltaY per ms adds to the step

/** What one wheel gesture remembers: when its last event came, and the stop it landed on (if that was the last step). */
export interface WheelZoomState { at: number; stop?: number }

/**
 * One wheel event: the zoom factor to apply about the cursor, and the state to keep for the next event. `zoom` is the
 * zoom before the event, `t` its time in ms.
 */
export function wheelZoomStep(zoom: number, deltaY: number, t: number, prev: WheelZoomState | null): { factor: number; state: WheelZoomState | null } {
  if (Math.abs(deltaY) <= 1) return { factor: 1, state: prev };
  const fresh = !prev || t - prev.at > IDLE_RESET_MS;
  // The hold: this event follows a landing on a stop closely; it stays there once and the gesture moves on after.
  if (prev && !fresh && prev.stop !== undefined && t - prev.at <= DWELL_MS) return { factor: 1, state: { at: t } };
  const speed = fresh || !prev ? 0 : Math.abs(deltaY) / Math.max(1, t - prev.at);
  const boost = Math.min(MAX_BOOST, Math.max(1, 1 + SPEED_GAIN * speed));
  let next = zoom * Math.exp(-deltaY * RATE * boost);
  let stop: number | undefined, nearest = Infinity;
  for (const s of ZOOM_STOPS) {
    const passes = (s - zoom) * (s - next) < 0;
    const enters = Math.abs(next - s) <= STOP_BAND && Math.abs(zoom - s) > STOP_BAND;
    if ((passes || enters) && Math.abs(zoom - s) < nearest) { stop = s; nearest = Math.abs(zoom - s); }
  }
  if (stop !== undefined) next = stop;
  return { factor: next / zoom, state: stop === undefined ? { at: t } : { at: t, stop } };
}

/**
 * The same step with the gesture state kept inside: one per stage. Each call zooms `view` about the cursor (px, py)
 * and returns the new view.
 */
export function wheelZoomer(): (view: View, px: number, py: number, deltaY: number, t: number) => View {
  let state: WheelZoomState | null = null;
  return (view, px, py, deltaY, t) => {
    const step = wheelZoomStep(view.zoom, deltaY, t, state);
    state = step.state;
    return zoomAt(view, px, py, step.factor);
  };
}

/** The part of a wheel event the stage reads. */
export interface WheelLike { ctrlKey: boolean; metaKey: boolean; clientX: number; clientY: number; deltaX: number; deltaY: number; timeStamp: number }

/**
 * The stage's wheel: Ctrl/Meta zooms about the cursor from the latest view, which it keeps itself, so several events
 * before a re-render compound; any other wheel pans. `sync` records the view React rendered.
 */
export function stageWheel(setView: Dispatch<SetStateAction<View>>) {
  const zoomBy = wheelZoomer();
  let latest: View = { zoom: 1, x: 0, y: 0 };
  return {
    sync(view: View) { latest = view; },
    wheel(e: WheelLike, rect: { left: number; top: number }) {
      if (e.ctrlKey || e.metaKey) {
        latest = zoomBy(latest, e.clientX - rect.left, e.clientY - rect.top, e.deltaY, e.timeStamp);
        setView(latest);
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    },
  };
}
