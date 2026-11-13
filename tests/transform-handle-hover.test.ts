import { expect, it, vi } from 'vitest';
import { drawTransformOverlay } from '../src/components/designer/stageSprites';

it('colors only the hovered handle without changing its outline', () => {
  const fills: string[] = [], paths: unknown[] = [];
  const ctx = new Proxy({ fillStyle: '', strokeStyle: '' } as Record<string, unknown>, {
    get(target, key: string) {
      if (key === 'fill') return () => fills.push(target.fillStyle as string);
      if (key === 'moveTo' || key === 'lineTo' || key === 'arc') return (...args: unknown[]) => paths.push([key, ...args]);
      return key in target ? target[key] : vi.fn();
    },
    set(target, key: string, value) { target[key] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
  const handles = [ { op: 'scale', fx: -1, fy: -1, x: 0, y: 0 }, { op: 'scale', fx: 1, fy: 1, x: 20, y: 20 } ];
  const draw = (hover: typeof handles[number] | null) => drawTransformOverlay(ctx, { x: 0, y: 0, w: 20, h: 20 }, null, handles, false, hover, '#abcdef');
  draw(null);
  const originalPaths = paths.slice(); paths.length = 0; fills.length = 0;
  draw(handles[1]);
  expect(fills).toEqual(['#0a0a0b', '#abcdef']);
  expect(paths).toEqual(originalPaths);
});
