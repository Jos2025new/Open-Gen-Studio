import { sleep } from '../../../lib/http';
import { blobToCanvas, canvasToBlob, createCanvas, ctx2d } from '../../../lib/media';
import { hashString } from '../../../lib/rng';
import { dimsFor, ratioOf } from '../../params';
import type { ModelSchema, ModelSummary } from '../../types';
import type { GenOutput, GenRequest, GenResult, ProviderAdapter } from '../types';
import { drawScene, paletteFor, withAlpha } from './art';
import { recordCanvas } from './motion';
import { changeAngle, promptEdit, reframe, relight, removeBackground, stylize, upscale, variation } from './ops';

export const LOCAL_IMAGE_REF = 'local::studio-image';
export const LOCAL_VIDEO_REF = 'local::studio-video';

const FREE = { skus: [{ unit: 'output' as const, usd: 0 }] };

const MODELS: ModelSummary[] = [
  {
    ref: LOCAL_IMAGE_REF,
    provider: 'local',
    id: 'studio-image',
    name: 'Local Sketch',
    kind: 'image',
    acceptsText: true,
    acceptsImage: true,
    tags: ['demo'],
    description: 'Procedural images rendered in your browser. Free, instant, for trying the workflow without API keys.',
    price: FREE,
  },
  {
    ref: LOCAL_VIDEO_REF,
    provider: 'local',
    id: 'studio-video',
    name: 'Local Motion',
    kind: 'video',
    acceptsText: true,
    acceptsImage: true,
    tags: ['demo'],
    description: 'Animated clips recorded in your browser in real time. Free, for trying the workflow without API keys.',
    price: FREE,
  },
];

const SCHEMAS: Record<string, ModelSchema> = {
  [LOCAL_IMAGE_REF]: {
    ref: LOCAL_IMAGE_REF,
    source: 'builtin',
    price: FREE,
    slots: { prompt: 'prompt', promptRequired: true, images: { key: 'refs', max: 4, min: 0, multiple: true, format: 'data-url' } },
    params: [
      { key: 'aspect_ratio', label: 'Aspect ratio', role: 'aspect', type: 'enum', options: ['1:1', '4:5', '3:4', '2:3', '9:16', '16:9', '3:2', '21:9'], default: '1:1' },
      { key: 'resolution', label: 'Resolution', role: 'resolution', type: 'enum', options: ['1K', '2K'], default: '1K' },
      { key: 'n', label: 'Images', role: 'count', type: 'integer', min: 1, max: 4, default: 1 },
      { key: 'seed', label: 'Seed', role: 'seed', type: 'integer' },
    ],
  },
  [LOCAL_VIDEO_REF]: {
    ref: LOCAL_VIDEO_REF,
    source: 'builtin',
    price: FREE,
    slots: { prompt: 'prompt', promptRequired: false, firstFrame: { key: 'first_frame', format: 'data-url' } },
    params: [
      { key: 'aspect_ratio', label: 'Aspect ratio', role: 'aspect', type: 'enum', options: ['16:9', '9:16', '1:1'], default: '16:9' },
      { key: 'resolution', label: 'Resolution', role: 'resolution', type: 'enum', options: ['480p', '720p'], default: '720p' },
      { key: 'duration', label: 'Duration', role: 'duration', type: 'enum', options: [3, 5, 8], default: 5 },
      { key: 'seed', label: 'Seed', role: 'seed', type: 'integer' },
    ],
  },
};

function imageDims(aspect: string | undefined, resolution: string | undefined): { width: number; height: number } {
  const ratio = ratioOf(aspect) ?? 1;
  return dimsFor(ratio, resolution === '2K' ? 1536 : 1024);
}

function videoDims(aspect: string | undefined, resolution: string | undefined): { width: number; height: number } {
  const ratio = ratioOf(aspect) ?? 16 / 9;
  const d = dimsFor(ratio, resolution === '480p' ? 854 : 1280);
  // Encoders prefer even dimensions.
  return { width: d.width - (d.width % 2), height: d.height - (d.height % 2) };
}

async function runOp(req: GenRequest): Promise<GenOutput[]> {
  const src = req.refs[0];
  if (!src) throw new Error('This operation needs a source image');
  const canvas = await blobToCanvas(src.blob);
  const op = req.op!;
  const outputs: GenOutput[] = [];
  for (let i = 0; i < req.count; i++) {
    let out: HTMLCanvasElement;
    switch (op.id) {
      case 'relight':
        out = relight(canvas, op.params);
        break;
      case 'angle':
        out = changeAngle(canvas, op.params);
        break;
      case 'upscale':
        out = upscale(canvas, op.params);
        break;
      case 'remove_bg':
        out = removeBackground(canvas);
        break;
      case 'reframe':
        out = reframe(canvas, op.params);
        break;
      case 'variations':
        out = variation(canvas, op.params, i);
        break;
      default:
        out = promptEdit(canvas, req.prompt);
    }
    const png = op.id === 'remove_bg';
    const blob = await canvasToBlob(out, png ? 'image/png' : 'image/jpeg', png ? undefined : 0.92);
    outputs.push({ blob, mime: blob.type });
  }
  return outputs;
}

export const local: ProviderAdapter = {
  id: 'local',
  label: 'Local demo',

  async listModels() {
    return MODELS;
  },

  async loadSchema(model) {
    const s = SCHEMAS[model.ref];
    if (!s) throw new Error(`Unknown local model ${model.ref}`);
    return s;
  },

  async generate(req: GenRequest): Promise<GenResult> {
    const seed = req.settings.seed ?? hashString(req.prompt || 'untitled');
    if (req.kind === 'image') {
      req.onStatus('Rendering');
      await sleep(450 + Math.random() * 500, req.signal);
      if (req.op) return { outputs: await runOp(req), costUsd: 0 };
      const { width, height } = imageDims(req.settings.aspect, req.settings.resolution);
      const base = req.refs[0] ? await blobToCanvas(req.refs[0].blob) : null;
      const outputs: GenOutput[] = [];
      for (let i = 0; i < req.count; i++) {
        let c: HTMLCanvasElement;
        if (base) {
          c = stylize(base, req.prompt, seed + i, width, height);
        } else {
          c = createCanvas(width, height);
          drawScene(ctx2d(c), width, height, req.prompt, seed + i * 7919);
        }
        const blob = await canvasToBlob(c, 'image/jpeg', 0.92);
        outputs.push({ blob, mime: 'image/jpeg' });
        req.onStatus(`Rendering ${i + 1}/${req.count}`, (i + 1) / req.count);
      }
      return { outputs, costUsd: 0 };
    }

    const { width, height } = videoDims(req.settings.aspect, req.settings.resolution);
    const seconds = req.settings.duration ?? 5;
    const frame = req.firstFrame ? await blobToCanvas(req.firstFrame.blob) : null;
    const pal = paletteFor(req.prompt, seed);
    const blob = await recordCanvas({
      width,
      height,
      seconds,
      signal: req.signal,
      onProgress: (p) => req.onStatus(`Recording ${Math.round(p * seconds)}/${seconds}s`, p),
      draw: (ctx, t) => {
        if (!frame) {
          drawScene(ctx, width, height, req.prompt, seed, t);
          return;
        }
        // Image-to-video: slow push-in with a moving light sweep.
        const cover = Math.max(width / frame.width, height / frame.height) * (1 + 0.12 * t);
        const dw = frame.width * cover;
        const dh = frame.height * cover;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(frame, (width - dw) / 2 - t * width * 0.02, (height - dh) / 2, dw, dh);
        const sweepX = -width * 0.5 + t * width * 2;
        const g = ctx.createLinearGradient(sweepX - width * 0.3, 0, sweepX + width * 0.3, height);
        g.addColorStop(0, withAlpha(pal.light, 0));
        g.addColorStop(0.5, withAlpha(pal.light, 0.18));
        g.addColorStop(1, withAlpha(pal.light, 0));
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';
      },
    });
    return { outputs: [{ blob, mime: blob.type }], costUsd: 0 };
  },
};
