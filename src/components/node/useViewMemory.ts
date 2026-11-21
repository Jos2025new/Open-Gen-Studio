import { useCallback, useEffect, useRef } from 'react';
import type { Viewport } from '@xyflow/react';
import { rememberView, savedView, type CanvasVariant, type CanvasView } from '../../engine/flow/canvasView';
import { useStore } from '../../store/store';

/** A move is written to the graph this long after the last one ends: a pan or a wheel burst is one write, never one per frame. */
export const VIEW_SAVE_DELAY_MS = 600;

/**
 * Remember where the canvas was left, per session and per canvas (Nodes or omnicanvas). `saved` is the view to open
 * in (undefined the first time: the canvas frames its content then); `onMoveEnd` goes to React Flow. A move still
 * waiting when the canvas closes (another space) is written on the way out. `enabled` false (Studio's board): nothing.
 */
export function useViewMemory(sessionId: string, omni: boolean, enabled = true) {
  const variant: CanvasVariant = omni ? 'omni' : 'nodes';
  const saved = useRef<CanvasView | undefined>(undefined);
  const first = useRef(true);
  if (first.current) { first.current = false; saved.current = enabled ? savedView(useStore.getState().sessions[sessionId]?.graph, variant) : undefined; }
  const pending = useRef<CanvasView | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const view = pending.current;
    pending.current = null;
    if (view) rememberView(sessionId, variant, view);
  }, [sessionId, variant]);
  useEffect(() => flush, [flush]);
  const onMoveEnd = useCallback((_event: unknown, view: Viewport) => {
    if (!enabled) return;
    pending.current = { x: view.x, y: view.y, zoom: view.zoom };
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, VIEW_SAVE_DELAY_MS);
  }, [enabled, flush]);
  return { saved: saved.current, onMoveEnd };
}
