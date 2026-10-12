import { describe, expect, it } from 'vitest';
import { fxPlan } from '../src/engine/fx/plan';
import type { FxLayer } from '../src/engine/fx/types';
import type { RasterLayer, VectorLayer } from '../src/engine/types';
import { LONG_STROKE_COUNT, LONG_STROKE_SEGMENTS, PROFESSIONAL_IDS, PROFESSIONAL_SIZE, professionalDocument, professionalSessionIds, seededRandom } from '../src/lib/designerBenchProfessional';

describe('professional bench document (deterministic generator)', () => {
  const { doc, rasterLayers } = professionalDocument();
  const count = (type: string) => doc.layers.filter((l) => l.type === type).length;

  it('is a 2048 x 2048 page with 26 layers: 13 raster, 3 vector, 10 FX', () => {
    expect([doc.width, doc.height]).toEqual([PROFESSIONAL_SIZE, PROFESSIONAL_SIZE]);
    expect(doc.layers).toHaveLength(26);
    expect(count('raster')).toBe(13);
    expect(count('vector')).toBe(3);
    expect(count('fx')).toBe(10);
  });

  it('groups the layers into four folders, each layer in exactly one folder', () => {
    expect(doc.groups?.map((g) => g.name)).toEqual(['Escenario', 'Personajes', 'Ajustes', 'Vectores']);
    const groupIds = new Set(doc.groups!.map((g) => g.id));
    expect(doc.layers.every((l) => l.groupId && groupIds.has(l.groupId))).toBe(true);
  });

  it('gives one layer 300 long strokes and the others between 40 and 120, all with editable tips', () => {
    const long = doc.layers.find((l) => l.id === PROFESSIONAL_IDS.longLayer) as RasterLayer;
    expect(long.paintStrokes).toHaveLength(LONG_STROKE_COUNT);
    expect(long.paintStrokes!.every((s) => s.segments.length === LONG_STROKE_SEGMENTS && s.tip)).toBe(true);
    const others = rasterLayers.filter((l) => l.id !== long.id).map((l) => l.paintStrokes?.length ?? 0);
    expect([...others].sort((a, b) => a - b)).toEqual([40, 40, 50, 60, 60, 70, 80, 90, 100, 110, 120, 120]);
    expect(rasterLayers.every((l) => l.paintStrokes!.every((s) => s.tip && typeof s.tip.hardness === 'number'))).toBe(true);
  });

  it('has unique stroke ids and 36 vector shapes', () => {
    const ids = rasterLayers.flatMap((l) => l.paintStrokes!.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
    const shapes = doc.layers.filter((l): l is VectorLayer => l.type === 'vector').flatMap((l) => l.shapes);
    expect(shapes).toHaveLength(36);
    expect(new Set(shapes.map((s) => s.id)).size).toBe(36);
  });

  it('splits the FX into 6 below-scoped and 4 layer-scoped, and the plan attaches the layer ones to their targets', () => {
    const fx = doc.layers.filter((l): l is FxLayer => l.type === 'fx');
    expect(fx.filter((f) => f.scope === 'below')).toHaveLength(6);
    expect(fx.filter((f) => f.scope === 'layer')).toHaveLength(4);
    const clips = fxPlan(doc.layers).filter((s) => s.t === 'clip');
    expect(clips.map((s) => s.layer.name).sort()).toEqual(['Personaje 3', 'Personaje 5', 'Personaje 8', 'Personaje 9']);
    expect(fxPlan(doc.layers).filter((s) => s.t === 'below')).toHaveLength(6);
  });

  it('is the same document on every call (fixed seed and ids)', () => {
    // createdAt/updatedAt come from the clock; the content (layers, folders, ids) must not.
    const again = professionalDocument().doc;
    expect(JSON.stringify({ layers: again.layers, groups: again.groups, id: again.id })).toBe(JSON.stringify({ layers: doc.layers, groups: doc.groups, id: doc.id }));
    expect(seededRandom(7)()).toBe(seededRandom(7)());
  });
});

describe('prepare reuses the bench session that holds the document', () => {
  it('returns the existing bench session only, never another session or a session with another document', () => {
    const sessions = {
      a: { title: 'Benchmark profesional', docs: [{ id: 'bench-doc-profesional' }] },
      b: { title: 'Otra sesión', docs: [{ id: 'bench-doc-profesional' }] },
      c: { title: 'Benchmark profesional', docs: [{ id: 'otro-documento' }] },
    };
    expect(professionalSessionIds(sessions)).toEqual(['a']);
    expect(professionalSessionIds({})).toEqual([]);
  });
});
