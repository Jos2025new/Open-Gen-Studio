import { describe, expect, it } from 'vitest';
import { estimatedHeight, findFreePositionFor, nodeRect, NODE_WIDTH } from '../src/engine/flow/graph';
import type { GraphNodeData } from '../src/engine/types';

// Cuarto ataque (Haiku, 2026-11-22) a p10 sobre task/p10-7 (1fbaa7cc). PANEL.height 190 -> 300 cambia la colocacion.
// Cada hallazgo = it.fails: pasa mientras el fallo existe.
type Node = { id: string; data: GraphNodeData; position: { x: number; y: number } };
const image = (id: string, x: number, y: number): Node => ({ id, data: { kind: 'image' } as unknown as GraphNodeData, position: { x, y } });

describe('reataque p10d: colocacion con el panel del composer de 300 px', () => {
  // fixed (p10d, huecos junto a los bordes de lo ocupado): soltar desde el menu en (0,250), dentro del panel de una tarjeta de imagen seleccionada (panel y 232..532).
  // Con 190 px la nueva tarjeta cae en (0,526). Con 300 cae en (0,802), 552 px del punto. Hay hueco libre en (0,532), 282 px.
  it('a card dropped under an image card lands no farther than the free slot below its composer panel', () => {
    const P = image('P', 0, 0);
    const at = findFreePositionFor(P.data, { x: 0, y: 250 }, [nodeRect(P as never)]);
    expect(at.y).toBeLessThanOrEqual(532);
  });

  // reproduce: tres soltados seguidos en (0,250) (apilado de +). El segundo cae en (-616,250) o (616,250) en vez de a 308 px.
  it.fails('repeated drops at one point stay one column step away from each other', () => {
    const P = image('P', 0, 0);
    const nodes: Node[] = [P];
    const placed: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < 2; i++) {
      const p = findFreePositionFor(P.data, { x: 0, y: 250 }, nodes.map((n) => nodeRect(n as never)));
      placed.push(p);
      nodes.push(image('n' + i, p.x, p.y));
    }
    expect(Math.abs(placed[1].x)).toBeLessThanOrEqual(NODE_WIDTH + 48);
  });

  // reproduce: + desde una imagen con un hijo debajo (addConnected: y = fondo del hijo + 60). El nuevo hijo cae 336 px
  // por debajo del anterior, no 60. Pre-existente: en 5235d0b9 con PANEL 190 da lo mismo (dy 276 por el paso de la rejilla).
  it.fails('the next + child stacks about 60 px under the lowest child, not a grid step lower', () => {
    const P = image('P', 0, 0);
    const c1 = image('c1', P.position.x + NODE_WIDTH + 100, 0);
    const desired = { x: c1.position.x, y: c1.position.y + estimatedHeight(c1.data) + 60 };
    const at = findFreePositionFor(P.data, desired, [P, c1].map((n) => nodeRect(n as never)), { preferRight: true });
    expect(at.y - (c1.position.y + estimatedHeight(c1.data))).toBeLessThanOrEqual(120);
  });
});
