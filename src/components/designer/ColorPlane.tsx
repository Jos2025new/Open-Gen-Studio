import { useEffect, useState, type PointerEvent } from 'react';

function hsv(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const v = Math.max(r, g, b), d = v - Math.min(r, g, b);
  const h = d === 0 ? 0 : ((v === r ? (g - b) / d : v === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360;
  return { h, s: v === 0 ? 0 : d / v, v };
}

function hex(h: number, s: number, v: number) {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  const rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + rgb.map((n) => Math.round((n + m) * 255).toString(16).padStart(2, '0')).join('');
}

export function ColorPlane({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const color = hsv(value);
  const [hue, setHue] = useState(color.h);
  useEffect(() => { const next = hsv(value); if (next.s > 0) setHue(next.h); }, [value]);
  const point = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const s = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const v = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
    onChange(hex(hue, s, v));
  };
  return <div className="color-plane-controls">
    <div className="color-plane" role="button" tabIndex={0} aria-label={`Color saturation and brightness, ${Math.round(color.s * 100)} and ${Math.round(color.v * 100)} percent`} style={{ backgroundColor: `hsl(${hue} 100% 50%)` }}
      onPointerDown={(e) => { if (e.button !== 0) return; e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); point(e); }}
      onPointerMove={(e) => { if (e.buttons & 1) point(e); }}
      onKeyDown={(e) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
        e.preventDefault();
        const step = e.shiftKey ? 0.1 : 0.01;
        const s = Math.min(1, Math.max(0, color.s + (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0)));
        const v = Math.min(1, Math.max(0, color.v + (e.key === 'ArrowDown' ? -step : e.key === 'ArrowUp' ? step : 0)));
        onChange(hex(hue, s, v));
      }}>
      <span className="color-plane-point" style={{ left: `${color.s * 100}%`, top: `${(1 - color.v) * 100}%` }} />
    </div>
    <input className="color-hue" type="range" min={0} max={359} step={1} aria-label="Hue" value={Math.min(359, Math.round(hue))} onChange={(e) => { const next = Number(e.target.value); setHue(next); onChange(hex(next, color.s, color.v)); }} />
  </div>;
}
