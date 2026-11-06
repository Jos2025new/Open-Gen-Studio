import { useStore } from '../../store/store';
import { combineFrom } from '../../engine/design/modifierGate';
import type { SelectCombine } from '../../engine/design/pixelSelection';
import type { Point, View } from '../../engine/design/viewCoordinates';

const BADGE: Record<SelectCombine, string | null> = { replace: null, add: '+', subtract: '−', intersect: '∩' };

/** The Select family's cursor badge: + adds, − subtracts, ∩ keeps the overlap. It shows what a press would do now (Mode, then Shift / Alt); nothing for New. */
export function SelectCursor({ tool, point, view, mods }: { tool: string; point: Point | null; view: View; mods: { shift: boolean; alt: boolean } }) {
  const mode = useStore((s) => s.ui.wand?.mode) ?? 'replace';
  const badge = tool === 'select' && point ? BADGE[combineFrom(mods, mode)] : null;
  if (!point || !badge) return null;
  return <div aria-hidden data-select-cursor={badge} style={{
    position: 'absolute', left: 0, top: 0, pointerEvents: 'none', width: 14, height: 14, display: 'grid', placeItems: 'center',
    borderRadius: '50%', font: '700 12px/1 system-ui, sans-serif', color: '#ffffff', background: '#16161a', border: '1px solid #ffffff',
    transform: `translate(${view.x + point.x * view.zoom + 10}px, ${view.y + point.y * view.zoom + 10}px)`,
  }}>{badge}</div>;
}
