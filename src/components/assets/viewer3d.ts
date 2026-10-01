import { FRONT_ORBIT } from '../../lib/model3dThumb';
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
export const useViewer3d = create<{ el: MV | null; view: View3D }>(() => ({ el: null, view: VIEW3D_DEFAULT }));
export const setView3d = (p: Partial<View3D>) => useViewer3d.setState((s) => ({ view: { ...s.view, ...p } }));

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
  el.cameraOrbit = orbit;
  el.cameraTarget = 'auto auto auto';
  el.fieldOfView = 'auto';
}
export function resetView(): void {
  setOrbit(FRONT_ORBIT);
}
export function zoomBy(step: number): void {
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

/** The model's original material values, so "auto" and texture on can restore them. */
const originals = new WeakMap<object, { tex: unknown; mr: unknown; r: number; m: number }>();

export function applyView(el: MV, v: View3D): void {
  el.exposure = v.exposure;
  el.environmentImage = v.environment;
  for (const mat of el.model?.materials ?? []) {
    const pbr = mat.pbrMetallicRoughness;
    if (!originals.has(mat)) originals.set(mat, { tex: pbr.baseColorTexture?.texture ?? null, mr: pbr.metallicRoughnessTexture?.texture ?? null, r: pbr.roughnessFactor, m: pbr.metallicFactor });
    const o = originals.get(mat)!;
    pbr.baseColorTexture?.setTexture(v.texture ? o.tex : null);
    // The metal/rough map multiplies the factors; a slider only works without it.
    const manual = v.roughness !== null || v.metalness !== null;
    pbr.metallicRoughnessTexture?.setTexture(manual ? null : o.mr);
    pbr.setRoughnessFactor(v.roughness ?? o.r);
    pbr.setMetallicFactor(v.metalness ?? o.m);
  }
  applyGrid(el, v.grid);
}

/** A flat line grid under the model, built as a tiny inline glTF. */
let gridUrl: string | undefined;
function gridSrc(): string {
  if (gridUrl) return gridUrl;
  const n = 10, pts: number[] = [];
  for (let i = -n; i <= n; i++) pts.push(i / n, 0, -1, i / n, 0, 1, -1, 0, i / n, 1, 0, i / n);
  const buf = new Float32Array(pts);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf.buffer)));
  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.5, 0.5, 0.55, 1], metallicFactor: 0, roughnessFactor: 1 }, extensions: { KHR_materials_unlit: {} } }],
    extensionsUsed: ['KHR_materials_unlit'],
    buffers: [{ byteLength: buf.byteLength, uri: `data:application/octet-stream;base64,${b64}` }],
    bufferViews: [{ buffer: 0, byteLength: buf.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: pts.length / 3, type: 'VEC3', min: [-1, 0, -1], max: [1, 0, 1] }],
  };
  gridUrl = URL.createObjectURL(new Blob([JSON.stringify(gltf)], { type: 'model/gltf+json' }));
  return gridUrl;
}

function applyGrid(el: MV, on: boolean): void {
  let g = el.querySelector('extra-model') as MV | null;
  if (!on) return void g?.remove();
  if (!el.getDimensions) return;
  const d = el.getDimensions(), c = el.getBoundingBoxCenter();
  const size = Math.max(d.x, d.z) * 1.5;
  if (!g) {
    g = document.createElement('extra-model') as MV;
    g.setAttribute('background', '');
    g.setAttribute('src', gridSrc());
    el.append(g);
  }
  g.setAttribute('scale', `${size} 1 ${size}`);
  g.setAttribute('offset', `${c.x} ${c.y - d.y / 2} ${c.z}`);
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
