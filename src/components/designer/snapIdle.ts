import { SnapWatchdog } from '../../engine/design/snapSession';
import { SNAP_IDLE_MS, snapNow } from '../../engine/design/snap';

/*
 * The delayed snap of a move or transform drag (Inkscape's snap timer, tool-base.cpp). While the pointer is fast the
 * session returns no nudge; this bridge arms the watchdog at each such move, so that if the pointer then stops, the same
 * move handler runs again 150 ms later with the last position (and a time SNAP_IDLE_MS on), snaps, previews and asks for
 * its frame by the path every move already uses. A new move re-arms it, a slow move (already snapped) and pointer up
 * cancel it. Pointer up then confirms the position the last preview left, in one undo step.
 */

export interface MoveLike { clientX: number; clientY: number; timeStamp: number; altKey: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }
type Replay = (e: never) => void;

export class SnapIdleBridge {
  private wd: SnapWatchdog;
  private last: { x: number; y: number; t: number } | null = null;
  private key: object | null = null;
  constructor(schedule: (fn: () => void, ms: number) => unknown, cancel: (h: unknown) => void) {
    this.wd = new SnapWatchdog(schedule, cancel);
  }

  /** Seed a drag from pointerdown when its first move must be classified by real pointer speed. */
  start(key: object, e: MoveLike): void {
    this.wd.cancel();
    this.key = key;
    this.last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  }

  /** One move of drag `key`: arm the timer when the pointer is fast; `replay` gets the last position once it is idle. */
  feed(key: object, e: MoveLike, replay: Replay): void {
    if (key !== this.key) { this.key = key; this.last = null; }
    const prev = this.last;
    this.last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    const speed = prev ? Math.hypot(e.clientX - prev.x, e.clientY - prev.y) / Math.max(1, e.timeStamp - prev.t) : 0;
    if (snapNow(speed, 0)) { this.wd.cancel(); return; }
    const { clientX, clientY, altKey, shiftKey, ctrlKey, metaKey } = e;
    const at = e.timeStamp + SNAP_IDLE_MS;
    this.wd.arm(SNAP_IDLE_MS, () => {
      const ev = { clientX, clientY, altKey, shiftKey, ctrlKey, metaKey, timeStamp: at, nativeEvent: { clientX, clientY, timeStamp: at } };
      replay(ev as never);
    });
  }

  /** Pointer up or cancel: no snap is pending any more. */
  stop(): void { this.wd.cancel(); this.key = null; this.last = null; }
  get armed(): boolean { return this.wd.armed; }
}

const bridge = new SnapIdleBridge((fn, ms) => setTimeout(fn, ms), (h) => clearTimeout(h as never));

/** Called by Stage and the path-node editor on each move; only supported move/scale/node drags are delayed. */
export function snapIdleFeed(d: { kind?: string; op?: string }, e: MoveLike, replay: Replay): void {
  if (d.kind === 'move' || d.kind === 'objMove' || d.kind === 'pathNode' || (d.kind === 'xform' && d.op === 'scale')) bridge.feed(d, e, replay);
}
export function snapIdleStart(d: { kind?: string; op?: string }, e: MoveLike): void {
  if (d.kind === 'pathNode') bridge.start(d, e);
}
export const snapIdleStop = (): void => bridge.stop();
