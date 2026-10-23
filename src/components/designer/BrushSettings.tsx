import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { lastPressure, onPressure } from '../../engine/design/brushStroke';
import { setUi, useStore } from '../../store/store';
import { atPressure, taperAt, BRUSH_BLENDS, BRUSH_DEFAULTS, BRUSH_TEXTURES, hexRgb, profile, textureAt, SIZE_PRESETS, stampSegment, TIP_PRESETS, tipFor, type BrushBlend, type BrushTexture } from '../../engine/design/brushEngine';
import { Circle, Droplet } from 'lucide-react';
import { InlineChoice, InlineColor, InlineSelect, InlineSlider, InlineToggle } from './InlineControls';

/*
 * Brush and eraser settings, after PaintTool SAI's brush panel, in the app's own fields (one slider, one toggle,
 * one choice for every tool). What each value does is shown, not described: the preview is drawn by the same
 * engine that paints (design/brushEngine.ts), and the tip icons are its hardness curve.
 */

type Brush = ReturnType<typeof useStore.getState>['ui']['brush'];

/** The hardness curve as a small bump: what the tip does from its centre to its rim. */
export function TipIcon({ hardness }: { hardness: number }) {
  const pts = Array.from({ length: 25 }, (_, i) => {
    const x = i / 24, d = Math.abs(x - 0.5) * 2;
    return `${(x * 22 + 1).toFixed(1)},${(13 - profile(d * 10, 10, hardness) * 11).toFixed(1)}`;
  });
  return <svg width="24" height="14" viewBox="0 0 24 14" aria-hidden="true"><polygon points={`1,13 ${pts.join(' ')} 23,13`} fill="currentColor" /></svg>;
}

/** A stroke drawn with the current settings, light to full pressure and back, the way the canvas will paint it. */
function BrushPreview({ brush, erase }: { brush: Brush; erase: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current, ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    // Big sizes are drawn at 40 % of the preview's height, so the stroke's shape still shows; Size gives the value.
    const size = Math.min(brush.size, Math.round(H * 0.4));
    const tip = tipFor({ ...brush, size }, erase);
    const img = ctx.createImageData(W, H), rgb = erase ? ([200, 200, 200] as [number, number, number]) : hexRgb(brush.color);
    const n = 48, pt = (i: number) => { const t = i / n; return [12 + t * (W - 24), H / 2 + Math.sin(t * Math.PI * 2) * (H / 2 - size / 2 - 4) * 0.6, Math.sin(t * Math.PI)] as const; };
    // The tapers as the canvas lays them: in px along the stroke, at the preview's scale of the size.
    const k = size / brush.size, along = [0];
    for (let i = 0; i < n; i++) { const [ax, ay] = pt(i), [bx, by] = pt(i + 1); along.push(along[i] + Math.hypot(bx - ax, by - ay)); }
    let last: { width: number; density: number } | undefined;
    for (let i = 0; i < n; i++) {
      const [ax, ay] = pt(i), [bx, by, p] = pt(i + 1);
      const { width: full, density } = atPressure({ ...brush, size }, p);
      const width = full * taperAt(along[i + 1], (brush.taperStart ?? 0) * k, 'start') * taperAt(along[n] - along[i + 1], (brush.taperEnd ?? 0) * k, 'end');
      stampSegment(img, 0, 0, [ax, ay, bx, by, width], density, tip, rgb, last ?? { width: full * taperAt(0, (brush.taperStart ?? 0) * k, 'start'), density });
      last = { width, density };
    }
    const mask = document.createElement('canvas');
    mask.width = W; mask.height = H;
    mask.getContext('2d')!.putImageData(img, 0, 0);
    ctx.globalAlpha = brush.opacity;
    ctx.drawImage(mask, 0, 0);
    ctx.globalAlpha = 1;
  }, [brush, erase]);
  return <canvas ref={ref} className="brush-preview" width={260} height={56} aria-label="Stroke preview with a pen: light to full pressure and back" title="With a pen: light to full pressure and back" role="img" />;
}

/** The loaded texture as a small disc, drawn by the engine's own texture; none = an empty disc with a red slash. */
function TextureIcon({ texture }: { texture: BrushTexture }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(36, 36);
    for (let y = 0; y < 36; y++) for (let x = 0; x < 36; x++) {
      const v = Math.round(60 + 170 * textureAt(texture, x * 2, y * 2)), i = (y * 36 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [texture]);
  if (texture === 'none') return <span className="texture-icon is-none" aria-hidden="true" />;
  return <canvas ref={ref} className="texture-icon" width={36} height={36} aria-hidden="true" />;
}

/** One-click sizes: each dot is the size it sets (capped to fit), as in SAI's size grid. */
function SizePresets({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return <div className="opt opt-presets" role="radiogroup" aria-label="Size presets">
    {SIZE_PRESETS.map((s) => <button key={s} type="button" role="radio" aria-checked={s === value} aria-label={`${s} px`} className={s === value ? 'is-on' : ''} onClick={() => onChange(s)}>
      <i style={{ width: Math.max(2, Math.min(18, Math.sqrt(s) * 1.7)), height: Math.max(2, Math.min(18, Math.sqrt(s) * 1.7)) }} /><span className="num">{s}</span>
    </button>)}
  </div>;
}

/** What the last stroke received: a pen with pressure, or a device without (then pressure settings do nothing). */
function PressureReadout() {
  const r = useSyncExternalStore(onPressure, lastPressure);
  const text = !r ? 'Pressure: paint once to see what your device sends'
    : r.pressure === null ? `No pressure from your ${r.device}: it paints at full size and density. Use a pen for pressure.`
    : `Pressure from your ${r.device}: ${Math.round(r.pressure * 100)} %`;
  return <p className={`opt-hint brush-pressure${r && r.pressure === null ? ' is-warn' : ''}`} role="status">{text}</p>;
}

export function BrushSettings({ erase, compact = false }: { erase: boolean; compact?: boolean }) {
  const brush = useStore((s) => s.ui.brush);
  const set = (patch: Partial<Brush>) => setUi({ brush: { ...brush, ...patch } });
  const hardness = brush.hardness ?? BRUSH_DEFAULTS.hardness;
  const tipIndex = TIP_PRESETS.findIndex((h) => Math.abs(h - hardness) < 0.005);
  // Pressure curves and Keep Opacity: hidden until asked for.
  const [advanced, setAdvanced] = useState(false);
  if (compact) return <>
    <InlineSlider label="Size" unit="px" min={1} max={240} value={brush.size} onChange={(v) => set({ size: v })} />
    {!erase && <InlineColor label="Color" value={brush.color} onChange={(v) => set({ color: v })} alpha={{ value: brush.opacity, onChange: (o) => set({ opacity: Math.max(0.01, o) }) }} />}
    <InlineSlider label="Opacity" unit="%" scale={100} min={0.01} max={1} step={0.01} value={brush.opacity} onChange={(v) => set({ opacity: v })} />
    {/* Smoothing and Stabilize live in the Tool tab: set once, not touched every stroke. */}
  </>;
  return <>
    <BrushPreview brush={brush} erase={erase} />
    <SizePresets value={brush.size} onChange={(v) => set({ size: v })} />
    <div className="brush-row">
      {!erase && <InlineColor label="Color" iconOnly value={brush.color} onChange={(v) => set({ color: v })} alpha={{ value: brush.opacity, onChange: (o) => set({ opacity: Math.max(0.01, o) }) }} />}
      <InlineSlider label="Size" icon={<Circle size={13} />} unit="px" min={1} max={240} value={brush.size} onChange={(v) => set({ size: v })} />
      <InlineSlider label="Opacity" icon={<Droplet size={13} />} unit="%" scale={100} min={0.01} max={1} step={0.01} value={brush.opacity} onChange={(v) => set({ opacity: v })} />
      <InlineSelect label="Texture" icon={<TextureIcon texture={brush.texture ?? 'none'} />} value={brush.texture ?? 'none'} options={BRUSH_TEXTURES} onChange={(v) => set({ texture: v as BrushTexture, textureStrength: v !== 'none' && !brush.textureStrength ? BRUSH_DEFAULTS.textureStrength : brush.textureStrength })} />
    </div>
    {brush.texture && brush.texture !== 'none' && <InlineSlider label="Texture strength" unit="%" scale={100} min={0} max={1} step={0.01} value={brush.textureStrength ?? 0} onChange={(v) => set({ textureStrength: v })} />}
    <div className="brush-row">
      <InlineSlider label="Taper start" allowManualOverflow unit="px" min={0} max={500} value={brush.taperStart ?? 0} onChange={(v) => set({ taperStart: v })} />
      <InlineSlider label="Taper end" allowManualOverflow unit="px" min={0} max={500} value={brush.taperEnd ?? 0} onChange={(v) => set({ taperEnd: v })} />
    </div>
    <div className="brush-row">
      <InlineSlider label="Stabilize" min={0} max={10} value={brush.stabilization ?? 0} onChange={(v) => set({ stabilization: v })} />
      <InlineSlider label="Smoothing" min={0} max={10} value={brush.smoothing ?? 0} onChange={(v) => set({ smoothing: v })} />
    </div>
    {!erase && <div className="brush-row"><InlineSelect label="Blend" value={brush.blend ?? 'normal'} options={BRUSH_BLENDS.map((b) => ({ value: b, label: b[0].toUpperCase() + b.slice(1) }))} onChange={(v) => set({ blend: v as BrushBlend })} /></div>}
    <InlineChoice label="Tip" value={tipIndex} options={TIP_PRESETS.map((h, i) => ({ value: i, label: ['Hard', 'Firm', 'Soft', 'Airbrush'][i], render: <TipIcon hardness={h} /> }))} onChange={(i) => set({ hardness: TIP_PRESETS[i] })} />
    <InlineSlider label="Hardness" unit="%" scale={100} min={0} max={1} step={0.01} value={hardness} onChange={(v) => set({ hardness: v })} />
    <InlineToggle label="Mirror" tip="Every stroke is also painted reflected across the page's vertical centre line" checked={!!brush.mirror} onChange={(v) => set({ mirror: v })} />
    <InlineToggle label="Simulate pressure" tip="Pressure from your speed, as Lineart does it: fast strokes paint lighter and thinner" checked={!!brush.simulatePressure} onChange={(v) => set({ simulatePressure: v })} />
    {brush.simulatePressure && <InlineSlider label="Speed influence" unit="%" scale={100} min={0.25} max={2} step={0.05} value={brush.pressureSpeed ?? 1} onChange={(v) => set({ pressureSpeed: v })} />}
    {/* Only without simulation: then a missing pen pressure matters. */}
    {!brush.simulatePressure && <PressureReadout />}
    <InlineToggle label="Advanced settings" checked={advanced} onChange={setAdvanced} />
    {advanced && <>
      <InlineToggle label="Pressure → size" tip="Lighter pressure paints thinner, down to the minimum size" checked={brush.pressureSize !== false} onChange={(v) => set({ pressureSize: v })} />
      <InlineSlider label="Min size" unit="%" scale={100} min={0} max={1} step={0.01} disabled={brush.pressureSize === false} value={brush.minSize ?? BRUSH_DEFAULTS.minSize} onChange={(v) => set({ minSize: v })} />
      <InlineToggle label="Pressure → density" tip="Lighter pressure paints fainter, down to the minimum density" checked={!!brush.pressureDensity} onChange={(v) => set({ pressureDensity: v })} />
      <InlineSlider label="Min density" unit="%" scale={100} min={0} max={1} step={0.01} disabled={!brush.pressureDensity} value={brush.minDensity ?? BRUSH_DEFAULTS.minDensity} onChange={(v) => set({ minDensity: v })} />
      {!erase && <InlineToggle label="Keep opacity" tip="Paint only where the layer already has pixels; transparent areas stay transparent" checked={!!brush.keepOpacity} onChange={(v) => set({ keepOpacity: v })} />}
    </>}
  </>;
}
