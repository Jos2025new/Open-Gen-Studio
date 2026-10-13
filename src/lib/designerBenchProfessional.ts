import { sandboxBenchAllowed } from './designerBenchFixtures';
import { createDoc, newRasterLayer, newVectorLayer } from '../engine/design/doc';
import { TIP_PRESETS } from '../engine/design/brushEngine';
import { newFxLayer, newFxOp } from '../engine/fx/commands';
import type { FxGroup, FxKind, FxLayer, FxScope } from '../engine/fx/types';
import type { DesignDoc, Layer, LayerGroup, RasterLayer, RasterStroke, VectorLayer } from '../engine/types';
import type { ShapeSpec } from '../engine/shapeSpec';

/*
 * Synthetic professional document for the sandbox bench (Tarea 1 of docs/arquitectura-render.md). Pure and
 * deterministic: a fixed seed and fixed ids, so the same call always returns the same document. It reuses the
 * Designer's own constructors (createDoc, newRasterLayer, newVectorLayer, newFxLayer, newFxOp); no new format.
 *
 * Layout, bottom → top (1-based): 3 location layers; 10 character layers (one of them, Personaje 1, holds 300 long
 * strokes); 10 FX layers (layer-scoped and below-scoped, of filters and effects); 3 vector layers (36 shapes, in the
 * right-hand strip and the bottom-right corner, away from the long strokes). Four folders group them.
 */

export const PROFESSIONAL_SEED = 20261012;
// Bench only: ?size= on the sandbox URL picks the page side (A/B at 1024 and 2048); the default is 2048.
export const PROFESSIONAL_SIZE = sandboxBenchAllowed(location) ? Number(new URLSearchParams(location.search).get('size') ?? 2048) : 2048;
export const LONG_STROKE_COUNT = 300;
export const LONG_STROKE_SEGMENTS = 120;
/** Id of the layer the bench moves an early stroke from; ids are fixed so the bench can find them. */
export const PROFESSIONAL_IDS = {
  paintLayer: 'prof-lyr-personaje-2',
  longLayer: 'prof-lyr-personaje-1',
  /** The below-scoped curves FX whose midtones the bench changes. */
  curvesFx: 'prof-fx-curvas',
  /** The vector layer the bench moves as a whole. */
  wholeLayer: 'prof-lyr-sello',
  /** Folder hidden and shown by the bench. */
  folderPersonajes: 'prof-grp-personajes',
} as const;

/** mulberry32: a small seeded generator, the same on every machine. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PALETTE = ['#e8d5b7', '#2f4858', '#c0392b', '#f1c40f', '#27ae60', '#8e44ad', '#ecf0f1', '#34495e'];

/** Long strokes: stroke i sits on its own row (6 px apart), so a press on one of them picks that stroke only. */
export function longStrokes(): RasterStroke[] {
  return Array.from({ length: LONG_STROKE_COUNT }, (_, i) => ({
    id: `prof-long-${i}`, x: 0, y: 0, color: '#f4f0e8', opacity: 0.85, erase: false,
    tip: { hardness: 1, texture: 'none', blend: 'normal' },
    segments: Array.from({ length: LONG_STROKE_SEGMENTS }, (_, j) => {
      const x = 80 + j * 14;
      const y = 40 + i * 6;
      return [x, y + Math.sin(j / 6) * 1, x + 14, y + Math.sin((j + 1) / 6) * 1, 3] as [number, number, number, number, number];
    }),
  }));
}

/** Short random-walk strokes with editable tips (hardness, paper texture, multiply, keep opacity). */
export function wanderingStrokes(prefix: string, count: number, rand: () => number): RasterStroke[] {
  return Array.from({ length: count }, (_, i) => {
    let x = 100 + rand() * 1600, y = 100 + rand() * 1800, angle = rand() * Math.PI * 2;
    const width = 3 + rand() * 10, segmentCount = 12 + Math.floor(rand() * 29);
    const segments: RasterStroke['segments'] = [];
    for (let j = 0; j < segmentCount; j++) {
      angle += (rand() - 0.5) * 0.6;
      const len = 10 + rand() * 8, nx = x + Math.cos(angle) * len, ny = y + Math.sin(angle) * len;
      segments.push([x, y, nx, ny, width]);
      x = nx; y = ny;
    }
    return {
      id: `${prefix}-${i}`, x: 0, y: 0, erase: false,
      color: PALETTE[Math.floor(rand() * PALETTE.length)], opacity: 0.6 + rand() * 0.4, segments,
      tip: {
        hardness: TIP_PRESETS[Math.floor(rand() * TIP_PRESETS.length)],
        texture: rand() < 0.3 ? 'paper' : 'none',
        blend: rand() < 0.2 ? 'multiply' : 'normal',
        ...(rand() < 0.1 ? { keepOpacity: true } : {}),
      },
    };
  });
}

const FX_SPECS: Record<string, { kind: FxKind; group: FxGroup; scope: FxScope; params?: Record<string, number>; name: string }> = {
  levels: { kind: 'levels', group: 'filter', scope: 'below', name: 'Niveles del escenario', params: { inBlack: 0.04, inWhite: 0.96, gamma: 1.05 } },
  shadowChr3: { kind: 'shadow', group: 'effect', scope: 'layer', name: 'Sombra · Personaje 3', params: { blur: 14, x: 10, y: 10, opacity: 0.5 } },
  glowChr5: { kind: 'glow', group: 'effect', scope: 'layer', name: 'Brillo · Personaje 5', params: { strength: 0.6, radius: 16 } },
  levelsChr8: { kind: 'levels', group: 'filter', scope: 'layer', name: 'Niveles · Personaje 8', params: { inBlack: 0.1, inWhite: 0.9 } },
  blurChr9: { kind: 'blur', group: 'filter', scope: 'layer', name: 'Desenfoque · Personaje 9', params: { radius: 3 } },
  blurBelow: { kind: 'blur', group: 'filter', scope: 'below', name: 'Desenfoque de todo lo inferior', params: { radius: 2 } },
  curves: { kind: 'curves', group: 'filter', scope: 'below', name: 'Curvas de todo lo inferior', params: { shadows: 0.2, midtones: 0.5, highlights: 0.8 } },
  saturation: { kind: 'saturation', group: 'filter', scope: 'below', name: 'Saturación de todo lo inferior', params: { amount: 1.1 } },
  hue: { kind: 'hue', group: 'filter', scope: 'below', name: 'Tono de todo lo inferior', params: { degrees: 12 } },
  shadowBelow: { kind: 'shadow', group: 'effect', scope: 'below', name: 'Sombra de todo lo inferior', params: { blur: 8, x: 4, y: 4, opacity: 0.35 } },
};

function fxLayer(key: keyof typeof FX_SPECS, id: string): FxLayer {
  const spec = FX_SPECS[key];
  const op = newFxOp(spec.kind, spec.params ?? {});
  const layer = newFxLayer(spec.group, { name: spec.name, scope: spec.scope, ops: [{ ...op, id: `${id}-op` }] });
  return { ...layer, id };
}

function shapes(layerId: string, list: ShapeSpec[]): ShapeSpec[] {
  return list.map((s, k) => ({ ...s, id: `${layerId}-shp-${k}` }) as ShapeSpec & { id: string });
}

/** The vector layers: 14 + 18 shapes in the right strip, 4 in the bottom-right corner (36 in total). */
function vectorLayers(): VectorLayer[] {
  const titles = Array.from({ length: 14 }, (_, k): ShapeSpec => ({ type: 'rect', x: 1812, y: 40 + k * 80, w: 170, h: 46, fill: '#ffffff', stroke: null, strokeWidth: 0, radius: 6 }));
  const bullets = Array.from({ length: 18 }, (_, k): ShapeSpec => ({ type: 'ellipse', x: 1850, y: 1210 + k * 34, w: 22, h: 22, fill: null, stroke: '#f1c40f', strokeWidth: 3, radius: 0 }));
  const seal = [
    { type: 'rect', x: 1830, y: 1860, w: 160, h: 50, fill: '#c0392b', stroke: null, strokeWidth: 0, radius: 0 },
    { type: 'ellipse', x: 1840, y: 1930, w: 60, h: 60, fill: null, stroke: '#ffffff', strokeWidth: 4, radius: 0 },
    { type: 'line', x: 1920, y: 1930, w: 60, h: 60, fill: null, stroke: '#ffffff', strokeWidth: 4, radius: 0 },
    { type: 'rect', x: 1830, y: 1995, w: 160, h: 4, fill: '#ffffff', stroke: null, strokeWidth: 0, radius: 0 },
  ] as ShapeSpec[];
  const make = (id: string, name: string, list: ShapeSpec[]): VectorLayer => ({ ...newVectorLayer(name, []), id, shapes: shapes(id, list) as VectorLayer['shapes'] });
  return [
    make('prof-lyr-titulos', 'Títulos', titles),
    make('prof-lyr-vinetas', 'Viñetas', bullets),
    make(PROFESSIONAL_IDS.wholeLayer, 'Sello', seal),
  ];
}

/** Build the synthetic document. Raster layers come with empty base buffers; the bench fills them (composeRaster). */
export function professionalDocument(): { doc: DesignDoc; rasterLayers: RasterLayer[] } {
  const rand = seededRandom(PROFESSIONAL_SEED);
  const page = { x: 0, y: 0, width: PROFESSIONAL_SIZE, height: PROFESSIONAL_SIZE };
  const raster = (id: string, name: string, strokes: RasterStroke[], groupId: string): RasterLayer => ({
    ...newRasterLayer(name, page, { width: PROFESSIONAL_SIZE, height: PROFESSIONAL_SIZE }), id, groupId, paintBaseId: `${id}-base`, paintStrokes: strokes,
  });
  const chr = (n: number, count: number) => raster(n === 1 ? PROFESSIONAL_IDS.longLayer : `prof-lyr-personaje-${n}`, `Personaje ${n}`, n === 1 ? longStrokes() : wanderingStrokes(`prof-p${n}`, count, rand), 'prof-grp-personajes');
  const loc = (n: number, name: string, count: number) => raster(`prof-lyr-localizacion-${n}`, name, wanderingStrokes(`prof-l${n}`, count, rand), 'prof-grp-escenario');

  const withGroup = (id: string, layer: Layer, groupId: string): Layer => ({ ...layer, id, groupId } as Layer);
  const bottom: Layer[] = [
    loc(1, 'Localización 1 · bosque', 60),
    loc(2, 'Localización 2 · ciudad', 40),
    loc(3, 'Localización 3 · costa', 120),
    withGroup('prof-fx-niveles-escenario', fxLayer('levels', 'prof-fx-niveles-escenario'), 'prof-grp-escenario'),
    chr(2, 90), chr(3, 60),
    withGroup('prof-fx-sombra-p3', fxLayer('shadowChr3', 'prof-fx-sombra-p3'), 'prof-grp-personajes'),
    chr(4, 110), chr(5, 50),
    withGroup('prof-fx-brillo-p5', fxLayer('glowChr5', 'prof-fx-brillo-p5'), 'prof-grp-personajes'),
    chr(6, 80), chr(7, 40), chr(8, 120),
    withGroup('prof-fx-niveles-p8', fxLayer('levelsChr8', 'prof-fx-niveles-p8'), 'prof-grp-personajes'),
    chr(9, 70),
    withGroup('prof-fx-desenfoque-p9', fxLayer('blurChr9', 'prof-fx-desenfoque-p9'), 'prof-grp-personajes'),
    chr(10, 100), chr(1, 0),
    withGroup('prof-fx-desenfoque-todo', fxLayer('blurBelow', 'prof-fx-desenfoque-todo'), 'prof-grp-ajustes'),
    withGroup(PROFESSIONAL_IDS.curvesFx, fxLayer('curves', PROFESSIONAL_IDS.curvesFx), 'prof-grp-ajustes'),
    withGroup('prof-fx-saturacion-todo', fxLayer('saturation', 'prof-fx-saturacion-todo'), 'prof-grp-ajustes'),
    withGroup('prof-fx-tono-todo', fxLayer('hue', 'prof-fx-tono-todo'), 'prof-grp-ajustes'),
    withGroup('prof-fx-sombra-todo', fxLayer('shadowBelow', 'prof-fx-sombra-todo'), 'prof-grp-ajustes'),
  ];
  const top = vectorLayers().map((l) => ({ ...l, groupId: 'prof-grp-vectores' }) as Layer);
  const layers = [...bottom, ...top];
  const groups: LayerGroup[] = [
    { id: 'prof-grp-escenario', name: 'Escenario' },
    { id: PROFESSIONAL_IDS.folderPersonajes, name: 'Personajes' },
    { id: 'prof-grp-ajustes', name: 'Ajustes' },
    { id: 'prof-grp-vectores', name: 'Vectores' },
  ];
  const doc: DesignDoc = { ...createDoc('Profesional sintético 2048 (Tarea 1)', PROFESSIONAL_SIZE, PROFESSIONAL_SIZE), id: 'bench-doc-profesional', groups, layers, activeLayerId: PROFESSIONAL_IDS.paintLayer };
  return { doc, rasterLayers: layers.filter((l): l is RasterLayer => l.type === 'raster') };
}

export const PROFESSIONAL_DOC_ID = 'bench-doc-profesional';
export const PROFESSIONAL_SESSION_TITLE = 'Benchmark profesional';

/**
 * Sessions made by the bench for this document (title and doc id), in store order. prepareProfessional reuses the first
 * one instead of adding another, so the sandbox keeps one copy of the document.
 */
export function professionalSessionIds(sessions: Record<string, { title: string; docs: Array<{ id: string }> }>): string[] {
  return Object.entries(sessions)
    .filter(([, s]) => s.title === PROFESSIONAL_SESSION_TITLE && s.docs.some((d) => d.id === PROFESSIONAL_DOC_ID))
    .map(([id]) => id);
}
