import type { Realism } from './realism';

/*
 * Capture styles: how the shot was taken, written as CTLT (camera, tone, light, texture) so a look can be chosen,
 * changed in one field, combined with video directives and saved. Applied by realism.withRealism after its guards.
 */

export interface Ctlt { camera: string; tone: string; light: string; texture: string }
/** A style made by the user ("Mis estilos"): CTLT plus the imperfections it asks for. */
export interface CaptureCustom extends Ctlt { imperfect?: string[] }
/** What a step or the composer selects. `style` is a preset id; `custom` carries a saved style inline. */
export interface CaptureSel { style?: string; tone?: string; directives?: string[]; imperfect?: string[]; custom?: CaptureCustom }

export interface CapturePreset extends Ctlt {
  id: string;
  label: string;
  /** Where it makes sense; absent: both. */
  only?: 'image' | 'video';
  /** Imperfections this style asks for by itself (the clean ones have none). */
  imperfect?: string[];
  cadence?: string;
}
/** Older registers shown in the same selector: they set realism / shot, not a capture. */
export interface LegacyPreset { id: string; label: string; realism: Realism; shot?: string }

export const TONES = [
  'candid, not meant to be seen',
  'intimate, quiet',
  'raw, high-energy',
  'spontaneous, chaotic',
  'tense, voyeuristic',
  'nostalgic, warm',
  'deadpan, mundane',
  'casual, personal',
] as const;

export const LEGACY_PRESETS: readonly LegacyPreset[] = [
  { id: 'ugc', label: 'UGC', realism: 'ugc' },
  { id: 'everyday', label: 'Cotidiano (móvil)', realism: 'everyday' },
  { id: 'street', label: 'Calle', realism: 'cinematic', shot: 'street' },
];

export const CAPTURE_PRESETS: readonly CapturePreset[] = [
  { id: 'skate', label: 'Foto skate de cerca', camera: '12 mm fisheye, camera low and close to the ground, crooked tilted horizon, subject large in the foreground, slight motion blur', tone: 'raw, high-energy', light: 'harsh midday sun with hard shadows', texture: 'contrasty, slightly oversharpened, lens flare at the edges' },
  { id: 'documentary', label: 'Documental íntimo', camera: '35 mm handheld at eye level, close natural framing, subject unaware of the lens, slight focus drift', tone: 'intimate, quiet', light: 'available window or lamp light', texture: 'fine grain, real skin texture, no retouching' },
  { id: 'photodump', label: 'Foto movida (photo dump)', only: 'image', camera: 'phone shot taken mid-movement, tilted, off-center framing, strong motion blur', tone: 'spontaneous, chaotic', light: 'mixed ambient light, night street or club', texture: 'smeared highlights, sensor noise' },
  { id: 'curbside', label: 'Bordillo bajo', camera: '28 mm, camera at curb level looking up, slightly tilted', tone: 'candid, not meant to be seen', light: 'available daylight with hard shadows', texture: 'gritty asphalt detail, mild grain' },
  { id: 'disposable', label: 'Desechable con flash', only: 'image', imperfect: ['timestamp'], camera: 'disposable film camera, fixed 31 mm lens, direct framing, slight tilt', tone: 'spontaneous, chaotic', light: 'hard on-camera flash against the wall, dark falloff behind the subject', texture: 'film grain, soft focus, slightly washed colors, light leaks' },
  { id: 'concealed', label: 'Observación oculta', camera: 'long lens from a distance, partly obstructed foreground, off-center framing, no eye contact', tone: 'candid, not meant to be seen', light: 'available light', texture: 'slight noise, soft focus' },
  { id: 'phone', label: 'Foto de móvil', camera: 'phone main camera, wide lens, casual framing', tone: 'casual, personal', light: 'available light', texture: 'small-sensor noise, mild computational HDR look', cadence: '30 fps phone cadence' },
  { id: 'camcorder', label: 'Camcorder de baja calidad', imperfect: ['timestamp', 'lowres', 'compression'], camera: 'low-quality consumer camcorder, 4:3 framing, fixed wide lens, handheld', tone: 'nostalgic, warm', light: 'available light with auto-exposure pumping', texture: 'interlaced softness, color bleed', cadence: '30 fps camcorder cadence' },
  { id: 'selfie', label: 'Selfie iPhone', camera: 'front-facing phone camera at arm\'s length, slightly above eye level, wide-angle face distortion', tone: 'casual, personal', light: 'available light with screen glow', texture: 'smooth phone processing, mild noise', cadence: '30 fps phone cadence' },
];

export const DIRECTIVES: ReadonlyArray<{ id: string; label: string; clause: string }> = [
  { id: 'shake', label: 'Micro-temblor de mano', clause: 'subtle handheld micro-shake' },
  { id: 'crash-zoom', label: 'Crash zoom', clause: 'sudden crash zoom toward the subject' },
  { id: 'voyeur', label: 'Voyeurista', clause: 'voyeuristic framing from a distance, partly obstructed, as if filmed secretly' },
  { id: 'whip-pan', label: 'Whip pan', clause: 'whip pan with a motion-blurred streak to the next subject' },
  { id: 'backwards', label: 'Caminar hacia atrás', clause: 'camera walking backwards ahead of the subject, bouncing handheld' },
  { id: 'blocking', label: 'Alguien cruza el objetivo', clause: 'someone briefly crosses the lens and blocks the frame' },
  { id: 'exposure', label: 'Ajuste de exposición', clause: 'exposure adjusts as the camera moves from indoors to outdoors, brief blown highlights that settle' },
  { id: 'focus-hunt', label: 'Búsqueda de foco', clause: 'focus hunting: the lens racks in and out before locking' },
];

export const IMPERFECTIONS: ReadonlyArray<{ id: string; label: string; image: string; video: string }> = [
  { id: 'timestamp', label: 'Marca de fecha', image: 'orange date stamp burned into the lower-right corner', video: 'burned-in orange date and time stamp in the lower-right corner' },
  { id: 'lowres', label: 'Baja resolución', image: 'intentionally low resolution, soft detail', video: 'intentionally low resolution, soft detail' },
  { id: 'compression', label: 'Artefactos de compresión', image: 'visible JPEG compression artifacts', video: 'visible compression artifacts, blocky gradients' },
];

export const presetById = (id?: string) => CAPTURE_PRESETS.find((p) => p.id === id);
export const legacyById = (id?: string) => LEGACY_PRESETS.find((p) => p.id === id);
export const presetsFor = (kind: 'image' | 'video') => CAPTURE_PRESETS.filter((p) => !p.only || p.only === kind);

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const ids = (v: unknown, known: ReadonlyArray<{ id: string }>) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && known.some((k) => k.id === x)))] : undefined);

/** A selection from the agent or from storage, reduced to what the app knows; undefined when nothing is left. */
export function cleanCapture(raw: unknown): CaptureSel | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const style = str(r.style, 60);
  const c = r.custom as Record<string, unknown> | undefined;
  const custom = c && str(c.camera, 300) ? { camera: str(c.camera, 300)!, tone: str(c.tone, 120) ?? '', light: str(c.light, 200) ?? '', texture: str(c.texture, 200) ?? '', ...(ids(c.imperfect, IMPERFECTIONS)?.length ? { imperfect: ids(c.imperfect, IMPERFECTIONS) } : {}) } : undefined;
  const directives = ids(r.directives, DIRECTIVES);
  const imperfect = ids(r.imperfect, IMPERFECTIONS);
  const out: CaptureSel = {
    ...(style ? { style } : {}), ...(str(r.tone, 120) ? { tone: str(r.tone, 120) } : {}),
    ...(directives?.length ? { directives } : {}), ...(imperfect?.length ? { imperfect } : {}), ...(custom ? { custom } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

/** A style name that is not a preset ("con mi estilo X"): the user's saved style by name, inlined. */
export function resolveCapture(sel: CaptureSel | undefined, mine: ReadonlyArray<{ name: string; kind?: string; capture?: CaptureCustom }>): CaptureSel | undefined {
  if (!sel?.style || presetById(sel.style) || sel.custom) return sel;
  const name = sel.style.replace(/^@/, '').toLowerCase();
  const found = mine.find((s) => s.kind === 'style' && s.capture && s.name.toLowerCase() === name);
  if (!found?.capture) return cleanCapture({ ...sel, style: undefined });
  return { ...sel, style: found.name, custom: found.capture };
}

/** The CTLT a selection stands for. */
export function ctltOf(sel: CaptureSel): (Ctlt & { imperfect?: string[]; cadence?: string }) | undefined {
  const base = sel.custom ?? presetById(sel.style);
  if (!base) return undefined;
  return { ...base, tone: sel.tone || base.tone };
}

/** The clause added to a prompt: image or video, anchored video (starts from an image: no new look, only motion). */
export function captureClause(sel: CaptureSel, kind: 'image' | 'video', anchored = false): string | undefined {
  const c = ctltOf(sel);
  const dirs = kind === 'video' ? (sel.directives ?? []).map((d) => DIRECTIVES.find((x) => x.id === d)?.clause).filter(Boolean) as string[] : [];
  const imp = (sel.imperfect ?? c?.imperfect ?? []).map((i) => IMPERFECTIONS.find((x) => x.id === i)?.[kind]).filter(Boolean) as string[];
  if (!c && !dirs.length && !imp.length) return undefined;
  const mood = c?.tone ? `mood: ${c.tone}` : undefined;
  const cad = kind === 'video' && c ? (c as { cadence?: string } | undefined)?.cadence ?? '30 fps' : undefined;
  const parts = kind === 'image'
    ? [c?.camera, mood, c?.light, c?.texture, ...imp]
    : anchored ? [...dirs, mood, cad, ...imp] : [c?.camera, ...dirs, mood, c?.light, c?.texture, cad, ...imp];
  const text = parts.filter(Boolean).join(', ');
  return text ? `${text}.` : undefined;
}

/** CTLT (and imperfections) to save from a result: its own capture, else the sheet its register used. */
export function ctltFromSettings(s: { capture?: CaptureSel }, sheet?: { camera: string; light: string; texture: string }): CaptureCustom | undefined {
  const c = s.capture ? ctltOf(s.capture) : undefined;
  if (c) return { camera: c.camera, tone: c.tone, light: c.light, texture: c.texture, ...(s.capture?.imperfect ?? c.imperfect ? { imperfect: s.capture?.imperfect ?? c.imperfect } : {}) };
  return sheet ? { camera: sheet.camera, tone: 'natural, unposed', light: sheet.light, texture: sheet.texture } : undefined;
}

/** The step's selection with its saved style resolved, for the realism setting. */
export function withCaptureSetting<S extends object>(settings: S, kind: string, raw: unknown, mine: ReadonlyArray<{ name: string; kind?: string; capture?: CaptureCustom }> = []): S {
  if (kind !== 'image' && kind !== 'video') return settings;
  const capture = resolveCapture(cleanCapture(raw), mine);
  return capture ? { ...settings, capture } : settings;
}
