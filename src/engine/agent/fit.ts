import { normalizeRequest } from './triggers';

/*
 * Fitting a request to an operation's parameters. A trigger names an operation; these functions fill its parameters
 * from the request text and from the source image, so the operation runs with a value, never with a guess. Where the
 * request names no value, the rule is stated per parameter below and is the same every time.
 */

export interface FitContext {
  /** Longest side of the source image in pixels, when the operation has an image input. */
  sourceLongEdge?: number;
  /** Aspect of the source image, as one of the reframe options ("4:5", "16:9"…), when known. */
  sourceAspect?: string;
  /** Angle values already produced from this source. */
  usedAngles?: string[];
}

export type FitResult = { ok: true; params: Record<string, string> } | { ok: false; reason: string };

/** Camera angles, in the order a new one is picked when the request names none ("un ángulo diferente"). */
export const ANGLE_ORDER = ['three-quarter-left', 'profile-left', 'back', 'high', 'low', 'close-up', 'wide', 'three-quarter-right', 'profile-right', 'top-down', 'front'];

/** Reframe formats, in the order a new one is picked when the request names none ("otro aspecto"). */
export const ASPECT_OPTIONS = ['1:1', '4:5', '3:4', '2:3', '9:16', '16:9', '3:2', '21:9'];
const ASPECT_ORDER = ['4:5', '9:16', '1:1', '16:9', '3:4', '2:3', '3:2', '21:9'];

const CHANGE_WORDS = /\b(otro|otra|otros|distinto|distinta|diferente|nuevo|nueva|different|another|other|new)\b/;

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
  if (/\b(story|stories|historia de instagram|reels?|tiktok|shorts|vertical)\b/.test(s)) return { ok: true, params: { aspect: '9:16' } };
  if (/\b(youtube|horizontal|panoramica|widescreen)\b/.test(s)) return { ok: true, params: { aspect: '16:9' } };
  if (/\b(cine|cinematic|cinemascope|ultrawide)\b/.test(s)) return { ok: true, params: { aspect: '21:9' } };
  // Instagram alone means the feed post: 4:5.
  if (/\binstagram\b/.test(s)) return { ok: true, params: { aspect: '4:5' } };
  if (CHANGE_WORDS.test(s) || /\b(cambia|cambiar|adapta|adaptar|pasa|pasala|convierte)\b/.test(s)) {
    const free = ASPECT_ORDER.find((a) => a !== sourceAspect);
    return { ok: true, params: { aspect: free ?? '4:5' } };
  }
  return { ok: false, reason: 'no format named' };
}

/** Upscale factor (2 or 4): from an explicit factor, or from the target size against the source image. */
export function fitUpscale(text: string, sourceLongEdge?: number): FitResult {
  const s = normalizeRequest(text);
  const explicit = s.match(/\b(?:x|×)\s?([24])\b|\b([24])\s?(?:x|×)\b|\b([24])x\b/);
  if (explicit) return { ok: true, params: { factor: explicit[1] ?? explicit[2] ?? explicit[3] } };
  const target = s.match(/\b(2|4|8)\s?k\b/);
  if (!target) return { ok: true, params: { factor: '2' } };
  if (!sourceLongEdge) return { ok: false, reason: 'the source size is unknown, so the factor to reach the target cannot be computed' };
  const targetEdge = { '2': 2048, '4': 3840, '8': 7680 }[target[1]]!;
  const ratio = targetEdge / sourceLongEdge;
  if (ratio <= 1.25) return { ok: false, reason: 'the image is already at that size' };
  // Nearest of 2× and 4× on a log scale: the boundary between them is √8, about 2.83.
  return { ok: true, params: { factor: ratio < Math.sqrt(8) ? '2' : '4' } };
}

/** Views of a character turnaround: 3 or 4. "Dos" is the nearest possible value, 3. */
export function fitPanels(text: string): FitResult {
  const s = normalizeRequest(text);
  if (/\b(cuatro|4)\s+(vistas|paneles)\b|\b(four|4)\s+(views|panels)\b/.test(s)) return { ok: true, params: { panels: '4' } };
  return { ok: true, params: { panels: '3' } };
}

/** Angles of a contact sheet: 9 (3×3) or 6 (2×3). Without a number, 9. */
export function fitContactAngles(text: string): FitResult {
  const s = normalizeRequest(text);
  if (/\b(seis|6)\s+(angulos|angles|vistas|views)\b|\bsix\s+(angles|views)\b/.test(s)) return { ok: true, params: { angles: '6' } };
  return { ok: true, params: { angles: '9' } };
}

/** Fill the parameters an operation needs from a request. Operations with no fitted parameter always fit. */
export function fitOp(op: string, text: string, ctx: FitContext = {}): FitResult {
  switch (op) {
    case 'angle': return fitAngle(text, ctx.usedAngles);
    case 'reframe': return fitAspect(text, ctx.sourceAspect);
    case 'upscale': return fitUpscale(text, ctx.sourceLongEdge);
    case 'reference_sheet': return fitPanels(text);
    case 'contact_sheet': return fitContactAngles(text);
    default: return { ok: true, params: {} };
  }
}
