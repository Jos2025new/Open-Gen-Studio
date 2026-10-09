import { useEffect, useRef, useSyncExternalStore } from 'react';
import { lastPressure, onPressure } from '../../engine/design/brushStroke';
import { setUi, useStore } from '../../store/store';
import { atPressure, BRUSH_BLENDS, BRUSH_DEFAULTS, BRUSH_TEXTURES, hexRgb, profile, SIZE_PRESETS, stampSegment, TIP_PRESETS, tipFor, type BrushBlend, type BrushTexture } from '../../engine/design/brushEngine';
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
    for (let i = 0; i < n; i++) {
      const [ax, ay] = pt(i), [bx, by, p] = pt(i + 1);
      const { width, density } = atPressure({ ...brush, size }, p);
      stampSegment(img, 0, 0, [ax, ay, bx, by, width], density, tip, rgb);
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
  if (compact) return <>
    <InlineSlider label="Size" unit="px" min={1} max={240} value={brush.size} onChange={(v) => set({ size: v })} />
    {!erase && <InlineColor label="Color" value={brush.color} onChange={(v) => set({ color: v })} />}
    <InlineSlider label="Opacity" unit="%" scale={100} min={0.01} max={1} step={0.01} value={brush.opacity} onChange={(v) => set({ opacity: v })} />
    <InlineSlider label="Smoothing" min={0} max={10} value={brush.smoothing ?? 0} onChange={(v) => set({ smoothing: v })} />
    <InlineSlider label="Stabilize" min={0} max={10} value={brush.stabilization ?? 0} onChange={(v) => set({ stabilization: v })} />
  </>;
  return <>
    <BrushPreview brush={brush} erase={erase} />
    <InlineSlider label="Size" unit="px" min={1} max={240} value={brush.size} onChange={(v) => set({ size: v })} />
    {!erase && <InlineColor label="Color" value={brush.color} onChange={(v) => set({ color: v })} />}
    <SizePresets value={brush.size} onChange={(v) => set({ size: v })} />
    <InlineSlider label="Opacity" unit="%" scale={100} min={0.01} max={1} step={0.01} value={brush.opacity} onChange={(v) => set({ opacity: v })} />
    {!erase && <InlineSelect label="Blend" value={brush.blend ?? 'normal'} options={BRUSH_BLENDS.map((b) => ({ value: b, label: b[0].toUpperCase() + b.slice(1) }))} onChange={(v) => set({ blend: v as BrushBlend })} />}
    <InlineChoice label="Tip" value={tipIndex} options={TIP_PRESETS.map((h, i) => ({ value: i, label: ['Hard', 'Firm', 'Soft', 'Airbrush'][i], render: <TipIcon hardness={h} /> }))} onChange={(i) => set({ hardness: TIP_PRESETS[i] })} />
    <InlineSlider label="Hardness" unit="%" scale={100} min={0} max={1} step={0.01} value={hardness} onChange={(v) => set({ hardness: v })} />
    <InlineSelect label="Texture" value={brush.texture ?? 'none'} options={BRUSH_TEXTURES} onChange={(v) => set({ texture: v as BrushTexture, textureStrength: v !== 'none' && !brush.textureStrength ? BRUSH_DEFAULTS.textureStrength : brush.textureStrength })} />
    <InlineSlider label="Texture strength" unit="%" scale={100} min={0} max={1} step={0.01} disabled={!brush.texture || brush.texture === 'none'} value={brush.textureStrength ?? 0} onChange={(v) => set({ textureStrength: v })} />
    <InlineToggle label="Simulate pressure" tip="Pressure from your speed, as Lineart does it: fast strokes paint lighter and thinner" checked={!!brush.simulatePressure} onChange={(v) => set({ simulatePressure: v })} />
    {!brush.simulatePressure && <PressureReadout />}
    <InlineToggle label="Pressure → size" tip="With a pen, lighter pressure paints thinner, down to the minimum size" checked={brush.pressureSize !== false} onChange={(v) => set({ pressureSize: v })} />
    <InlineSlider label="Min size" unit="%" scale={100} min={0} max={1} step={0.01} disabled={brush.pressureSize === false} value={brush.minSize ?? BRUSH_DEFAULTS.minSize} onChange={(v) => set({ minSize: v })} />
    <InlineToggle label="Pressure → density" tip="With a pen, lighter pressure paints fainter, down to the minimum density" checked={!!brush.pressureDensity} onChange={(v) => set({ pressureDensity: v })} />
    <InlineSlider label="Min density" unit="%" scale={100} min={0} max={1} step={0.01} disabled={!brush.pressureDensity} value={brush.minDensity ?? BRUSH_DEFAULTS.minDensity} onChange={(v) => set({ minDensity: v })} />
    {!erase && <InlineToggle label="Keep opacity" tip="Paint only where the layer already has pixels; transparent areas stay transparent" checked={!!brush.keepOpacity} onChange={(v) => set({ keepOpacity: v })} />}
    <InlineSlider label="Smoothing" min={0} max={10} value={brush.smoothing ?? 0} onChange={(v) => set({ smoothing: v })} />
    <InlineSlider label="Stabilize" min={0} max={10} value={brush.stabilization ?? 0} onChange={(v) => set({ stabilization: v })} />
  </>;
}
