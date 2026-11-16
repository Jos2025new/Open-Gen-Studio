import { describe, expect, it, vi } from 'vitest';
import type { ReactFlowInstance } from '@xyflow/react';
import { revealRect } from '../src/components/omni/revealNode';

/** A fake flow at zoom `z` with the origin at the canvas top-left (1000x600 canvas). */
const fake = (z: number) => {
  const setCenter = vi.fn();
  const rf = { flowToScreenPosition: (p: { x: number; y: number }) => ({ x: p.x * z, y: p.y * z }), getZoom: () => z, setCenter } as unknown as ReactFlowInstance;
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, right: 1000, bottom: 600 }) } as unknown as HTMLElement;
  return { rf, canvas, setCenter };
};

describe('revealRect', () => {
  it('leaves the view alone when the new node is fully visible', () => {
    const { rf, canvas, setCenter } = fake(1);
    revealRect(rf, canvas, { x: 100, y: 100, width: 260, height: 106 });
    expect(setCenter).not.toHaveBeenCalled();
  });
  it('pans to the node, keeping the zoom, when it is off-screen or cut by the edge', () => {
    const a = fake(0.8);
    revealRect(a.rf, a.canvas, { x: -716, y: 900, width: 260, height: 106 });
    expect(a.setCenter).toHaveBeenCalledWith(-586, 953, expect.objectContaining({ zoom: 0.8 }));
    const b = fake(1);
    revealRect(b.rf, b.canvas, { x: 900, y: 100, width: 260, height: 106 });
    expect(b.setCenter).toHaveBeenCalled();
  });
});
