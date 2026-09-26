/** Local limits bound allocation before decoding a provider model or archive. */
export const MAX_MODEL_BYTES = 128 * 1024 * 1024;
export const GLB_MIME = 'model/gltf-binary';
export function modelMime(name: string): string | undefined {
  const ext = name.split(/[?#]/)[0].split('.').pop()?.toLowerCase();
  return ({ glb: GLB_MIME, fbx: 'application/vnd.autodesk.fbx', zip: 'application/zip', obj: 'model/obj', usdz: 'model/vnd.usdz+zip', usd: 'model/vnd.usd' } as Record<string, string>)[ext ?? ''];
}

export async function validateGlb(blob: Blob): Promise<void> {
  if (blob.size > MAX_MODEL_BYTES) throw new Error('3D file exceeds 128 MB. Download the original to open it elsewhere.');
  const buffer = await blob.arrayBuffer();
  const view = new DataView(buffer);
  if (buffer.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength) throw new Error('Invalid GLB 2.0 file.');
  const n = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || n > buffer.byteLength - 20) throw new Error('Invalid GLB scene.');
  const scene = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, n))) as { buffers?: { uri?: string }[]; images?: { uri?: string }[] };
  if ([...(scene.buffers ?? []), ...(scene.images ?? [])].some((r) => r.uri && !r.uri.startsWith('data:'))) throw new Error('GLB must embed its resources; external texture/buffer URLs are not loaded.');
}

export async function unpackModel(blob: Blob): Promise<Blob> {
  if (blob.size > MAX_MODEL_BYTES) throw new Error('3D archive exceeds 128 MB.');
  const { unzip } = await import('fflate');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let count = 0, size = 0, unsafe = false;
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(bytes, { filter: (f) => {
      count++; size += f.originalSize;
      if (/(^|[\\/])\.\.([\\/]|$)/.test(f.name) || /^([\\/]|[a-z]:)/i.test(f.name)) { unsafe = true; return false; }
      if (count > 64 || size > MAX_MODEL_BYTES) return false;
      return /\.glb$/i.test(f.name);
    } }, (err, result) => err ? reject(err) : resolve(result));
  });
  if (unsafe) throw new Error('3D archive contains an unsafe path.');
  if (count > 64 || size > MAX_MODEL_BYTES) throw new Error('3D archive expands beyond the allowed limit.');
  const models = Object.values(files);
  if (models.length !== 1) throw new Error('Expected exactly one GLB in the archive. The original ZIP remains downloadable.');
  const glb = new Blob([models[0] as Uint8Array<ArrayBuffer>], { type: GLB_MIME });
  await validateGlb(glb);
  return glb;
}

/**
 * The real type of a downloaded 3D result, from its first bytes: providers send models as
 * application/octet-stream and name files loosely, and a preview render must not become a model.
 */
export async function sniffModelMime(blob: Blob, hint?: string): Promise<string> {
  const head = new Uint8Array(await blob.slice(0, 20).arrayBuffer());
  const ascii = String.fromCharCode(...head);
  if (ascii.startsWith('glTF')) return GLB_MIME;
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return hint === 'model/vnd.usdz+zip' ? hint : 'application/zip';
  if (ascii.startsWith('Kaydara FBX Binary')) return 'application/vnd.autodesk.fbx';
  if (head[0] === 0x89 && ascii.slice(1, 4) === 'PNG') return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
  if (ascii.slice(4, 8) === 'ftyp') return 'video/mp4';
  if (hint && hint !== 'application/octet-stream') return hint;
  return blob.type && blob.type !== 'application/octet-stream' ? blob.type : 'application/octet-stream';
}

/**
 * NanoGPT prices 3D runs per option set (`per_run_by_variant`). The key is rebuilt from the settings,
 * with the catalog defaults when an option is left unset. Unknown model → undefined (priced approximately).
 */
export function variant3dKey(modelId: string, adv: Record<string, unknown>): string | undefined {
  if (modelId === 'wavespeed-ai/trellis-2/image-to-3d') {
    return `${String(adv.resolution ?? '1024')}${String(adv.texture_size ?? '2048') === '4096' ? '+4k-texture' : ''}`;
  }
  if (modelId.startsWith('meshy/v7.1/')) {
    const textured = adv.should_texture !== false && adv.mode !== 'preview';
    const rig = adv.enable_rigging === true ? (adv.enable_animation === true ? 'rigged:animated' : 'rigged') : 'static';
    return `${textured ? 'textured' : 'untextured'}:${String(adv.geometry_resolution ?? 'standard')}:${rig}`;
  }
  if (modelId === 'bytedance/seed3d-2.0') return 'default';
  return undefined;
}
