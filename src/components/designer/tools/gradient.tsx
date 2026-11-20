import { getDoc } from '../../../engine/design/actions';
import { useStore, setUi } from '../../../store/store';
import { applyGradient, GRADIENT_DEFAULT } from '../../../engine/design/gradient';
import { snapAngle } from '../../../engine/design/selectGeometry';
import { ColorPair } from '../ColorPair';
import { InlineSelect, InlineSlider, InlineToggle } from '../InlineControls';
import type { GestureMap, PointerPress, ToolDescriptor, ToolSettingsProps } from './types';

function beginGradient({ state, p }: PointerPress) {
  const { drag, setPreview } = state;
  drag.current = { kind: 'gradient', x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  setPreview(drag.current);
}
const gestures = {
  gradient: {
    move({ state: { setPreview }, d, e, p }) {
      // Shift: the line snaps to 45° steps, as in SAI.
      const q = e.shiftKey ? snapAngle({ x: d.x0, y: d.y0 }, p) : p;
      d.x1 = q.x;
      d.y1 = q.y;
      setPreview({ ...d });
    },
    up({ state, d }) {
      const { setPreview, view, sessionId, doc, gradientSpec } = state;
      setPreview(null);
      if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) * view.zoom < 4) return;
      const current = getDoc(sessionId, doc.id);
      if (current) applyGradient(sessionId, current, gradientSpec, d.x0, d.y0, d.x1, d.y1);
    },
  },
} satisfies Partial<GestureMap>;

function GradientSettings({ compact }: ToolSettingsProps) {
  const gradient = useStore((s) => s.ui.gradient);
  const g = gradient ?? GRADIENT_DEFAULT;
  const set = (patch: Partial<typeof g>) => setUi({ gradient: { ...g, ...patch } });
  return <div className="tool-settings" role="toolbar" aria-label="Gradient settings">
    <InlineSelect label="Shape" value={g.shape} options={[{ value: 'linear' as const, label: 'Linear' }, { value: 'radial' as const, label: 'Radial' }]} onChange={(v) => set({ shape: v })} />
    <ColorPair dimSecondary={g.mode !== 'two'} />
    <InlineSelect label="To" value={g.mode} options={[{ value: 'two' as const, label: 'Second color' }, { value: 'fade' as const, label: 'Transparent' }]} onChange={(v) => set({ mode: v })} />
    {!compact && <InlineToggle label="Reverse" checked={!!g.reverse} onChange={(v) => set({ reverse: v })} />}
    <InlineSlider label="Opacity" unit="%" scale={100} min={0.01} max={1} step={0.01} value={g.opacity} onChange={(v) => set({ opacity: v })} />
  </div>;
}

export const gradient = {
  down: beginGradient,
  gestures,
  quick: ['gradientShape', 'gradientOpacity', 'gradientColors', 'gradientReverse'],
  settings: GradientSettings,
  bareSettings: true,
  contextTarget: () => 'new layer',
} satisfies ToolDescriptor;
