import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GraphNode, GraphNodeData } from '../src/engine/types';
import { findFreePosition, findFreePositionFor, nodeRect, panelZone, rectsOverlap } from '../src/engine/flow/graph';
import { hitZoom, HIT_MIN_ZOOM } from '../src/components/node/connectionDrop';

// Reataque p10 (Haiku, 2026-11-22), hallazgos ya arreglados.
const IMAGE = { kind: 'image', title: 'Image' } as GraphNodeData;
const TEXT = { kind: 'text', title: 'Text', text: '' } as GraphNodeData;
const at = (id: string, x: number, y: number, data: GraphNodeData): GraphNode => ({ id, position: { x, y }, data });

describe('reataque p10b: el + y el alta de tarjetas', () => {
  it('a + from a Text card that adds an Image lands beside the source, not 448 px away', () => {
    const src = nodeRect(at('t', 0, 0, TEXT));
    const placed = findFreePositionFor(IMAGE, { x: 360, y: 0 }, [src], { preferRight: true });
    expect(placed.x, `placed at ${JSON.stringify(placed)}`).toBe(360);
  });

  it('a + from an Image card that adds an Image lands beside the source, not 448 px away', () => {
    const src = nodeRect(at('i', 0, 0, IMAGE));
    const placed = findFreePositionFor(IMAGE, { x: 360, y: 0 }, [src], { preferRight: true });
    expect(placed.x, `placed at ${JSON.stringify(placed)}`).toBe(360);
  });

  it('findFreePosition (multi-image drop, omni layout) keeps the new card off an existing Image composer panel', () => {
    const image = nodeRect(at('i', 0, 0, IMAGE));
    const panel = panelZone(IMAGE, image)!;
    const placed = findFreePosition({ x: 320, y: 260 }, { width: 260, height: 220 }, [image], { gapX: 48, gapY: 56 });
    expect(rectsOverlap({ ...placed, width: 260, height: 220 }, panel), `placed at ${JSON.stringify(placed)}`).toBe(false);
  });
});

describe('reataque p10b: zona de clic a zoom extremo', () => {
  it('the 24 px click zone of a port is 24 px on screen at every canvas zoom', () => {
    for (const zoom of [0.05, 0.1, 0.2, 0.25, 1, 3]) {
      const screenPx = (24 / hitZoom(zoom)) * zoom;
      expect(screenPx, `zone is ${screenPx} px on screen at ${zoom}`).toBeGreaterThanOrEqual(24);
    }
  });

  it('the zone clamp is the canvas minimum zoom and the CSS reads it', () => {
    expect(HIT_MIN_ZOOM).toBe(0.05);
    expect(readFileSync('src/components/node/CanvasNavigation.tsx', 'utf8')).toMatch(/NODE_MIN_ZOOM = 0\.05/);
    expect(readFileSync('src/styles/node-system.css', 'utf8')).toMatch(/\.port::after[^}]*calc\(24px \/ var\(--rf-hit-zoom, 1\)\)/);
  });
});
