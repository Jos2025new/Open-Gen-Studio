// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const blobs = new Map<string, Blob>();
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: {
    get: async (k: string) => blobs.get(k),
    set: async (k: string, b: Blob) => { blobs.set(k, b); },
    del: async (k: string) => { blobs.delete(k); },
    delMany: async (ks: string[]) => { for (const k of ks) blobs.delete(k); },
  },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
  peekAssetUrl: () => undefined,
  loadAssetUrl: async () => undefined,
  deleteAssetBlobs: async () => undefined,
}));
vi.mock('svg2pdf.js', async () => {
  // @ts-expect-error browser bundle
  const browser = await import('../node_modules/svg2pdf.js/dist/svg2pdf.es.js');
  return { svg2pdf: browser.svg2pdf };
});

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createSession, setComposer, setUi, useStore } from '../src/store/store';
import { kitColors } from '../src/engine/activeKit';
import { runCommandsTool } from '../src/engine/agent/commandCalls';
import { addTextLayer, addVectorLayer, applyLayerStep, getDoc, mutateDoc, newBlankDoc, patchLayer, selectDoc, undoDoc } from '../src/engine/design/actions';
import { docToSvg, svgToPdf, type SvgDeps } from '../src/engine/design/export';
import { setObjectPick } from '../src/engine/design/objectSelection';
import { drawDoc, layoutText, textAscent } from '../src/engine/design/render';
import { paintOpacityPatch } from '../src/engine/design/shapeLook';
import { newStroke } from '../src/engine/design/strokes';
import { installTokenSync, tokenChoices, tokenOf } from '../src/engine/design/tokenBind';
import { createItem, libraryToDesigner, saveItem } from '../src/engine/libraryVersions';
import { DEFAULT_STROKE_STYLE } from '../src/engine/storeBindings';
import type { KitTokens } from '../src/engine/libraryTypes';
import type { TextLayer, VectorLayer } from '../src/engine/types';
import { BrushSettings } from '../src/components/designer/BrushSettings';
import { CanvasSize } from '../src/components/designer/CanvasSize';
import { InlineColor } from '../src/components/designer/InlineControls';
import { PaintSwatch } from '../src/components/designer/ShapePaint';
import { patchShape } from '../src/components/designer/ShapeLookFields';
import { StrokeStyleFields } from '../src/components/designer/StrokeStyleFields';
import { TextEditor } from '../src/components/designer/TextEditor';
import { TextLayerFields } from '../src/components/designer/TokenFields';
import { KitPage } from '../src/components/gallery/KitPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
(SVGElement.prototype as unknown as { getBBox?: () => { x: number; y: number; width: number; height: number } }).getBBox ??= () => ({ x: 0, y: 0, width: 60, height: 24 });
HTMLCanvasElement.prototype.getContext = (() => ({
  font: '', textBaseline: 'top', textAlign: 'left', fillStyle: '', strokeStyle: '', globalAlpha: 1, globalCompositeOperation: 'source-over',
  measureText: (s: string) => ({ width: s.length * 12, emHeightAscent: 24, fontBoundingBoxAscent: 24 }),
  save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fill() {}, stroke() {}, fillRect() {}, clearRect() {}, fillText() {}, setTransform() {},
  getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
})) as unknown as typeof HTMLCanvasElement.prototype.getContext;

const TOKENS: KitTokens = {
  sea: { type: 'color', value: '#0a4d68', modes: { Dark: '#88ccee' } },
  glass: { type: 'color', value: '#0a4d6880', modes: { Dark: '#88ccee40' } },
};
const inter = new Uint8Array(readFileSync('node_modules/@fontsource/inter/files/inter-latin-400-normal.woff'));

describe('color tokens with alpha across UI, sync, storage, exports and agent', () => {
  let sid: string, kitId: string, docId: string, stop: () => void, host: HTMLDivElement, root: Root;
  const doc = () => getDoc(sid, docId)!;
  const layer = <T,>(i: number) => doc().layers[i] as T;
  const save = (tokens: KitTokens) => saveItem({ subjectId: kitId, mode: 'overwrite', space: 'library', by: 'user', tokens });

  const reset = () => {
    const s = createSession('Alpha Test');
    useStore.setState({ sessions: { [s.id]: s }, activeSessionId: s.id, library: [], assets: {}, generations: {} });
    return s.id;
  };

  beforeEach(async () => {
    blobs.clear();
    localStorage.clear();
    sid = reset();
    stop = installTokenSync();
    kitId = (await createItem({ name: 'Marea', kind: 'brand-kit', tokens: TOKENS, space: 'library', by: 'user' })).subject.id;
    setComposer({ kitId });
    docId = newBlankDoc(sid, { label: 'Poster', width: 200, height: 120 }).id;
    selectDoc(sid, docId);
    setUi({ workspace: 'designer', home: false });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    document.body.innerHTML = '';
    stop();
    setComposer({ kitId: null });
  });

  it('picks an alpha token from InlineColor, KitPage swatches and palette on text, shapes, stops, strokes, brush and FX', async () => {
    const kit = useStore.getState().library.find((s) => s.id === kitId)!;
    expect(kitColors(kit)).toContain('#0a4d6880');

    const tid = addTextLayer(sid, docId, 'Hola', { x: 10, y: 10, width: 120 }, {})!;
    await act(async () => root.render(createElement(TextLayerFields, { layer: layer<TextLayer>(0), onChange: (p) => patchLayer(sid, docId, tid, p) })));
    await act(async () => { host.querySelector<HTMLElement>('.opt-color')!.click(); });
    await act(async () => { document.body.querySelector<HTMLElement>('button[aria-label="glass"]')!.click(); });
    expect(layer<TextLayer>(0)).toMatchObject({ color: '#0a4d68', colorOpacity: 0.5, opacity: 1, colorToken: { kit: kitId, token: 'glass', value: '#0a4d6880' } });

    // In-place TextEditor reflects colorOpacity without touching layer.opacity.
    await act(async () => root.render(createElement(TextEditor, { layer: layer<TextLayer>(0), view: { x: 0, y: 0, zoom: 1 }, onDone: () => undefined })));
    const editorColor = host.querySelector<HTMLTextAreaElement>('textarea.text-editor')!.style.color;
    expect(editorColor).toMatch(/rgba\(\s*10,\s*77,\s*104|#0a4d6880/i);

    // Shape solid fill + gradient stop via PaintSwatch.
    const vid = addVectorLayer(sid, docId, [{ type: 'rect', x: 10, y: 10, w: 60, h: 40, fill: '#ffffff', stroke: '#000000', strokeWidth: 2, radius: 0 }])!;
    const s0 = () => (doc().layers.find((l) => l.id === vid) as VectorLayer).shapes[0];
    await act(async () => root.render(createElement(PaintSwatch, { sessionId: sid, docId, layerId: vid, shape: s0(), side: 'fill' })));
    await act(async () => { host.querySelector<HTMLElement>('.opt-color')!.click(); });
    await act(async () => { document.body.querySelector<HTMLElement>('button[aria-label="glass"]')!.click(); });
    expect(s0()).toMatchObject({ fill: '#0a4d68', fillOpacity: 0.5, fillToken: { token: 'glass', value: '#0a4d6880' } });

    // Switch to Linear gradient inside the open PaintSwatch popover, then pick `glass` for the first stop.
    await act(async () => { document.body.querySelector<HTMLElement>('button[aria-label="Linear gradient"]')!.click(); });
    await act(async () => root.render(createElement(PaintSwatch, { sessionId: sid, docId, layerId: vid, shape: s0(), side: 'fill' })));
    await act(async () => { document.body.querySelector<HTMLElement>('button[aria-label="glass"]')!.click(); });
    expect(s0().fillGradient!.stops[0]).toMatchObject({ color: '#0a4d68', alpha: 0.5, colorToken: { token: 'glass', value: '#0a4d6880' } });

    // StrokeStyleFields on a lineart stroke.
    let strokeStyle = { ...DEFAULT_STROKE_STYLE };
    await act(async () => root.render(createElement(StrokeStyleFields, { value: strokeStyle, onChange: (p) => { strokeStyle = { ...strokeStyle, ...p }; } })));
    await act(async () => { host.querySelector<HTMLElement>('.opt-color')!.click(); });
    await act(async () => { document.body.querySelector<HTMLElement>('button[aria-label="glass"]')!.click(); });
    expect(strokeStyle).toMatchObject({ color: '#0a4d68', opacity: 0.5, colorToken: { token: 'glass', value: '#0a4d6880' } });

    // KitPage Colors swatch: applies to picked shape, active text, and tool defaults (including brush color + opacity).
    patchShape(sid, docId, vid, s0().id, { fill: '#ffffff', fillOpacity: undefined, fillGradient: undefined });
    setObjectPick(docId, { layerId: vid, ids: [s0().id] });
    await act(async () => root.render(createElement(KitPage, { item: kit, chrome: null, menu: null, cover: () => undefined, onBack: () => undefined, onOpen: () => undefined, onDesign: () => undefined })));
    await act(async () => { [...host.querySelectorAll<HTMLElement>('.kit-tile')].find((b) => b.textContent?.includes('Colors'))!.click(); });
    const glassSwatch = () => host.querySelector<HTMLElement>('button.kit-swatch[aria-label^="glass "]')!;
    await act(async () => { glassSwatch().click(); });
    expect(s0()).toMatchObject({ fill: '#0a4d68', fillOpacity: 0.5, fillToken: { token: 'glass', value: '#0a4d6880' } });

    setObjectPick(docId, { layerId: vid, ids: [] });
    mutateDoc(sid, docId, (d) => ({ ...d, activeLayerId: null }));
    await act(async () => { glassSwatch().click(); });
    expect(useStore.getState().ui.brush).toMatchObject({ color: '#0a4d68', opacity: 0.5 });
    expect(useStore.getState().ui.text).toMatchObject({ color: '#0a4d68', colorOpacity: 0.5 });
    expect(useStore.getState().ui.lineart).toMatchObject({ color: '#0a4d68', opacity: 0.5 });

    // BrushSettings & opaque-only FX color: store #rrggbb only; Page color (CanvasSize) does not offer alpha tokens.
    setUi({ brush: { ...useStore.getState().ui.brush, color: '#ffffff', opacity: 1 } });
    await act(async () => root.render(createElement(BrushSettings, { erase: false, compact: true })));
    await act(async () => { host.querySelector<HTMLElement>('.opt-color')!.click(); });
    await act(async () => { document.body.querySelector<HTMLElement>('button[aria-label="glass"]')!.click(); });
    expect(useStore.getState().ui.brush).toMatchObject({ color: '#0a4d68', opacity: 0.5 });

    let fxColor = '#ffffff';
    await act(async () => root.render(createElement(InlineColor, { label: 'Glow', value: fxColor, onChange: (v) => { fxColor = v; } })));
    await act(async () => { host.querySelector<HTMLElement>('.opt-color')!.click(); });
    await act(async () => { document.body.querySelector<HTMLElement>('button[aria-label="glass"]')!.click(); });
    expect(fxColor).toBe('#0a4d68');

    await act(async () => root.render(createElement(CanvasSize, { sessionId: sid, doc: doc(), inline: true })));
    await act(async () => { host.querySelector<HTMLElement>('.opt-color')!.click(); });
    expect(document.body.querySelector('button[aria-label="sea"]')).toBeTruthy();
    expect(document.body.querySelector('button[aria-label="glass"]')).toBeNull();
  });

  it('syncs alpha tokens across edits, Default/Dark modes, opaque↔transparent transitions and undo', async () => {
    const glass = tokenChoices('color').find((c) => c.label === 'glass')!;
    const sea = tokenChoices('color').find((c) => c.label === 'sea')!;
    expect(glass.ref.value).toBe('#0a4d6880');

    addTextLayer(sid, docId, 'Title', { x: 0, y: 0, width: 100 }, { color: '{glass}' });
    const vid = addVectorLayer(sid, docId, [{
      type: 'rect', x: 0, y: 0, w: 50, h: 50, fill: '{glass}', stroke: '{sea}', strokeWidth: 2, radius: 0,
      strokeGradient: { kind: 'linear', x1: 0, y1: 0, x2: 50, y2: 0, stops: [{ offset: 0, color: '{glass}', alpha: 1 }, { offset: 1, color: '#ffffff', alpha: 1 }] },
    }])!;
    patchLayer(sid, docId, vid, { strokes: [newStroke([[0, 0, 0.5], [20, 20, 0.5]], { ...DEFAULT_STROKE_STYLE, color: '{glass}' }, true)] } as Partial<VectorLayer>);

    expect(layer<TextLayer>(0)).toMatchObject({ color: '#0a4d68', colorOpacity: 0.5 });
    expect(layer<VectorLayer>(1).shapes[0]).toMatchObject({ fill: '#0a4d68', fillOpacity: 0.5, stroke: '#0a4d68' });
    expect(layer<VectorLayer>(1).shapes[0].strokeGradient!.stops[0]).toMatchObject({ color: '#0a4d68', alpha: 0.5 });
    expect(layer<VectorLayer>(1).strokes![0]).toMatchObject({ color: '#0a4d68', opacity: 0.5 });

    // Mode Dark -> #88ccee40 (25%), undo back to Default (#0a4d6880, 50%).
    mutateDoc(sid, docId, (d) => ({ ...d, tokenMode: 'Dark' }));
    expect(layer<TextLayer>(0)).toMatchObject({ color: '#88ccee', colorOpacity: 0.25 });
    expect(layer<VectorLayer>(1).shapes[0]).toMatchObject({ fill: '#88ccee', fillOpacity: 0.25, stroke: '#88ccee' });
    expect(layer<VectorLayer>(1).shapes[0].strokeGradient!.stops[0]).toMatchObject({ color: '#88ccee', alpha: 0.25 });
    expect(layer<VectorLayer>(1).strokes![0]).toMatchObject({ color: '#88ccee', opacity: 0.25 });
    undoDoc(sid, docId);
    expect(layer<TextLayer>(0)).toMatchObject({ color: '#0a4d68', colorOpacity: 0.5 });

    // Transparent -> opaque (even with the SAME RGB #0a4d68!) clears the opacity put by the token;
    // simultaneously opaque `sea` -> transparent `#ff550040` sets strokeOpacity = 0.25.
    void sea;
    await save({ sea: { type: 'color', value: '#ff550040' }, glass: { type: 'color', value: '#0a4d68' } });
    expect(layer<TextLayer>(0).color).toBe('#0a4d68');
    expect(layer<TextLayer>(0).colorOpacity).toBeUndefined();
    expect(layer<VectorLayer>(1).shapes[0].fillOpacity).toBeUndefined();
    expect(layer<VectorLayer>(1).shapes[0]).toMatchObject({ stroke: '#ff5500', strokeOpacity: 0.25 });
    expect(layer<VectorLayer>(1).shapes[0].strokeGradient!.stops[0]).toMatchObject({ color: '#0a4d68', alpha: 1 });
    expect(layer<VectorLayer>(1).strokes![0]).toMatchObject({ color: '#0a4d68', opacity: 1 });
  });

  it('unlinks an 8-digit token when opacity is changed by hand, while a 6-digit token keeps its link with manual opacity', async () => {
    const tid = addTextLayer(sid, docId, 'Glass', { x: 0, y: 0, width: 100 }, { color: '{glass}' })!;
    const vid = addVectorLayer(sid, docId, [
      { type: 'rect', x: 0, y: 0, w: 40, h: 40, fill: '{glass}', stroke: null, strokeWidth: 0, radius: 0 },
      { type: 'rect', x: 50, y: 0, w: 40, h: 40, fill: '{sea}', stroke: null, strokeWidth: 0, radius: 0 },
    ])!;
    const sh = (i: number) => (doc().layers.find((l) => l.id === vid) as VectorLayer).shapes[i];

    // Manual opacity on 8-digit token unlinks both text and shape.
    patchLayer(sid, docId, tid, { colorOpacity: 0.8 });
    patchShape(sid, docId, vid, sh(0).id, paintOpacityPatch('fill', 0.8));
    expect(tokenOf(layer<TextLayer>(0), 'color')).toBeUndefined();
    expect(tokenOf(sh(0), 'fill')).toBeUndefined();

    // Manual opacity on 6-digit token `sea` does NOT unlink.
    patchShape(sid, docId, vid, sh(1).id, paintOpacityPatch('fill', 0.35));
    expect(tokenOf(sh(1), 'fill')?.token).toBe('sea');

    await save({ sea: { type: 'color', value: '#dd2244' }, glass: { type: 'color', value: '#11aa5540' } });
    expect(layer<TextLayer>(0)).toMatchObject({ color: '#0a4d68', colorOpacity: 0.8 });
    expect(sh(0)).toMatchObject({ fill: '#0a4d68', fillOpacity: 0.8 });
    expect(sh(1)).toMatchObject({ fill: '#dd2244', fillOpacity: 0.35 });

    // Undo restores the 8-digit link, which immediately syncs to today's token value (#11aa5540).
    undoDoc(sid, docId); // undo sh(1) opacity
    undoDoc(sid, docId); // undo sh(0) opacity
    expect(sh(0)).toMatchObject({ fill: '#11aa55', fillOpacity: 0.25 });
  });

  it('persists across kit version save/reload and serialized session state, keeping live sync afterwards', async () => {
    addTextLayer(sid, docId, 'Saved', { x: 10, y: 10, width: 120 }, { color: '{glass}' });
    addVectorLayer(sid, docId, [{ type: 'rect', x: 10, y: 40, w: 80, h: 40, fill: '{glass}', stroke: null, strokeWidth: 0, radius: 0 }]);

    await saveItem({ subjectId: kitId, mode: 'overwrite', space: 'designer', by: 'user', sessionId: sid, docId });
    // Simulate reload: drop open docs and deserialize saved snapshot into a fresh session.
    useStore.setState((st) => ({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], docs: [], activeDocId: null } } }));
    const opened = await libraryToDesigner(sid, kitId);
    const reloaded = JSON.parse(JSON.stringify(getDoc(sid, opened.id)!));
    expect(reloaded.layers[0]).toMatchObject({ color: '#0a4d68', colorOpacity: 0.5, colorToken: { token: 'glass', value: '#0a4d6880' } });
    expect(reloaded.layers[1].shapes[0]).toMatchObject({ fill: '#0a4d68', fillOpacity: 0.5, fillToken: { token: 'glass', value: '#0a4d6880' } });

    await saveItem({ subjectId: kitId, mode: 'overwrite', space: 'library', by: 'user', tokens: { ...TOKENS, glass: { type: 'color', value: '#cc3366bf' } } });
    expect(getDoc(sid, opened.id)!.layers[0]).toMatchObject({ color: '#cc3366', colorOpacity: 0.75 });
  });

  it('renders colorOpacity on the canvas and exports it to SVG (live text + paths) and PDF without using layer.opacity', async () => {
    await save({ ...TOKENS, glass: { type: 'color', value: '#0a4d6866' } }); // 40%
    const tid = addTextLayer(sid, docId, 'Alpha', { x: 10, y: 10, width: 150 }, { color: '{glass}', underline: true, fontFamily: 'Inter', fontWeight: 400 })!;
    addVectorLayer(sid, docId, [{ type: 'rect', x: 10, y: 60, w: 80, h: 40, fill: '{glass}', stroke: null, strokeWidth: 0, radius: 0 }]);
    expect(layer<TextLayer>(0)).toMatchObject({ color: '#0a4d68', colorOpacity: 0.4, opacity: 1 });

    // Canvas drawDoc applies colorOpacity during fillText and restores globalAlpha afterwards.
    const alphas: number[] = [];
    let ga = 1;
    const fakeCtx = {
      canvas: { width: 200, height: 120 }, get globalAlpha() { return ga; }, set globalAlpha(v: number) { ga = v; },
      globalCompositeOperation: 'source-over', fillStyle: '', strokeStyle: '', font: '', textBaseline: 'top', textAlign: 'left',
      save() {}, restore() {}, beginPath() {}, rect() {}, roundRect() {}, clip() {}, fill() {}, stroke() {}, setTransform() {}, getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      fillText() { alphas.push(ga); },
      fillRect() { alphas.push(ga); },
    } as unknown as CanvasRenderingContext2D;
    drawDoc(fakeCtx, { ...doc(), background: null });
    expect(alphas).toEqual([0.4, 0.4]);
    void tid;

    // SVG live text & SVG text-as-paths.
    const deps: SvgDeps = { rasterHref: async () => null, layout: layoutText, ascent: textAscent, fontFile: async () => inter };
    const liveSvg = await docToSvg(doc(), deps, undefined, { hidden: false });
    expect(liveSvg).toMatch(/<text [^>]*fill="#0a4d68"[^>]*fill-opacity="0.4"/);
    expect(liveSvg).toMatch(/<rect [^>]*fill="#0a4d68"[^>]*fill-opacity="0.4"/);
    expect(liveSvg).not.toMatch(/inkscape:label="Alpha"[^>]*opacity=/);

    const pathSvg = await docToSvg(doc(), deps, undefined, { hidden: false, text: 'paths' });
    expect(pathSvg).toContain('<g fill="#0a4d68" fill-opacity="0.4"><path ');

    // PDF from both live text SVG and outlined SVG writes a 0.4 fill alpha graphics state (/ca 0.4).
    const decodePdf = async (svg: string) => new TextDecoder('latin1').decode(await (await svgToPdf(svg, 200, 120)).arrayBuffer());
    expect(await decodePdf(liveSvg)).toMatch(/\/ca 0\.4\b/);
    expect(await decodePdf(pathSvg)).toMatch(/\/ca 0\.4\b/);
  });

  it('resolves "{token}" written by the agent across text, shapes, gradient stops and strokes, and refuses alpha on page background', async () => {
    const res = await runCommandsTool(sid, {
      seq: [
        { cmd: 'designer.layer.add_text', args: { text: 'Agent', x: 10, y: 10, width: 120, style: { color: '{glass}' } } },
        { cmd: 'designer.layer.add_shapes', args: { shapes: [{ type: 'rect', x: 10, y: 40, w: 60, h: 30, fill: '{glass}', stroke: '{glass}', stroke_width: 2 }] } },
      ],
    });
    expect(res.done).toBe(true);
    expect(layer<TextLayer>(0)).toMatchObject({ color: '#0a4d68', colorOpacity: 0.5, colorToken: { token: 'glass', value: '#0a4d6880' } });
    expect(layer<VectorLayer>(1).shapes[0]).toMatchObject({ fill: '#0a4d68', fillOpacity: 0.5, stroke: '#0a4d68', strokeOpacity: 0.5 });

    await applyLayerStep(sid, docId, {
      id: 's1', kind: 'layer', title: 'Strokes & gradient', layerType: 'vector', target: 'new',
      shapes: [{
        type: 'rect', x: 0, y: 0, w: 40, h: 40, fill: null, stroke: null, strokeWidth: 0, radius: 0,
        fillGradient: { kind: 'linear', x1: 0, y1: 0, x2: 40, y2: 0, stops: [{ offset: 0, color: '{glass}', alpha: 1 }, { offset: 1, color: '#ffffff', alpha: 1 }] },
      }],
      strokes: [{ points: [[0, 0, 0.5], [30, 30, 0.5]], pressure: true, color: '{glass}', size: 6 }],
    }, null);
    expect(layer<VectorLayer>(2).shapes[0].fillGradient!.stops[0]).toMatchObject({ color: '#0a4d68', alpha: 0.5, colorToken: { token: 'glass' } });
    expect(layer<VectorLayer>(2).strokes![0]).toMatchObject({ color: '#0a4d68', opacity: 0.5, colorToken: { token: 'glass' } });

    const badBg = await runCommandsTool(sid, { seq: [{ cmd: 'designer.doc.new', args: { width: 200, height: 200, background: '{glass}' } }] });
    expect(badBg.done).toBe(false);
  });
});
