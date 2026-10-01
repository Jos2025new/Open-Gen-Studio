import { FRONT_ORBIT } from '../../lib/model3dThumb';
import { applyView } from '../../lib/view3d';
export { applyView };
import { create } from 'zustand';
import { uploadFiles } from '../../engine/actions';
import { toast } from '../../store/store';

/** View-only settings of the open 3D viewer. Not persisted; they never touch the file. */
export interface View3D {
  exposure: number;
  environment: 'neutral' | 'legacy';
  texture: boolean;
  /** null = the model's own value. */
  roughness: number | null;
  metalness: number | null;
  grid: boolean;
  pan: boolean;
}
export const VIEW3D_DEFAULT: View3D = { exposure: 1, environment: 'neutral', texture: true, roughness: null, metalness: null, grid: false, pan: false };

/* eslint-disable @typescript-eslint/no-explicit-any */
type MV = HTMLElement & Record<string, any>;
/** `touched`: the user changed something since the model opened; only then is the view saved. */
export const useViewer3d = create<{ el: MV | null; view: View3D; touched: boolean }>(() => ({ el: null, view: VIEW3D_DEFAULT, touched: false }));
export const setView3d = (p: Partial<View3D>) => useViewer3d.setState((s) => ({ view: { ...s.view, ...p }, touched: true }));

export const VIEWS: Array<{ id: string; label: string; orbit: string }> = [
  { id: 'front', label: 'Front', orbit: '90deg 90deg auto' },
  { id: 'back', label: 'Back', orbit: '-90deg 90deg auto' },
  { id: 'left', label: 'Left', orbit: '0deg 90deg auto' },
  { id: 'right', label: 'Right', orbit: '180deg 90deg auto' },
  { id: 'top', label: 'Top', orbit: '90deg 0deg auto' },
  { id: 'bottom', label: 'Bottom', orbit: '90deg 180deg auto' },
];

export function setOrbit(orbit: string): void {
  const el = useViewer3d.getState().el;
  if (!el) return;
  useViewer3d.setState({ touched: true });
  el.cameraOrbit = orbit;
  el.cameraTarget = 'auto auto auto';
  el.fieldOfView = 'auto';
}
export function resetView(): void {
  setOrbit(FRONT_ORBIT);
}
export function zoomBy(step: number): void {
  useViewer3d.setState({ touched: true });
  useViewer3d.getState().el?.zoom?.(step);
}

export async function snapshot3d(): Promise<void> {
  const el = useViewer3d.getState().el;
  if (!el?.toBlob) return;
  try {
    const blob: Blob = await el.toBlob({ mimeType: 'image/png' });
    const ids = await uploadFiles([new File([blob], '3d-snapshot.png', { type: 'image/png' })]);
    if (ids.length) toast('Snapshot saved to Gallery', 'success');
  } catch {
    toast('Could not take the snapshot', 'error');
  }
}

/** With Pan on, a left drag moves the camera target instead of orbiting. */
export function panHandler(el: MV): () => void {
  const down = (e: PointerEvent) => {
    if (e.button !== 0 || !useViewer3d.getState().view.pan) return;
    e.stopPropagation();
    e.preventDefault();
    let x = e.clientX, y = e.clientY;
    const move = (m: PointerEvent) => {
      const o = el.getCameraOrbit(), t = el.getCameraTarget();
      const fov = (el.getFieldOfView() * Math.PI) / 180;
      const k = (2 * o.radius * Math.tan(fov / 2)) / el.clientHeight;
      const dx = (m.clientX - x) * k, dy = (m.clientY - y) * k;
      x = m.clientX; y = m.clientY;
      const st = Math.sin(o.theta), ct = Math.cos(o.theta), sp = Math.sin(o.phi), cp = Math.cos(o.phi);
      const r = [ct, 0, -st], u = [-cp * st, sp, -cp * ct];
      el.cameraTarget = `${t.x - r[0] * dx + u[0] * dy}m ${t.y - r[1] * dx + u[1] * dy}m ${t.z - r[2] * dx + u[2] * dy}m`;
      el.jumpCameraToGoal?.();
    };
    const up = () => { window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true); };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
  };
  el.addEventListener('pointerdown', down, true);
  return () => el.removeEventListener('pointerdown', down, true);
}
