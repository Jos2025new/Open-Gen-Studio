import { describe, expect, it } from 'vitest';
import type { GraphNode, GraphNodeData } from '../src/engine/types';
import { findFreePosition, findFreePositionFor, nodeRect, panelZone, rectsOverlap } from '../src/engine/flow/graph';
import { portZoom } from '../src/components/node/connectionDrop';

// Reataque p10 (Haiku, 2026-11-22). Cada it.fails reproduce un hallazgo; ninguno debe pasar.
const IMAGE = { kind: 'image', title: 'Image' } as GraphNodeData;
const TEXT = { kind: 'text', title: 'Text', text: '' } as GraphNodeData;
const at = (id: string, x: number, y: number, data: GraphNodeData): GraphNode => ({ id, position: { x, y }, data });

describe('reataque p10b: el + y el alta de tarjetas', () => {
  // reproduce: + desde una tarjeta de texto eligiendo Image; la tarjeta nueva cae a x=808 (448 px del origen), no a x=360
  it.fails('a + from a Text card that adds an Image lands beside the source, not 448 px away', () => {
    const src = nodeRect(at('t', 0, 0, TEXT));
    const placed = findFreePositionFor(IMAGE, { x: 360, y: 0 }, [src], { preferRight: true });
    expect(placed.x, `placed at ${JSON.stringify(placed)}`).toBeLessThan(460);
  });

  // reproduce: + desde una tarjeta Image (su panel reservado) eligiendo Image; la tarjeta nueva cae a x=808, no cerca
  it.fails('a + from an Image card that adds an Image lands beside the source, not 448 px away', () => {
    const src = nodeRect(at('i', 0, 0, IMAGE));
    const placed = findFreePositionFor(IMAGE, { x: 360, y: 0 }, [src], { preferRight: true });
    expect(placed.x, `placed at ${JSON.stringify(placed)}`).toBeLessThan(460);
  });

  // reproduce: findFreePosition ignora NodeRect.panel; con una Image existente la tarjeta nueva (multi-imagen en NodeWorkspace:305, omni.ts) queda bajo su panel
  it.fails('findFreePosition (multi-image drop, omni layout) keeps the new card off an existing Image composer panel', () => {
    const image = nodeRect(at('i', 0, 0, IMAGE));
    const panel = panelZone(IMAGE, image)!;
    const placed = findFreePosition({ x: 320, y: 260 }, { width: 260, height: 220 }, [image], { gapX: 48, gapY: 56 });
    expect(rectsOverlap({ ...placed, width: 260, height: 220 }, panel), `placed at ${JSON.stringify(placed)}`).toBe(false);
  });
});

describe('reataque p10b: zona de clic a zoom extremo', () => {
  // reproduce: zoom 0.1 en lienzo normal u omni; portZoom sube a 0.25, asi la zona de 24 px mide 9,6 px en pantalla, no 24
  it.fails('the 24 px click zone of a port is 24 px on screen at zoom 0.1', () => {
    const zoom = 0.1;
    const localPx = 24 / portZoom(zoom);
    const screenPx = localPx * zoom;
    expect(screenPx, `zone is ${screenPx} px on screen`).toBeGreaterThanOrEqual(24);
  });
});
