import { afterEach, describe, expect, it, vi } from 'vitest';
import { SnapIdleBridge, type MoveLike } from '../src/components/designer/snapIdle';
import { SnapSession } from '../src/engine/design/snapSession';
import { newVectorLayer } from '../src/engine/design/doc';
import { SNAP_IDLE_MS } from '../src/engine/design/snap';

afterEach(() => vi.useRealTimers());

const ev = (x: number, y: number, t: number): MoveLike => ({ clientX: x, clientY: y, timeStamp: t, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false });
const make = () => new SnapIdleBridge((fn, ms) => setTimeout(fn, ms), (h) => clearTimeout(h as never));

describe('snap idle bridge: the delayed snap needs no new pointermove', () => {
  it('a fast move arms it; 150 ms of silence replays the last position, once', () => {
    vi.useFakeTimers();
    const b = make(), d = {}, replay = vi.fn();
    b.feed(d, ev(0, 0, 0), replay);
    b.feed(d, ev(100, 0, 10), replay); // 10 px/ms
    expect(b.armed).toBe(true);
    vi.advanceTimersByTime(SNAP_IDLE_MS - 1);
    expect(replay).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(replay).toHaveBeenCalledTimes(1);
    const sent = replay.mock.calls[0][0];
    expect(sent).toMatchObject({ clientX: 100, clientY: 0, timeStamp: 10 + SNAP_IDLE_MS });
    vi.advanceTimersByTime(1000);
    expect(replay).toHaveBeenCalledTimes(1);
  });

  it('a new fast move re-arms it (the old time is dropped); a slow move and pointer up cancel it', () => {
    vi.useFakeTimers();
    const b = make(), d = {}, replay = vi.fn();
    b.feed(d, ev(0, 0, 0), replay);
    b.feed(d, ev(100, 0, 10), replay);
    vi.advanceTimersByTime(100);
    b.feed(d, ev(200, 0, 110), replay);
    vi.advanceTimersByTime(100);
    expect(replay).not.toHaveBeenCalled();
    b.feed(d, ev(200.1, 0, 300), replay); // slow: this move snapped by itself
    expect(b.armed).toBe(false);
    b.feed(d, ev(400, 0, 310), replay);
    expect(b.armed).toBe(true);
    b.stop();
    vi.advanceTimersByTime(1000);
    expect(replay).not.toHaveBeenCalled();
  });

  it('end to end with the session: fast move to 6 px of an edge, stop, and the replay snaps to it', () => {
    vi.useFakeTimers();
    const layer = { ...newVectorLayer('o'), id: 'o', shapes: [{ id: 's', type: 'rect', x: 300, y: 0, w: 50, h: 50, fill: '#fff', stroke: null, strokeWidth: 0, radius: 0 }] } as any;
    const session = new SnapSession({ width: 1000, height: 1000, layers: [layer], guides: undefined } as any, 'm', { on: true, page: false, layers: true }, 1, { x0: 0, y0: 0, x1: 1000, y1: 1000 });
    const b = make(), d = {};
    let nudge = { dx: 0, dy: 0 };
    // The handler as Stage writes it: the box left edge sits at the pointer; the session decides the nudge.
    const handler = (e: MoveLike) => {
      nudge = session.step({ x: e.clientX, y: 0, w: 40, h: 40 }, { x: e.clientX, y: 20 }, { x: e.clientX, y: e.clientY }, e.timeStamp);
      b.feed(d, e, handler as never);
    };
    handler(ev(0, 0, 0));
    handler(ev(294, 0, 12)); // fast: 24 px/ms, 6 px short of the edge at 300
    expect(nudge.dx).toBe(0);
    vi.advanceTimersByTime(SNAP_IDLE_MS);
    expect(nudge.dx).toBe(6);
    expect(b.armed).toBe(false);
  });
});
