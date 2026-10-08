import { useStore } from '../../store/store';
import { OPS } from '../ops';
import { aspectOfShape, fitOp, pluralAngles } from './fit';
import { detectOps, normalizeRequest, OP_TRIGGERS, OP_WEAK, sequenceNames } from './triggers';

/*
 * The keyword gate. A request's words name operations (triggers.ts: a deterministic score of associated words, Spanish
 * and English, in request order: n1_reference-sheet, n2_create-voice). An operation fires when three things hold: it
 * is named, its input is attached to the request, and its required parameters can be read from the text (fit.ts and
 * the extractors below). A fired operation reaches the agent with the request as the signal to follow its route: the
 * operation as an op step, in request order, the agent writing only prompts and instructions. Nothing is sent to the
 * provider. A request that fires nothing (no mapped keyword, or a condition missing) follows the general workflow.
 */

export interface GatedOp {
  op: string;
  /** Its place in the request's sequence: n1_reference-sheet. */
  seq: string;
  phrase: string;
  fired: boolean;
  /** The attached input it runs on: asset:<id>. */
  input?: string;
  /** Parameters read from the request (the rest keep the operation's defaults). */
  params: Record<string, string>;
  /** Why it does not fire, or what Direct decided without asking. */
  note?: string;
}

const get = useStore.getState;

/** Light presets of relight, from the words that name them. */
const PRESETS: Array<[string, RegExp]> = [
  ['golden-hour', /\b(golden hour|hora dorada|atardecer|amanecer|sunset|sunrise|calida|warm)\b/],
  ['softbox', /\b(estudio|studio|softbox|suave|soft)\b/],
  ['overcast', /\b(nublad\w*|overcast|cloudy|difusa|diffuse)\b/],
  ['rim', /\b(contraluz|rim|backlit|backlight|borde)\b/],
  ['neon', /\b(neon)\b/],
  ['candle', /\b(vela|velas|candle\w*)\b/],
  ['moonlight', /\b(luna|lunar|moonlight|noche|nocturna|night)\b/],
  ['chiaroscuro', /\b(claroscuro|chiaroscuro|dramatica|dramatic)\b/],
];

/** Which frame: first, last, or a second ("segundo 3", "at 4 seconds"). */
function frameOf(s: string): Record<string, string> | undefined {
  const at = s.match(/\b(?:segundo|second|seg)\s*(\d+(?:[.,]\d+)?)\b|\b(\d+(?:[.,]\d+)?)\s*(?:segundos?|seconds?|s)\b/);
  if (at) return { which: 'time', seconds: (at[1] ?? at[2]).replace(',', '.') };
  if (/\b(primer|primero|first|inicial|inicio)\b/.test(s)) return { which: 'first' };
  if (/\b(ultimo|last|final)\b/.test(s)) return { which: 'last' };
  return undefined;
}

/** What the gate reads of an attached input: its kind, and its size, length and origin when known. */
export interface GateInput { id: string; kind?: string; width?: number; height?: number; duration?: number; generationId?: string }

/** The grid of an image to cut: named in the request, or known from the contact sheet that made it. */
function gridOf(s: string, input: GateInput): string | undefined {
  if (/\b2\s*x\s*3\b|\b3\s*x\s*2\b|\bseis\b|\bsix\b|\b6\b/.test(s)) return '2x3';
  if (/\b2\s*x\s*2\b|\bcuatro\b|\bfour\b/.test(s)) return '2';
  if (/\b3\s*x\s*3\b|\bnueve\b|\bnine\b/.test(s)) return '3';
  const gen = get().generations[input.generationId ?? ''];
  if (gen?.op?.id === 'contact_sheet') return String(gen.op.params.angles) === '6' ? '2x3' : '3';
  return undefined;
}

/** The operations a request names, in order, each fired or not with its reason, for the given attachments and mode. */
export function gateOps(text: string, inputs: GateInput[], direct: boolean): GatedOp[] {
  const s = normalizeRequest(text);
  const ops = detectOps(text);
  const seqs = sequenceNames(ops);
  const assets = inputs.map((a) => ({ id: a.id, a }));
  const imageOpsFired = new Set<string>();
  const out = ops.map((op, i): GatedOp => {
    const phrase = [...(OP_TRIGGERS[op] ?? []), ...(OP_WEAK[op] ?? [])].map((re) => re.exec(s)?.[0]).find(Boolean) ?? op;
    const def = OPS[op as keyof typeof OPS];
    const sources = assets.filter((x) => x.a.kind === def.input);
    const src = sources[0];
    const base = { op, seq: seqs[i], phrase, params: {} as Record<string, string> };
    if (!src) return { ...base, fired: false, note: op === 'create_voice' ? 'needs an audio sample of 5–30 s: ask for it' : `needs ${def.input === 'image' ? 'an image' : `a ${def.input}`} attached to the request` };
    const input = `asset:${src.id}`;
    const fire = (params: Record<string, string> = {}, note?: string): GatedOp => ({ ...base, fired: true, input, params, ...(note ? { note } : {}) });
    const hold = (note: string): GatedOp => ({ ...base, fired: false, input, note });
    switch (op) {
      case 'angle':
        if (pluralAngles(text)) return direct ? fire({}, '3 angle steps, one per angle (Direct does not ask how many)') : hold('several angles with no number: ask how many');
        break;
      case 'relight': {
        const preset = PRESETS.find(([, re]) => re.test(s))?.[0];
        return preset ? fire({ preset }) : hold('no light preset fits the request: decide whether it is a relight');
      }
      case 'extract_frame': {
        const frame = frameOf(s);
        return frame ? fire(frame) : hold('which frame: the first, the last or a second?');
      }
      case 'grid_split': {
        const grid = gridOf(s, src.a);
        return grid ? fire({ grid }) : hold('which grid to cut: 2×2, 3×3 or 2×3?');
      }
      case 'join_clips':
        return sources.length >= 2 ? fire() : hold('needs two or more clips attached');
      case 'create_voice': {
        const d = src.a.duration;
        return d && (d < 5 || d > 30) ? hold(`the sample lasts ${Math.round(d)} s; it needs 5–30 s`) : fire();
      }
    }
    if (['angle', 'reframe', 'upscale', 'reference_sheet', 'contact_sheet'].includes(op)) {
      const a = src.a;
      const fit = fitOp(op, text, { sourceLongEdge: a.width && a.height ? Math.max(a.width, a.height) : undefined, sourceAspect: a.width && a.height ? aspectOfShape(a.width / a.height) : undefined });
      if (fit.ok) return fire(fit.params);
      if (fit.ambiguous && direct) return fire(fit.fallback ?? {}, `Direct does not ask: ${fit.reason}`);
      return hold(fit.ambiguous ? `ambiguous, ask: ${fit.reason}` : `does not fit: ${fit.reason}; say so and do not use it`);
    }
    return fire();
  });
  // edit is the catch-all: it fires only when no specific operation fired on the same image.
  for (const g of out) if (g.fired && g.op !== 'edit' && g.input && OPS[g.op as keyof typeof OPS].input === 'image') imageOpsFired.add(g.input);
  return out.map((g) => (g.op === 'edit' && g.fired && g.input && imageOpsFired.has(g.input) ? { ...g, fired: false, note: 'a specific operation already covers this image' } : g));
}

/** The signal the agent reads with the request: the fired operations and their route, in order. Nothing otherwise. */
export function steerNote(gated: GatedOp[], confirmFirst = false): string {
  const fired = gated.filter((g) => g.fired);
  if (!fired.length) return '';
  const params = (p: Record<string, string>) => (Object.keys(p).length ? ` {${Object.entries(p).map(([k, v]) => `${k}: ${v}`).join(', ')}}` : '');
  return `This request fires, in order: ${fired.map((g) => `${g.seq} ${g.op} on ${g.input}${params(g.params)}${g.note ? ` (${g.note})` : ''}`).join('; ')}.\nYou MUST follow this route now: ${confirmFirst ? 'confirm_settings first (kind image: the model these operations run on), then ' : ''}propose_plan with these op steps in this order, writing only their notes or instructions and any step the request adds. These operations need no workflow and no guide: do not call read_guide for them.\n\n`;
}
