// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined, peekAssetUrl: () => undefined, loadAssetUrl: async () => undefined }));
import { createDoc, newRasterLayer, newVectorLayer } from '../src/engine/design/doc';
import { layerObjects, objectAt, withoutObjects, translateObjects, alignObjectDeltas, distributeBoxes, turnObjects, wholeLayerObject } from '../src/engine/design/objectOps';
import { objectBelow, objectsUnder } from '../src/engine/design/objectBelow';
import type { DesignDoc, Layer, RasterLayer, VectorLayer } from '../src/engine/types';

/* Ataques a la selección: vacíos, un solo objeto, ids repetidos, capas ocultas/bloqueadas, datos heredados, números extremos. */

const rect = (x: number, y: number, w: number, h: number, extra: Record<string, unknown> = {}) =>
  ({ type: 'rect', x, y, w, h, fill: '#000', stroke: null, strokeWidth: 0, radius: 0, ...extra }) as never;
const line = (x: number, y: number, w: number, h: number) =>
  ({ type: 'line', x, y, w, h, fill: null, stroke: '#000', strokeWidth: 2, radius: 0 }) as never;
const docOf = (...layers: Layer[]): DesignDoc => ({ ...createDoc('D', 200, 200), layers, activeLayerId: layers[0]?.id ?? null });
const painted = (stroke: Record<string, unknown>): RasterLayer => {
  const image = newRasterLayer('Paint', { x: 10, y: 20, width: 50, height: 40 }, { width: 50, height: 40 });
  return { ...image, paintStrokes: [{ id: 'st', x: 0, y: 0, color: '#000', opacity: 1, erase: false, segments: [[5, 5, 20, 20, 3]], ...stroke } as never] };
};

describe('selección: vector con forma diagonal y caja solapada', () => {
  // Rectángulo abajo (0..100) y una diagonal arriba: en (90,10) la diagonal no pasa, pero su caja sí.
  const v = newVectorLayer('V', [rect(0, 0, 100, 100), line(0, 0, 100, 100)]) as VectorLayer;
  const [rectId, lineId] = v.shapes.map((s) => s.id);

  it('objectAt elige el rectángulo bajo el cursor (la diagonal no está ahí)', () => {
    expect(objectAt(v, 90, 10)).toBe(rectId);
  });

  it.fails('objectsUnder no incluye una forma cuya caja cubre el punto pero cuya forma no (objectBelow.ts: parts by box)', () => {
    // Causa: objectsUnder comprueba solo la caja de las partes de vector; objectAt usa vectorObjectHit.
    expect(objectsUnder(docOf(v), 90, 10).map((u) => u.id)).toEqual([rectId]);
  });

  it('Ctrl+Alt+click con la diagonal bajo el cursor: pasa a la siguiente forma que sí está', () => {
    const d = docOf(v);
    expect(objectsUnder(d, 50, 50).map((u) => u.id)).toEqual([lineId, rectId]);
    expect(objectBelow(d, 50, 50, [{ layerId: v.id, ids: [lineId] }])?.id).toBe(rectId);
    // Desde la última (la de abajo) vuelve a la de arriba.
    expect(objectBelow(d, 50, 50, [{ layerId: v.id, ids: [rectId] }])?.id).toBe(lineId);
  });
});

describe('selección: capas, vacíos y un solo objeto', () => {
  it('capas ocultas o bloqueadas no aportan objetos bajo el cursor', () => {
    const a = newVectorLayer('A', [rect(0, 0, 50, 50)]);
    const b = newVectorLayer('B', [rect(0, 0, 50, 50)]);
    expect(objectsUnder(docOf({ ...a, visible: false }, b), 10, 10).map((u) => u.layerId)).toEqual([b.id]);
    expect(objectsUnder(docOf({ ...a, locked: true }, b), 10, 10).map((u) => u.layerId)).toEqual([b.id]);
  });

  it('documento vacío y capa vacía: no hay objeto below ni hits', () => {
    expect(objectBelow(docOf(), 5, 5, [])).toBeNull();
    expect(objectsUnder(docOf(newVectorLayer('E', [])), 5, 5)).toEqual([]);
    expect(objectAt(newVectorLayer('E', []), 5, 5)).toBeNull();
  });

  it('un solo objeto: Ctrl+Alt+click lo devuelve a sí mismo, no falla', () => {
    const v = newVectorLayer('V', [rect(0, 0, 50, 50)]);
    const d = docOf(v);
    expect(objectBelow(d, 10, 10, [{ layerId: v.id, ids: [v.shapes[0].id] }])?.id).toBe(v.shapes[0].id);
  });

  it('una pick obsoleta (id que ya no existe) vuelve a empezar por el de arriba', () => {
    const v = newVectorLayer('V', [rect(0, 0, 50, 50), rect(0, 0, 50, 50)]);
    const d = docOf(v);
    expect(objectBelow(d, 10, 10, [{ layerId: v.id, ids: ['no-existe'] }])?.id).toBe(v.shapes[1].id);
  });

  it('forma bloqueada no es pickable: el punto cae en la de debajo', () => {
    const v = newVectorLayer('V', [rect(0, 0, 50, 50), rect(0, 0, 50, 50, { locked: true })]);
    expect(objectAt(v, 10, 10)).toBe(v.shapes[0].id);
  });

  it('dos formas con el mismo id en una capa: no se duplica el objeto en objectsUnder', () => {
    const v = newVectorLayer('V', [rect(0, 0, 50, 50), rect(0, 0, 50, 50)]);
    const dup = { ...v, shapes: v.shapes.map((s) => ({ ...s, id: 'same' })) } as VectorLayer;
    expect(objectsUnder(docOf(dup), 10, 10).map((u) => u.id).filter((id) => id === 'same')).toHaveLength(1);
  });
});

describe('selección: imagen pintada y trazos', () => {
  it.fails('una capa con base pintada y solo trazos de borrado sigue teniendo un objeto seleccionable', () => {
    // Causa: layerObjects filtra erase y wholeLayerObject exige no tener trazos; esa capa no tiene ningún objeto (objectOps.ts layerObjects).
    const l = painted({});
    const onlyErase = { ...l, paintBaseId: 'base', paintStrokes: [{ ...l.paintStrokes![0], erase: true }] } as RasterLayer;
    expect(layerObjects(onlyErase).length).toBeGreaterThan(0);
  });

  it('una capa pintada con trazo: sus objetos son trazos, no la capa entera', () => {
    expect(layerObjects(painted({})).map((o) => o.id)).toEqual(['st']);
    expect(wholeLayerObject(painted({}))).toBe(false);
  });

  it.fails('withoutObjects devuelve la misma capa cuando no quita nada (contrato del comentario; objectOps.ts withoutObjects)', () => {
    // Causa: raster y vector siempre crean un objeto nuevo; deletePickedObjects compara con === y registra un paso de deshacer vacío.
    const v = newVectorLayer('V', [rect(0, 0, 10, 10)]);
    expect(withoutObjects(v, ['no-existe'])).toBe(v);
  });
});

describe('selección: números extremos y heredados', () => {
  it('desplazar con NaN no cambia la capa', () => {
    const v = newVectorLayer('V', [rect(0, 0, 10, 10)]);
    expect(translateObjects(v, [v.shapes[0].id], NaN, 0)).toBe(v);
  });

  it.fails('desplazar con Infinity no deja coordenadas no finitas en la capa (objectOps.ts translateObjects: sin guarda)', () => {
    const v = newVectorLayer('V', [rect(0, 0, 10, 10)]);
    const out = translateObjects(v, [v.shapes[0].id], Infinity, 0) as VectorLayer;
    expect(Number.isFinite(out.shapes[0].x)).toBe(true);
  });

  it('objeto con caja de ancho cero no aparece al hacer clic (no revienta)', () => {
    const v = newVectorLayer('V', [rect(5, 5, 0, 0)]);
    expect(() => objectAt(v, 5, 5)).not.toThrow();
  });
});

describe('alinear y distribuir objetos', () => {
  it('alinear en grupo con referencia "selección" no mueve nada (regresión)', () => {
    const v = newVectorLayer('V', [rect(0, 0, 10, 10), rect(50, 0, 10, 10)]);
    const ids = v.shapes.map((s) => s.id);
    expect(alignObjectDeltas({ width: 200, height: 200 }, v, ids, 'left', 'selection', true).size).toBe(0);
  });

  it('alinear en grupo con un solo objeto no mueve nada (regresión)', () => {
    const v = newVectorLayer('V', [rect(0, 0, 10, 10)]);
    expect(alignObjectDeltas({ width: 200, height: 200 }, v, [v.shapes[0].id], 'left', 'first', true).size).toBe(0);
  });

  it.fails('distribuir: tres objetos sin solape con uno ancho en medio (objectOps.ts distributeBoxes: span = último.x+ancho)', () => {
    // Causa: distributeBoxes toma como borde derecho el del último por x (C, 40) y no el máximo (B, 90); B acaba solapando C.
    // Orden por x: A(0..10), B(20..90), C(30..40).
    const items = [
      { id: 'A', box: { x: 0, y: 0, w: 10, h: 10 } },
      { id: 'B', box: { x: 20, y: 0, w: 70, h: 10 } },
      { id: 'C', box: { x: 30, y: 0, w: 10, h: 10 } },
    ];
    const d = distributeBoxes(items.map((i) => ({ ...i, box: { ...i.box } })), 'h');
    const pos = items.map((i) => {
      const dx = d.get(i.id)?.dx ?? 0;
      return { id: i.id, x0: i.box.x + dx, x1: i.box.x + dx + i.box.w };
    }).sort((p, q) => p.x0 - q.x0);
    for (let k = 1; k < pos.length; k++) expect(pos[k].x0).toBeGreaterThanOrEqual(pos[k - 1].x1 - 1e-9);
  });

  it('distribuir con menos de tres objetos no hace nada (regresión)', () => {
    expect(distributeBoxes([{ id: 'A', box: { x: 0, y: 0, w: 1, h: 1 } }, { id: 'B', box: { x: 5, y: 0, w: 1, h: 1 } }], 'h').size).toBe(0);
  });
});

describe('girar objetos de imagen pintada con píxeles no cuadrados', () => {
  it.fails('un giro de 90° conserva la longitud del trazo en página (objectOps.ts turnObjects, rama raster: gira en píxeles de buffer con kx≠ky)', () => {
    // Capa 50x40 pt con buffer 100x40 px: kx=2, ky=1. Un trazo horizontal de 10 pt debe seguir midiendo 10 pt tras girarlo.
    const base = newRasterLayer('P', { x: 0, y: 0, width: 50, height: 40 }, { width: 100, height: 40 });
    const l = { ...base, paintStrokes: [{ id: 's', x: 0, y: 0, color: '#000', opacity: 1, erase: false, segments: [[20, 20, 40, 20, 2]] }] } as RasterLayer;
    const out = turnObjects(l, ['s'], 'rotate-cw') as RasterLayer;
    const [ax, ay, bx, by] = out.paintStrokes![0].segments[0];
    const lenPage = Math.hypot((bx - ax) / 2, (by - ay) / 1);
    expect(lenPage).toBeCloseTo(10, 5);
  });
});
