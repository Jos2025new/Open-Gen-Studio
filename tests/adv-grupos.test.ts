// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined, peekAssetUrl: () => undefined, loadAssetUrl: async () => undefined }));
import { clickPick, expandPicks, groupShapes, shapesSvgTree, ungroupShapes, validPicks, groupMembers } from '../src/engine/design/objectGroupTree';
import { normalizeObjectTree } from '../src/engine/design/objectTreeNormalize';
import { restackShapes } from '../src/engine/design/stackOrder';
import { groupAcrossLayers } from '../src/engine/design/groupAcross';
import type { DesignDoc, ObjectGroup, VectorLayer, VectorShape } from '../src/engine/types';

/*
 * Ataques al árbol de grupos. Generadores deterministas (semilla fija): árboles válidos aleatorios y árboles
 * corruptos. Cada resultado debe conservar: mismos ids de forma, sin grupos vacíos, sin ciclos, miembros contiguos.
 */

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const shapeOf = (id: string, groupId?: string, extra: Record<string, unknown> = {}): VectorShape =>
  ({ id, type: 'rect', x: 0, y: 0, w: 10, h: 10, fill: '#000', stroke: null, strokeWidth: 0, radius: 0, ...(groupId ? { groupId } : {}), ...extra }) as VectorShape;

function layerOf(shapes: VectorShape[], objectGroups?: ObjectGroup[]): VectorLayer {
  return { id: 'L', name: 'L', type: 'vector', visible: true, locked: false, opacity: 1, blend: 'normal', shapes, ...(objectGroups?.length ? { objectGroups } : {}) } as unknown as VectorLayer;
}

/** Árbol válido: grupos anidados, miembros contiguos, ningún grupo vacío; algunos ocultos o bloqueados. */
function validLayer(r: () => number, n: number): VectorLayer {
  const shapes: VectorShape[] = [];
  const groups: ObjectGroup[] = [];
  let gcount = 0;
  const fill = (parent: string | undefined, depth: number, count: number) => {
    for (let i = 0; i < count && shapes.length < n; i++) {
      if (depth < 4 && r() < 0.3) {
        const id = `g${gcount++}`;
        const before = shapes.length;
        groups.push({ id, name: `Group ${id}`, parentId: parent, ...(r() < 0.15 ? { locked: true } : {}), ...(r() < 0.1 ? { hidden: true } : {}) });
        fill(id, depth + 1, 1 + Math.floor(r() * 3));
        if (shapes.length === before) groups.pop();
      } else {
        const sid = `s${shapes.length}`;
        shapes.push(shapeOf(sid, parent, r() < 0.1 ? { locked: true } : r() < 0.08 ? { hidden: true } : {}));
      }
    }
  };
  while (shapes.length < n) fill(undefined, 0, 3);
  return layerOf(shapes, groups);
}

/** Problemas del árbol de grupos: lo que cualquier lector (objectGroupTree.ts, export, objetos) da por supuesto. */
function problems(layer: VectorLayer): string[] {
  const out: string[] = [];
  const groups = layer.objectGroups ?? [];
  const byId = new Map<string, ObjectGroup>();
  for (const g of groups) {
    if (byId.has(g.id)) out.push(`grupo duplicado ${g.id}`);
    byId.set(g.id, g);
  }
  for (const g of groups) if (g.parentId && !byId.has(g.parentId)) out.push(`padre inexistente en ${g.id}`);
  for (const g of groups) {
    const seen = new Set<string>();
    for (let c: ObjectGroup | undefined = g; c; c = c.parentId ? byId.get(c.parentId) : undefined) {
      if (seen.has(c.id)) { out.push(`ciclo en ${g.id}`); break; }
      seen.add(c.id);
    }
  }
  const ids = new Set<string>();
  for (const s of layer.shapes) {
    if (ids.has(s.id)) out.push(`forma duplicada ${s.id}`);
    ids.add(s.id);
    if (s.groupId && !byId.has(s.groupId)) out.push(`forma ${s.id} en grupo inexistente ${s.groupId}`);
  }
  // Pertenencia (directa o anidada) como cadena de ids; cada grupo debe tener miembros y ser una sola tanda.
  const chainIds = (gid: string | undefined): string[] => {
    const out: string[] = [];
    for (let c = gid ? byId.get(gid) : undefined; c && !out.includes(c.id); c = c.parentId ? byId.get(c.parentId) : undefined) out.push(c.id);
    return out;
  };
  const runs = new Map<string, number[]>();
  layer.shapes.forEach((s, i) => { for (const g of chainIds(s.groupId)) { const r = runs.get(g) ?? []; r.push(i); runs.set(g, r); } });
  for (const g of groups) {
    const r = runs.get(g.id);
    if (!r) { out.push(`grupo vacío ${g.id}`); continue; }
    if (r.at(-1)! - r[0] + 1 !== r.length) out.push(`miembros de ${g.id} no contiguos`);
  }
  return out;
}

const cases = (count: number, size: number, make: (r: () => number, n: number) => VectorLayer) => {
  const bad: Array<{ seed: number; msgs: string[] }> = [];
  for (let seed = 1; seed <= count; seed++) {
    const r = rng(seed * 7919);
    const layer = make(r, 2 + Math.floor(r() * size));
    const msgs = problems(layer);
    if (msgs.length) bad.push({ seed, msgs: msgs.slice(0, 3) });
  }
  return bad;
};

describe('árboles válidos generados: el generador cumple sus propias reglas', () => {
  it('validLayer produce árboles sin problemas (control del propio ataque)', () => {
    expect(cases(200, 10, validLayer)).toEqual([]);
  });
});

describe('agrupar con Ctrl+G sobre árboles aleatorios', () => {
  it('cada agrupación conserva ids, árbol válido y orden de pintura de los no agrupados', () => {
    const bad: Array<{ seed: number; msgs: string[] }> = [];
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed * 104729);
      const layer = validLayer(r, 2 + Math.floor(r() * 10));
      const pickable = layer.shapes.filter((s) => !s.hidden && !s.locked).map((s) => s.id);
      const ids = pickable.filter(() => r() < 0.5);
      if (ids.length < 2) continue;
      const res = groupShapes(layer, ids);
      if (!res) { bad.push({ seed, msgs: ['groupShapes devuelve null con 2+ formas'] }); continue; }
      const msgs = problems(res.layer);
      const before = layer.shapes.map((s) => s.id).sort().join();
      const after = res.layer.shapes.map((s) => s.id).sort().join();
      if (before !== after) msgs.push('se perdieron o duplicaron formas');
      if (msgs.length) bad.push({ seed, msgs: msgs.slice(0, 3) });
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it('una agrupación no cambia la posición relativa de las formas que no se agrupan', () => {
    const bad: Array<{ seed: number; msgs: string[] }> = [];
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed * 31337);
      const layer = validLayer(r, 2 + Math.floor(r() * 10));
      const ids = layer.shapes.filter((s) => !s.hidden && !s.locked && r() < 0.5).map((s) => s.id);
      if (ids.length < 2) continue;
      const res = groupShapes(layer, ids);
      if (!res) continue;
      // Los ocultos o bloqueados de un grupo parcial viajan con la agrupación (objectGroupTree.ts): no cuentan como "no agrupadas".
      const moved = new Set([...ids, ...groupMembers(res.layer, res.groupId).map((s) => s.id)]);
      const others = (l: VectorLayer) => l.shapes.map((s) => s.id).filter((id) => !moved.has(id));
      const a = others(layer).join(), b = others(res.layer).join();
      if (a !== b) bad.push({ seed, msgs: [`orden de no agrupadas: ${a} -> ${b}`] });
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });
});

describe('desagrupar y reordenar sobre árboles aleatorios', () => {
  it('ungroupShapes deja el árbol válido y conserva las formas', () => {
    const bad: Array<{ seed: number; msgs: string[] }> = [];
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed * 611953);
      const layer = validLayer(r, 2 + Math.floor(r() * 10));
      const ids = layer.shapes.filter(() => r() < 0.4).map((s) => s.id);
      const out = ungroupShapes(layer, ids);
      if (!out) continue;
      const msgs = problems(out);
      if (out.shapes.length !== layer.shapes.length) msgs.push('cambió el número de formas');
      if (msgs.length) bad.push({ seed, msgs: msgs.slice(0, 3) });
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it('restackShapes (adelante/atrás/al frente/al fondo) conserva el árbol y las formas', () => {
    const bad: Array<{ seed: number; msgs: string[] }> = [];
    const ops = ['front', 'forward', 'backward', 'back'] as const;
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed * 2741);
      const layer = validLayer(r, 2 + Math.floor(r() * 10));
      const ids = layer.shapes.filter(() => r() < 0.3).map((s) => s.id);
      const op = ops[Math.floor(r() * 4)];
      const out = restackShapes(layer, ids, op);
      if (!out) continue;
      const msgs = problems(out);
      if (out.shapes.length !== layer.shapes.length) msgs.push('cambió el número de formas');
      if (msgs.length) bad.push({ seed, msgs: [op, ...msgs.slice(0, 3)] });
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it('reordenar una forma suelta no cambia el orden de las demás (grupo partido en un archivo viejo; stackOrder.ts restackShapes)', () => {
    // Causa: restackShapes junta los miembros de un grupo partido en su primera posición; b y c cambian de orden sin
    // que ninguna de las dos se haya movido (resultado a,c,d,b). Solo d debe moverse.
    const layer = layerOf([shapeOf('a', 'G'), shapeOf('b'), shapeOf('c', 'G'), shapeOf('d')], [{ id: 'G', name: 'G' }]);
    const out = restackShapes(layer, ['d'], 'backward');
    expect(out?.shapes.map((s) => s.id).filter((id) => id !== 'd')).toEqual(['a', 'b', 'c']);
  });
});

describe('normalizar árboles corruptos', () => {
  /** Árbol corrupto: ids de grupo repetidos o desordenados, padres que faltan, ciclos, grupos vacíos. */
  function corrupt(r: () => number): VectorLayer {
    const n = 2 + Math.floor(r() * 8);
    const groups: ObjectGroup[] = [];
    for (let i = 0; i < 4; i++) {
      const parent = r() < 0.2 ? 'nope' : r() < 0.3 ? `g${Math.floor(r() * 4)}` : undefined;
      groups.push({ id: `g${i}`, name: `G${i}`, parentId: parent });
    }
    if (r() < 0.3) groups.push({ id: 'g1', name: 'dup', parentId: 'g0' });
    const shapes = Array.from({ length: n }, (_, i) => shapeOf(`s${i}`, r() < 0.7 ? `g${Math.floor(r() * 4)}` : undefined));
    return layerOf(shapes, groups);
  }

  it('deja un árbol válido, sin cambiar el orden de pintura, y es idempotente', () => {
    const bad: Array<{ seed: number; msgs: string[] }> = [];
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed * 4099);
      const layer = corrupt(r);
      const out = normalizeObjectTree(layer);
      const msgs = problems(out);
      if (out.shapes.map((s) => s.id).join() !== layer.shapes.map((s) => s.id).join()) msgs.push('cambió el orden de pintura');
      if (normalizeObjectTree(out) !== out) msgs.push('no es idempotente');
      if (msgs.length) bad.push({ seed, msgs: msgs.slice(0, 3) });
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it('un árbol ya válido vuelve como el mismo objeto', () => {
    const v = validLayer(rng(99), 8);
    expect(normalizeObjectTree(v)).toBe(v);
  });
});

describe('leer el árbol: clic, selección válida y SVG', () => {
  it('clic en una forma oculta de un grupo visible toma todo el grupo, incluida la oculta', () => {
    const layer = layerOf([shapeOf('a', 'G'), shapeOf('b', 'G', { hidden: true }), shapeOf('c')], [{ id: 'G', name: 'G' }]);
    expect(clickPick(layer, 'a').sort()).toEqual(['a', 'b']);
    expect(clickPick(layer, 'b')).toEqual([]);
  });

  it('un grupo bloqueado no se pica por su miembro; un id desconocido no revienta', () => {
    const layer = layerOf([shapeOf('a', 'G', {}), shapeOf('x')], [{ id: 'G', name: 'G', locked: true }]);
    expect(clickPick(layer, 'a')).toEqual([]);
    expect(clickPick(layer, 'no-existe')).toEqual([]);
    // 'a' está en un grupo bloqueado (no se puede picar): sale; 'x' sí; un trazo (id que no es forma) se conserva.
    expect(validPicks(layer, ['a', 'x', 'trazo-lineart'])).toEqual(['x', 'trazo-lineart']);
  });

  it('expandPicks con formas vacías y con una sola forma no cambia nada', () => {
    const layer = layerOf([shapeOf('a')]);
    expect(expandPicks(layer, [])).toEqual([]);
    expect(expandPicks(layer, ['a'])).toEqual(['a']);
  });

  it('groupMembers de un grupo sin miembros devuelve lista vacía', () => {
    expect(groupMembers(layerOf([shapeOf('a')], [{ id: 'G', name: 'G' }]), 'G')).toEqual([]);
  });

  it('shapesSvgTree produce <g> balanceados y las formas en su orden de pintura, para cualquier árbol válido', () => {
    const bad: Array<{ seed: number; msg: string }> = [];
    for (let seed = 1; seed <= 150; seed++) {
      const layer = validLayer(rng(seed * 8191), 2 + (seed % 9));
      const svg = shapesSvgTree(layer, (s) => `<rect id="${s.id}"/>`, (x) => x);
      const opens = (svg.match(/<g[ >]/g) ?? []).length, closes = (svg.match(/<\/g>/g) ?? []).length;
      const order = [...svg.matchAll(/<rect[^>]*?id="([^"]+)"/g)].map((m) => m[1]).join();
      if (opens !== closes) bad.push({ seed, msg: `<g> sin cerrar: ${opens} abre, ${closes} cierra` });
      if (order !== layer.shapes.map((s) => s.id).join()) bad.push({ seed, msg: 'orden de pintura cambiado' });
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it('shapesSvgTree de una capa sin grupos ni formas no escribe nada', () => {
    expect(shapesSvgTree(layerOf([]), (s) => s.id, (x) => x)).toBe('');
  });
});

describe('agrupar en varias capas (Ctrl+G entre capas)', () => {
  const doc = (layers: VectorLayer[]): DesignDoc => ({ id: 'D', name: 'D', width: 100, height: 100, background: null, layers, activeLayerId: null, createdAt: 0, updatedAt: 0 } as unknown as DesignDoc);
  const vec = (id: string, shapes: VectorShape[], extra: Partial<VectorLayer> = {}): VectorLayer => ({ ...layerOf(shapes), id, name: id, ...extra } as VectorLayer);

  it('una sola forma en total no agrupa (null)', () => {
    const d = doc([vec('A', [shapeOf('a')]), vec('B', [shapeOf('b')])]);
    expect(groupAcrossLayers(d, [{ layerId: 'A', ids: ['a'] }])).toBeNull();
  });

  it('una capa bloqueada entre las elegidas impide el grupo con mensaje, sin cambiar nada', () => {
    const d = doc([vec('A', [shapeOf('a')]), vec('B', [shapeOf('b')], { locked: true })]);
    const out = groupAcrossLayers(d, [{ layerId: 'A', ids: ['a'] }, { layerId: 'B', ids: ['b'] }]);
    expect(out).toMatchObject({ error: expect.stringContaining('locked') });
  });

  it('sin ids válidos (la pick apunta a formas que no existen) no agrupa', () => {
    const d = doc([vec('A', [shapeOf('a'), shapeOf('b')])]);
    expect(groupAcrossLayers(d, [{ layerId: 'A', ids: ['fantasma', 'otro'] }])).toBeNull();
  });

  it('formas de varias capas acaban todas en la capa superior y ninguna se pierde', () => {
    const d = doc([vec('A', [shapeOf('a1'), shapeOf('a2')]), vec('B', [shapeOf('b1'), shapeOf('b2')])]);
    const out = groupAcrossLayers(d, [{ layerId: 'A', ids: ['a1', 'a2'] }, { layerId: 'B', ids: ['b1'] }]);
    expect(out && 'doc' in out).toBe(true);
    if (!out || !('doc' in out)) return;
    const target = out.doc.layers.find((l) => l.id === 'B') as VectorLayer;
    expect(target.shapes.map((s) => s.id).sort()).toEqual(['a1', 'a2', 'b1', 'b2']);
    const source = out.doc.layers.find((l) => l.id === 'A') as VectorLayer;
    expect(source.shapes.map((s) => s.id)).toEqual([]);
    for (const l of out.doc.layers) expect(problems(l as VectorLayer)).toEqual([]);
  });
});

describe('Ctrl+G entre capas: aspecto y conservación (aleatorio)', () => {
  const doc = (layers: VectorLayer[]): DesignDoc => ({ id: 'D', name: 'D', width: 100, height: 100, background: null, layers, activeLayerId: null, createdAt: 0, updatedAt: 0 } as unknown as DesignDoc);

  it('una capa de origen con opacidad pasa a un subgrupo con esa opacidad (no se pierde el aspecto)', () => {
    const A = { ...layerOf([shapeOf('a1'), shapeOf('a2')]), id: 'A', name: 'A', opacity: 0.5 } as unknown as VectorLayer;
    const B = { ...layerOf([shapeOf('b1')]), id: 'B', name: 'B' } as unknown as VectorLayer;
    const out = groupAcrossLayers(doc([A, B]), [{ layerId: 'A', ids: ['a1', 'a2'] }, { layerId: 'B', ids: ['b1'] }]);
    expect(out && 'doc' in out).toBe(true);
    if (!out || !('doc' in out)) return;
    const target = out.doc.layers.find((l) => l.id === 'B') as VectorLayer;
    expect(target.objectGroups?.some((g) => g.opacity === 0.5)).toBe(true);
    expect(problems(target)).toEqual([]);
  });

  it('con opacidad en la capa superior y más formas que las elegidas: avisa, no cambia nada', () => {
    const A = { ...layerOf([shapeOf('a1')]), id: 'A', name: 'A' } as unknown as VectorLayer;
    const B = { ...layerOf([shapeOf('b1'), shapeOf('b2')]), id: 'B', name: 'B', opacity: 0.5 } as unknown as VectorLayer;
    const out = groupAcrossLayers(doc([A, B]), [{ layerId: 'A', ids: ['a1'] }, { layerId: 'B', ids: ['b1'] }]);
    expect(out).toMatchObject({ error: expect.stringContaining('opacity') });
  });

  it('documentos aleatorios de 2 a 3 capas: ninguna forma se pierde y cada capa sigue válida', () => {
    const bad: Array<{ seed: number; msgs: string[] }> = [];
    for (let seed = 1; seed <= 150; seed++) {
      const r = rng(seed * 15485863);
      const nLayers = 2 + Math.floor(r() * 2);
      const layers: VectorLayer[] = [];
      let k = 0;
      for (let li = 0; li < nLayers; li++) {
        const base = validLayer(r, 1 + Math.floor(r() * 5));
        const renamed = base.shapes.map((s) => ({ ...s, id: `L${li}-${s.id}` }));
        const groups = (base.objectGroups ?? []).map((g) => ({ ...g, id: `L${li}-${g.id}`, parentId: g.parentId ? `L${li}-${g.parentId}` : undefined }));
        const shapes = renamed.map((s) => ({ ...s, groupId: s.groupId ? `L${li}-${s.groupId}` : undefined }));
        layers.push({ ...base, id: `L${li}`, name: `L${li}`, shapes, objectGroups: groups.length ? groups : undefined, ...(r() < 0.3 ? { opacity: 0.6 } : {}) } as unknown as VectorLayer);
        k++;
      }
      const picks = layers.map((l) => ({ layerId: l.id, ids: l.shapes.filter((s) => !s.hidden && !s.locked && r() < 0.5).map((s) => s.id) }));
      const total = picks.reduce((n, p) => n + p.ids.length, 0);
      const out = groupAcrossLayers(doc(layers), picks);
      if (!out || !('doc' in out)) continue;
      const msgs: string[] = [];
      const before = layers.reduce((n, l) => n + l.shapes.length, 0), after = out.doc.layers.reduce((n, l) => n + (l as VectorLayer).shapes.length, 0);
      if (before !== after) msgs.push(`formas ${before} -> ${after}`);
      for (const l of out.doc.layers) msgs.push(...problems(l as VectorLayer).slice(0, 2));
      if (total < 2) msgs.push('agrupó con menos de dos formas');
      if (msgs.length) bad.push({ seed, msgs: msgs.slice(0, 3) });
      void k;
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });
});
it('brings the selected shape above its group sibling in a split group while preserving the untouched shapes', () => {
  const layer = { type: 'vector', shapes: [{ id: 'a', groupId: 'G' }, { id: 'b' }, { id: 'c', groupId: 'G' }], objectGroups: [{ id: 'G', name: 'G' }] } as VectorLayer;
  const result = restackShapes(layer, ['a'], 'forward')?.shapes.map((s) => s.id);
  expect(result).toEqual(['b', 'c', 'a']);
});
