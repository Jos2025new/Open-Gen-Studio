import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GraphNodeData } from '../src/engine/types';
import { NODE_WIDTH, panelZone } from '../src/engine/flow/graph';
import { hitZoom, portZoom } from '../src/components/node/connectionDrop';

// Tercer ataque (Haiku, 2026-11-22) a p10 sobre task/p10-7 (36b56a53). Cada hallazgo = it.fails: pasa mientras el fallo existe.
const cssNodeSystem = readFileSync('src/styles/node-system.css', 'utf8');
const cssNode = readFileSync('src/styles/node.css', 'utf8');

describe('reataque p10c: zona del + de la tarjeta de texto a zoom bajo', () => {
  // reproduce: texto a zoom 0.05 o 0.1: la zona de 24 px del + (.k-text .nc-next::after) desplaza su centro con --rf-zoom (clamp 0.25)
  // pero dimensiona con --rf-hit-zoom (clamp 0.05). El borde interior cae dentro del cuerpo: 68 px de flujo frente a un borde de 260.
  // Antes de 281a8ac5 el borde interior quedaba en el borde de la tarjeta. Arreglo probable: usar --rf-hit-zoom en el left.
  it.fails('the + zone of a Text card never covers the card body at any zoom', () => {
    const offset = Number(cssNodeSystem.match(/k-text\) \.nc-next::after \{ left: calc\(50% \+ \(12px \/ var\(--rf-zoom, 1\) - (\d+)px\)\)/)?.[1]);
    const navRight = Number(cssNode.match(/k-text\) \.nc-next\.react-flow__handle \{ right: -(\d+)px/)?.[1]);
    expect(offset).toBe(7);
    expect(navRight).toBe(18);
    const R = NODE_WIDTH; // borde derecho de la tarjeta, en px de flujo
    for (const zoom of [0.05, 0.1, 0.2]) {
      const rfz = portZoom(zoom);
      const hitz = hitZoom(zoom);
      const navLeft = R + navRight - 22; // .nc-next: 22 px anclado a right: -18px
      const center = navLeft + 11 + (12 / rfz - offset); // left: 50% + (12px / --rf-zoom - 7px), luego translate(-50%)
      const inner = center - 12 / hitz; // ancho calc(24px / --rf-hit-zoom), mitad en px de flujo
      expect(inner, `zoom ${zoom}: borde interior ${inner.toFixed(1)} px de flujo, la tarjeta termina en ${R}`).toBeGreaterThanOrEqual(R);
    }
  });
});

describe('reataque p10c: alto reservado del panel del composer', () => {
  // reproduce: el prompt de una tarjeta generadora crece hasta 13.75rem = 220 px (.nt-prompt, field-sizing: content). Con padding 12+12,
  // borde 1+1 y gap 10, el panel mide 256 px como mínimo (más la fila de modelo). PANEL.height = 190 reserva menos: un vecino
  // colocado en el borde reservado queda bajo ~66 px del panel mientras la tarjeta está seleccionada (solape visual).
  it.fails('the reserved panel height covers a composer whose prompt grew to its CSS maximum', () => {
    const padding = cssNode.match(/\.nt-panel \{[^}]*padding: 0\.75rem/) ? 12 : 0;
    const gap = cssNode.match(/\.nt-panel \{[^}]*gap: 0\.625rem/) ? 10 : 0;
    const promptMax = cssNode.match(/\.nt-prompt \{[^}]*max-height: 13\.75rem/) ? 220 : 0;
    expect(promptMax).toBe(220);
    const minFull = padding * 2 + 2 + promptMax + gap; // sin la fila de modelo ni las referencias
    const data = { kind: 'image', title: 'Image' } as GraphNodeData;
    const panel = panelZone(data, { x: 0, y: 0, width: NODE_WIDTH, height: 220 })!;
    expect(panel.height, `reservado ${panel.height} px; el composer necesita al menos ${minFull} px`).toBeGreaterThanOrEqual(minFull);
  });
});
