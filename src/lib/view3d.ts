import type { SavedView3D } from '../engine/types';

/* Applying a 3D look (light, material, grid) to a <model-viewer>; shared by the viewer and the view-image render. */

/* eslint-disable @typescript-eslint/no-explicit-any */
type MV = HTMLElement & Record<string, any>;
type Look = Pick<SavedView3D, 'exposure' | 'environment' | 'texture' | 'roughness' | 'metalness' | 'grid'>;

/** Timing of 3D saves and renders: warns when slow; everything with localStorage['ogs.debug3d']='1'. */
export function debug3d(label: string, ms: number): void {
  let on = false;
  try { on = localStorage.getItem('ogs.debug3d') === '1'; } catch { /* storage blocked */ }
  if (ms > 1500) console.warn(`[3d] ${label}: ${Math.round(ms)} ms`);
  else if (on) console.info(`[3d] ${label}: ${Math.round(ms)} ms`);
}

/** The model's original material values, so "auto" and texture on can restore them. */
const originals = new WeakMap<object, { tex: unknown; mr: unknown; r: number; m: number }>();

export function applyView(el: MV, v: Look): void {
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


/** Where the camera is now, as attribute strings model-viewer accepts back. */
export function readCamera(el: MV): Pick<SavedView3D, 'orbit' | 'target' | 'fov'> {
  const o = el.getCameraOrbit(), t = el.getCameraTarget();
  return { orbit: `${o.theta}rad ${o.phi}rad ${o.radius}m`, target: `${t.x}m ${t.y}m ${t.z}m`, fov: `${el.getFieldOfView()}deg` };
}

export function setCamera(el: MV, v: Pick<SavedView3D, 'orbit' | 'target' | 'fov'>): void {
  el.cameraOrbit = v.orbit;
  el.cameraTarget = v.target;
  el.fieldOfView = v.fov;
  el.jumpCameraToGoal?.();
}
