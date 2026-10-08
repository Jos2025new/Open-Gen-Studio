import { OPS, type OpField } from '../ops';
import type { AdvancedValue } from '../types';
import { normalizeRequest } from './triggers';

/*
 * Fitting a request to an operation's parameters. A trigger names an operation; these functions fill its parameters
 * from the request text and from the source image, so the operation runs with a value, never with a guess.
 *
 * A failure is one of two things. An impossibility (a place as a reference sheet, a camera angle already made) is
 * refused in every mode. An ambiguity (an Instagram format with no feed or stories, a sheet or one image per view) is
 * asked about in Auto and Guided; in Direct, which does not ask, it takes the fallback value, shown on the plan.
 */

export interface FitContext {
  /** Longest side of the source image in pixels, when the operation has an image input. */
  sourceLongEdge?: number;
  /** Aspect of the source image, as one of the reframe options ("4:5", "16:9"…), when known. */
  sourceAspect?: string;
  /** Angle values already produced from this source. */
  usedAngles?: string[];
  /** The grid of the source when a contact sheet made it ("3" for nine angles, "2x3" for six). */
  sourceGrid?: string;
}

export type FitResult =
  | { ok: true; params: Record<string, string>; note?: string }
  // agentSettles: the ambiguity is missing data, not the user's intent (the source size of an upscale), so a valid
  // value the agent gave settles it without a question.
  | { ok: false; reason: string; ambiguous?: boolean; fallback?: Record<string, string>; agentSettles?: boolean };

/** The parameters each operation's fit fills. A missing or invalid value for one of them is taken from the fit. */
export const FIT_KEYS: Record<string, string[]> = {
  angle: ['angle'],
  reframe: ['aspect'],
  upscale: ['factor'],
  reference_sheet: ['subject', 'panels'],
  contact_sheet: ['angles'],
  grid_split: ['grid'],
};

/** Camera angles, in the order a new one is picked when the request names none ("un ángulo diferente"). */
export const ANGLE_ORDER = ['three-quarter-left', 'profile-left', 'back', 'high', 'low', 'close-up', 'wide', 'three-quarter-right', 'profile-right', 'top-down', 'front'];

/** Reframe formats, from the operation's own options. */
export const ASPECT_OPTIONS: string[] = (OPS.reframe.fields.find((f) => f.key === 'aspect')?.options ?? []).map((o) => String(o.value));
const ASPECT_ORDER = ['4:5', '9:16', '1:1', '16:9', '3:4', '2:3', '3:2', '21:9'];

/** Instagram with no feed or stories named: the social default of the app's own guide (social.md: 9:16). */
const INSTAGRAM_DEFAULT = '9:16';

const CHANGE_WORDS = /\b(otro|otra|otros|distinto|distinta|diferente|nuevo|nueva|different|another|other|new)\b/;

/**
 * "Tres vistas, una imagen por vista": one image per view takes angle steps; a reference sheet is one image. It has to
 * say so about images or views: "separadas" alone ("poses separadas") describes the sheet, not one image per view.
 */
const PER_VIEW = /\b(por vista|per view|one image per view|(imagenes|fotos|vistas) (separadas|independientes|por separado)|separate (images|views)|cada vista (en|como) (una )?(imagen|foto))\b/;
/** A sheet is named: "hoja", "sheet", "turnaround", "referencias de personaje". */
const SHEET_CUE = /\b(hoja|sheet|turnaround|referencias? de (personaje|personajes|persona|objeto|producto))\b/;
/** The request counts views: "tres vistas", "two views". */
const VIEW_COUNT = /\b(dos|tres|cuatro|2|3|4)\s+(vistas|paneles)\b|\b(two|three|four)\s+(views|panels)\b/;

const ANGLE_VALUES: Array<[string, RegExp]> = [
  ['three-quarter-left', /\btres cuartos (a la )?izquierd\w*|three.quarter left/],
  ['three-quarter-right', /\btres cuartos (a la )?derech\w*|three.quarter right/],
  ['three-quarter-left', /\btres cuartos\b|three.quarter/],
  ['profile-left', /\bperfil izquierd\w*|profile left/],
  ['profile-right', /\bperfil derech\w*|profile right/],
  ['profile-left', /\bperfil\b|\bprofile\b|\blateral\b|\bside view\b/],
  ['back', /\btrasera\w*|\btrasero\w*|\bespalda\b|\bde espaldas\b|\bback view\b|\bfrom behind\b|\bposterior\b/],
  ['front', /\bfrontal\w*|\bde frente\b|\bfront view\b/],
  ['top-down', /\bcenital\b|\btop.?down\b|\bplano cenital\b|\bvista aerea\b/],
  ['high', /\bpicado\b|\bdesde arriba\b|\bhigh angle\b/],
  ['low', /\bcontrapicado\b|\bdesde abajo\b|\blow angle\b/],
  ['close-up', /\bprimer plano\b|\bclose.?up\b/],
  ['wide', /\bplano general\b|\bplano amplio\b|\bwide shot\b/],
];

/** A request that asks for several angles without a number: how many is the agent's question (or the Direct default). */
export function pluralAngles(text: string): boolean {
  return /\b(multiples|varios|muchos) angulos\b|\b(multiple|several|many) angles\b/.test(normalizeRequest(text));
}

/** The angle a request names, or the first angle not produced yet. */
export function fitAngle(text: string, usedAngles: string[] = []): FitResult {
  const s = normalizeRequest(text);
  for (const [value, re] of ANGLE_VALUES) if (re.test(s)) return { ok: true, params: { angle: value } };
  const free = ANGLE_ORDER.find((a) => !usedAngles.includes(a));
  if (!free) return { ok: false, reason: 'every camera angle was already made from this image' };
  return { ok: true, params: { angle: free } };
}

/** The format a request names, or another format than the source's. */
export function fitAspect(text: string, sourceAspect?: string): FitResult {
  const s = normalizeRequest(text);
  const explicit = s.match(/\b(\d{1,2}):(\d{1,2})\b/);
  if (explicit && ASPECT_OPTIONS.includes(`${explicit[1]}:${explicit[2]}`)) return { ok: true, params: { aspect: `${explicit[1]}:${explicit[2]}` } };
  if (/\bcuadrad\w*|\bsquare\b/.test(s)) return { ok: true, params: { aspect: '1:1' } };
  // "historia" alone is a story in the narrative sense: only "stories" or "historia(s) de Instagram" name the format.
  if (/\b(stories|historias? de instagram|reels?|tiktok|shorts|vertical)\b/.test(s)) return { ok: true, params: { aspect: '9:16' } };
  if (/\b(youtube|horizontal|panoramica|widescreen)\b/.test(s)) return { ok: true, params: { aspect: '16:9' } };
  if (/\b(cine|cinematic|cinemascope|ultrawide)\b/.test(s)) return { ok: true, params: { aspect: '21:9' } };
  // Instagram is two formats: the feed post (4:5) or stories and reels (9:16). Only "post" or "feed" settles it.
  if (/\binstagram\b/.test(s)) {
    if (/\b(post|feed|publicacion)\b/.test(s)) return { ok: true, params: { aspect: '4:5' } };
    return { ok: false, ambiguous: true, reason: 'Instagram is a feed post (4:5) or stories and reels (9:16)', fallback: { aspect: INSTAGRAM_DEFAULT } };
  }
  if (CHANGE_WORDS.test(s) || /\b(cambia|cambiar|adapta|adaptar|pasa|pasala|convierte)\b/.test(s)) {
    const free = ASPECT_ORDER.find((a) => a !== sourceAspect);
    return { ok: true, params: { aspect: free ?? '4:5' } };
  }
  return { ok: false, ambiguous: true, reason: 'no format is named' };
}

/** The reframe format closest to an image's shape (width ÷ height), on a log scale. */
export function aspectOfShape(ratio: number): string {
  let best = ASPECT_OPTIONS[0];
  let bestDistance = Infinity;
  for (const option of ASPECT_OPTIONS) {
    const [w, h] = option.split(':').map(Number);
    const distance = Math.abs(Math.log(ratio) - Math.log(w / h));
    if (distance < bestDistance) {
      best = option;
      bestDistance = distance;
    }
  }
  return best;
}

/** Upscale factor (2 or 4): from an explicit factor, or from the target size against the source image. */
export function fitUpscale(text: string, sourceLongEdge?: number): FitResult {
  const s = normalizeRequest(text);
  const explicit = s.match(/\b(?:x|×)\s?([24])\b|\b([24])\s?(?:x|×)\b|\b([24])x\b/);
  if (explicit) return { ok: true, params: { factor: explicit[1] ?? explicit[2] ?? explicit[3] } };
  const target = s.match(/\b(2|4|8)\s?k\b/);
  // Without a factor or a target size the request names no value: the operation keeps its own default.
  if (!target) return { ok: true, params: {} };
  if (!sourceLongEdge) return { ok: false, ambiguous: true, agentSettles: true, reason: 'the source size is unknown, so the factor to reach the target cannot be computed', fallback: { factor: '2' } };
  const targetEdge = { '2': 2048, '4': 3840, '8': 7680 }[target[1]]!;
  const ratio = targetEdge / sourceLongEdge;
  if (ratio <= 1.25) return { ok: false, reason: 'the image is already at that size' };
  // Nearest of 2× and 4× on a log scale: the boundary between them is √8, about 2.83.
  const factor = ratio < Math.sqrt(8) ? 2 : 4;
  // ×4 is the largest factor: a target beyond it is said, not silently missed (8K from 1024 px reaches 4096 px).
  const short = sourceLongEdge * factor < targetEdge * 0.9;
  return { ok: true, params: { factor: String(factor) }, ...(short ? { note: `×${factor} reaches ${sourceLongEdge * factor} px, short of ${target[1]}K (${targetEdge} px)` } : {}) };
}

/** Views of a character turnaround: 3 or 4. "Dos" is the nearest possible value, 3. Unnamed: no value (the default). */
export function fitPanels(text: string): FitResult {
  const s = normalizeRequest(text);
  if (/\b(cuatro|4)\s+(vistas|paneles)\b|\b(four|4)\s+(views|panels)\b/.test(s)) return { ok: true, params: { panels: '4' } };
  if (/\b(dos|tres|2|3)\s+(vistas|paneles)\b|\b(two|three|2|3)\s+(views|panels)\b/.test(s)) return { ok: true, params: { panels: '3' } };
  return { ok: true, params: {} };
}

const PLACE = /\b(ciudad\w*|city|pueblo|town|casa|house|edificio|building|habitacion|room|cocina|kitchen|calle|street|plaza|paisaje|landscape|lugar|place|interior|exterior|fachada|facade|jardin|garden|oficina|office|hotel|parque|park|bosque|forest|playa|beach|montana|mountain)\b/;
const PERSON = /\b(personaj\w*|persona\w*|character|people|person|mujer\w*|hombre\w*|nin[oa]s?|chic[oa]s?|ella|ellos|conejo\w*|animal\w*|perro\w*|gato\w*|actor\w*|actriz\w*|modelo)\b/;
const OBJECT = /\b(producto\w*|objeto\w*|product|object|bolso\w*|botella\w*|zapato\w*|reloj\w*|mochila\w*|taza\w*|silla\w*|mueble\w*)\b/;

/**
 * The subject of a reference sheet: a character, a person or an object. A place is refused only when the request names
 * a place and no character, person or object: "la chica que está en la playa" or "la casa de mi personaje" are about the
 * character. A request that names none keeps the operation's default (a character): the source image usually settles it.
 */
export function fitSubject(text: string): FitResult {
  const s = normalizeRequest(text);
  if (PERSON.test(s)) return { ok: true, params: { subject: 'character' } };
  if (OBJECT.test(s)) return { ok: true, params: { subject: 'object' } };
  if (PLACE.test(s)) return { ok: false, reason: 'a place is not a reference sheet subject (only characters, people or objects)' };
  return { ok: true, params: {} };
}

/**
 * A reference sheet fits when the request asks for a sheet (not one image per view), its subject is a character, a
 * person or an object, and its view count is set. A request that only counts views ("tres vistas") is ambiguous: a
 * sheet, or one image per view. Auto asks; Direct makes the sheet, the operation's own choice.
 */
export function fitSheet(text: string): FitResult {
  const s = normalizeRequest(text);
  if (PER_VIEW.test(s)) return { ok: false, reason: 'a reference sheet is one image; one image per view takes one angle step per view' };
  const subject = fitSubject(text);
  if (!subject.ok) return subject;
  const panels = fitPanels(text);
  if (!panels.ok) return panels;
  const params = { ...subject.params, ...panels.params };
  // The request counts views but names no sheet: a sheet or one image per view is the question. A request that says
  // nothing about views leaves the agent's own choice of a sheet standing.
  if (!SHEET_CUE.test(s) && VIEW_COUNT.test(s)) return { ok: false, ambiguous: true, reason: 'a reference sheet, or one image per view?', fallback: params };
  return { ok: true, params };
}

/** Angles of a contact sheet: 9 (3×3) or 6 (2×3). Unnamed: no value (the default, 9). */
export function fitContactAngles(text: string): FitResult {
  const s = normalizeRequest(text);
  if (/\b(seis|6)\s+(angulos|angles|vistas|views)\b|\bsix\s+(angles|views)\b/.test(s)) return { ok: true, params: { angles: '6' } };
  if (/\b(nueve|9)\s+(angulos|angles)\b|\bnine\s+angles\b/.test(s)) return { ok: true, params: { angles: '9' } };
  return { ok: true, params: {} };
}

/** Fill the parameters an operation needs from a request. Operations with no fitted parameter always fit. */
export function fitOp(op: string, text: string, ctx: FitContext = {}): FitResult {
  switch (op) {
    case 'angle': return fitAngle(text, ctx.usedAngles);
    case 'reframe': return fitAspect(text, ctx.sourceAspect);
    case 'upscale': return fitUpscale(text, ctx.sourceLongEdge);
    case 'reference_sheet': return fitSheet(text);
    case 'contact_sheet': return fitContactAngles(text);
    // A contact sheet's own grid: six angles are cut 2×3, nine 3×3 (the cut default).
    case 'grid_split': return { ok: true, params: ctx.sourceGrid ? { grid: ctx.sourceGrid } : {} };
    default: return { ok: true, params: {} };
  }
}

/** Long edge in pixels of a step's resolution setting ("1k", "2K", "1080p", "1024x1536"), when it names one. */
export function longEdgeOf(resolution: unknown): number | undefined {
  const r = String(resolution ?? '').toLowerCase().trim();
  const size = r.match(/^(\d{3,5})\s*[x×*]\s*(\d{3,5})$/);
  if (size) return Math.max(Number(size[1]), Number(size[2]));
  const k = r.match(/^(\d(?:\.\d)?)\s*k$/);
  if (k) return Math.round(Number(k[1]) * 1024);
  const p = r.match(/^(\d{3,4})p$/);
  return p ? Math.round((Number(p[1]) * 16) / 9) : undefined;
}

/** What the normalizer knows about the request while fitting a plan: the mode, and whether a question can be asked. */
export interface FitState {
  /** Direct: nothing is asked; an ambiguity takes the visible fallback. */
  direct: boolean;
  /** A question round is still available in this request (Auto and Guided). */
  canAsk: boolean;
  /** The user already answered questions in this request: an ambiguity is not asked again, the agent's reading stands. */
  answered: boolean;
  /** Angles given to angle steps of this plan, by input, so two steps on one image do not repeat an angle. */
  angles: Map<string, string[]>;
}

export function fitState(direct: boolean, canAsk = true, answered = false): FitState {
  return { direct, canAsk: !direct && canAsk, answered, angles: new Map() };
}

export interface RawOpStep { id: string; where: string; op: string; input?: string; params?: Record<string, unknown>; loose: Record<string, unknown> }

/**
 * The parameters of one op step. A valid value the agent gave is kept; a missing or invalid one is filled from the
 * request and the source. An impossibility is refused in every mode. An ambiguity of the user's intent is asked in Auto
 * and Guided even when the agent filled a value (it guessed for the user), once per request; when it cannot be asked
 * (Direct, an answer already given, no round left) the agent's value or the fallback is used and shown on the plan.
 */
export function fitStepParams(step: RawOpStep, fields: OpField[], text: string, ctx: FitContext, state: FitState): { params: Record<string, AdvancedValue>; errors: string[]; adjustments: string[] } {
  const params: Record<string, AdvancedValue> = {};
  const errors: string[] = [];
  const adjustments: string[] = [];
  const planAngles = step.op === 'angle' ? state.angles.get(step.input ?? '') ?? [] : [];
  const fitted = fitOp(step.op, text, { ...ctx, usedAngles: [...(ctx.usedAngles ?? []), ...planAngles] });
  if (!fitted.ok && !fitted.ambiguous) errors.push(`${step.where}: op "${step.op}" does not fit this request: ${fitted.reason}.`);
  const ambiguous = !fitted.ok && fitted.ambiguous;
  const ask = ambiguous && state.canAsk && !state.answered;
  const why = state.direct ? 'Direct does not ask' : state.answered ? 'read from your answers' : 'no question left in this request';
  let asked = false;
  for (const f of fields) {
    // A field written on the step itself ("instruction": …) instead of in params counts as given.
    const loose = step.loose[f.key];
    const v = (step.params?.[f.key] ?? (typeof loose === 'string' || typeof loose === 'number' ? loose : undefined)) as AdvancedValue | undefined;
    if (f.type !== 'choice') {
      params[f.key] = typeof v === 'string' ? v : f.default;
      continue;
    }
    const valid = f.options?.some((o) => o.value === String(v)) ? String(v) : undefined;
    if (ambiguous && FIT_KEYS[step.op]?.includes(f.key) && !(fitted.agentSettles && valid !== undefined)) {
      if (ask) {
        if (!asked) errors.push(`${step.where}: op "${step.op}" needs ${f.key}: ${fitted.reason}. Ask the user, then propose again.`);
        asked = true;
        params[f.key] = valid ?? f.default;
        continue;
      }
      const value = valid ?? fitted.fallback?.[f.key] ?? f.default;
      params[f.key] = value;
      adjustments.push(`${step.id}: ${f.key} "${value}" (${why}: ${fitted.reason})`);
      continue;
    }
    if (valid !== undefined) {
      params[f.key] = valid;
      continue;
    }
    let fill = fitted.ok ? fitted.params[f.key] : undefined;
    // Two angle steps on one image never get the same angle from the fill.
    if (fill !== undefined && step.op === 'angle' && planAngles.includes(fill)) fill = ANGLE_ORDER.find((a) => !planAngles.includes(a) && !(ctx.usedAngles ?? []).includes(a)) ?? fill;
    if (fill !== undefined) {
      params[f.key] = fill;
      adjustments.push(`${step.id}: ${f.key} "${fill}" from the request${v != null ? ` (was "${String(v)}")` : ''}`);
      continue;
    }
    params[f.key] = f.default;
    if (v != null) adjustments.push(`${step.id}: ${f.key} "${String(v)}" → ${f.default}`);
  }
  if (fitted.ok && fitted.note) adjustments.push(`${step.id}: ${fitted.note}`);
  if (step.op === 'angle' && params.angle) state.angles.set(step.input ?? '', [...planAngles, String(params.angle)]);
  return { params, errors, adjustments };
}

/** How many angle steps "múltiples ángulos" takes in Direct, which does not ask (ADR 0007). */
export const DIRECT_ANGLES = 3;

/**
 * The fit across a plan's steps. "Múltiples ángulos" with one angle step: Auto and Guided ask how many; Direct makes
 * the three steps itself, each with its own angle, instead of sending the plan back (an extra call the user never sees).
 * "Tres vistas" made as angle steps with no sheet and no "por vista" named: Auto and Guided ask, as for a sheet.
 */
export function fitPlanSteps<T extends { id?: string; kind?: string; op?: string; params?: Record<string, unknown> }>(steps: T[], text: string, state: FitState): { steps: T[]; errors: string[]; adjustments: string[] } {
  const errors: string[] = [];
  const adjustments: string[] = [];
  const angleSteps = steps.filter((x) => x.kind === 'op' && x.op === 'angle');
  const canAsk = state.canAsk && !state.answered;
  const s = normalizeRequest(text);
  if (angleSteps.length === 1 && pluralAngles(text)) {
    if (state.direct) {
      const one = angleSteps[0];
      const at = steps.indexOf(one);
      const base = one.id && /^[A-Za-z][\w-]*$/.test(one.id) ? one.id : `s${at + 1}`;
      const taken = new Set(steps.map((x) => x.id));
      const copies: T[] = [];
      for (let n = 2; copies.length < DIRECT_ANGLES - 1; n++) {
        if (taken.has(`${base}_${n}`)) continue;
        const rest = { ...(one.params ?? {}) };
        delete rest.angle;
        copies.push({ ...one, id: `${base}_${n}`, params: rest });
      }
      steps = [...steps.slice(0, at), { ...one, id: base }, ...copies, ...steps.slice(at + 1)];
      adjustments.push(`${base}: ${DIRECT_ANGLES} angle steps, one per angle (Direct does not ask how many: "múltiples ángulos")`);
    } else if (canAsk) {
      errors.push('"Múltiples ángulos" needs a number: ask how many angles, then propose one angle step per angle.');
    }
  }
  const sheet = steps.some((x) => x.kind === 'op' && x.op === 'reference_sheet');
  if (!state.direct && canAsk && angleSteps.length && !sheet && VIEW_COUNT.test(s) && !SHEET_CUE.test(s) && !PER_VIEW.test(s)) {
    errors.push('The request counts views but names no sheet: ask whether it is a reference sheet (one image) or one image per view, then propose again.');
  }
  return { steps, errors, adjustments };
}

