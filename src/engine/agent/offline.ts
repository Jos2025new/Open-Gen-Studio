import { detectLang, type Lang } from '../../lib/lang';
import type { RawPlan, RawStep } from '../plan';
import type { Workflow } from '../skills';
import type { AgentQuestion, AgentStyle, AssetKind, Workspace } from '../types';

/*
 * Deterministic planner used when no LLM provider is configured. It covers the
 * common requests well enough to drive every workspace end to end.
 */

export type OfflineAction =
  | { kind: 'reply'; text: string }
  | { kind: 'questions'; intro: string; questions: AgentQuestion[] }
  | { kind: 'plan'; text: string; plan: RawPlan };

export interface OfflineInput {
  request: string;
  answers: Record<string, string>;
  round: number;
  maxRounds: number;
  style: AgentStyle;
  workspace: Workspace;
  attachments: Array<{ id: string; kind: AssetKind }>;
  skillHint?: string;
  workflow?: Workflow;
  doc?: { width: number; height: number };
}

const T = {
  es: {
    help: 'Estoy en modo local (sin LLM). Describe lo que quieres crear —una imagen, un video, un flujo de nodos o un diseño con capas— y preparo el plan. Para un agente completo, conecta OpenRouter, NanoGPT o Atlas Cloud en Ajustes.',
    introQ1: 'Dos detalles rápidos y lo preparo:',
    introQ2: 'Último ajuste antes del plan:',
    style: '¿Qué estilo visual?',
    format: '¿Qué formato?',
    count: '¿Cuántas variantes?',
    duration: '¿Qué duración?',
    mood: '¿Qué iluminación o ambiente?',
    headline: '¿Qué texto lleva el titular?',
    noText: 'Sin texto',
    planReady: 'Plan listo.',
    styles: ['Fotorrealista', 'Cinematográfico', 'Ilustración', 'Render 3D', 'Minimalista'],
    moods: ['Luz natural suave', 'Golden hour', 'Estudio', 'Noche neón', 'Dramático'],
    formats: ['1:1 Cuadrado', '4:5 Feed', '9:16 Vertical', '16:9 Horizontal'],
  },
  en: {
    help: "I'm in local mode (no LLM connected). Describe what you want to make — an image, a video, a node flow or a layered design — and I'll prepare the plan. For the full agent, connect OpenRouter, NanoGPT or Atlas Cloud in Settings.",
    introQ1: 'Two quick details and I will set it up:',
    introQ2: 'One last tweak before the plan:',
    style: 'Which visual style?',
    format: 'Which format?',
    count: 'How many variants?',
    duration: 'How long?',
    mood: 'Which lighting or mood?',
    headline: 'What should the headline say?',
    noText: 'No text',
    planReady: 'Plan ready.',
    styles: ['Photorealistic', 'Cinematic', 'Illustration', '3D render', 'Minimal'],
    moods: ['Soft natural light', 'Golden hour', 'Studio', 'Neon night', 'Dramatic'],
    formats: ['1:1 Square', '4:5 Feed', '9:16 Vertical', '16:9 Landscape'],
  },
} satisfies Record<Lang, unknown>;

const STYLE_TEXT: Array<[RegExp, string]> = [
  [/fotorreal|photoreal|realis/i, 'photorealistic, natural detail, shot on 35mm'],
  [/cinemat/i, 'cinematic still, anamorphic lens, dramatic lighting, subtle film grain'],
  [/ilustra|illustr/i, 'refined digital illustration, clean shapes, rich color'],
  [/3d/i, '3D render, soft global illumination, physically based materials'],
  [/minimal/i, 'minimalist composition, generous negative space, restrained palette'],
];

const MOOD_TEXT: Array<[RegExp, string]> = [
  [/natural|suave|soft/i, 'soft natural light'],
  [/golden/i, 'warm golden hour light'],
  [/estudio|studio/i, 'clean studio lighting'],
  [/ne[oó]n/i, 'neon night lighting, magenta and cyan'],
  [/dram/i, 'dramatic chiaroscuro lighting'],
];

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4 };

const has = (t: string, re: RegExp) => re.test(t);

export function isConversational(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return true;
  const creative =
    /(crea|create|genera|generat|haz|make|diseñ|design|dibuj|draw|anima|render|foto|photo|imagen|image|video|vídeo|clip|p[oó]ster|cartel|logo|banner|flyer|escena|scene|retrato|portrait|producto|product|relight|ilumina|upscale|fondo|background|flujo|flow|storyboard)/;
  if (creative.test(t)) return false;
  return t.length < 140;
}

function detectVideo(t: string): boolean {
  return has(t, /\b(video|vídeo|clip|anima|animate|animation|animaci[oó]n|movimiento|motion|reel|tiktok|film|pel[ií]cula|shot de video|cinem[aá]tica de)\b/i);
}

function detectCount(t: string): number | null {
  const m = /(\d+)\s*(images?|imágenes|imagenes|fotos?|photos?|versions?|versiones|variantes?|variations?|variaciones|opciones|options|renders?)/i.exec(t);
  if (m) return Math.max(1, Math.min(4, Number(m[1])));
  const w = /\b(one|two|three|four|una|dos|tres|cuatro)\s+(images?|imágenes|imagenes|fotos?|photos?|versions?|versiones|variantes?|variations?|variaciones|opciones|options)/i.exec(t);
  if (w) return NUMBER_WORDS[w[1].toLowerCase()] ?? null;
  return null;
}

function detectAspect(t: string): string | null {
  const explicit = /\b(\d{1,2}):(\d{1,2})\b/.exec(t);
  if (explicit) return `${explicit[1]}:${explicit[2]}`;
  if (has(t, /vertical|story|stories|historia|reel|tiktok|shorts/i)) return '9:16';
  if (has(t, /horizontal|landscape|panor[aá]mic|widescreen|youtube|banner|cinemat/i)) return '16:9';
  if (has(t, /cuadrad|square/i)) return '1:1';
  if (has(t, /feed|instagram post|post de instagram/i)) return '4:5';
  return null;
}

function detectDuration(t: string): number | null {
  const m = /(\d{1,2})\s*(s|sec|secs|seconds|seg|segundos)\b/i.exec(t);
  return m ? Math.max(2, Math.min(20, Number(m[1]))) : null;
}

function hasStyleWords(t: string): boolean {
  return STYLE_TEXT.some(([re]) => re.test(t)) || has(t, /anime|watercolor|acuarela|óleo|oil paint|pixel|cartoon|vintage|retro|editorial/i);
}

function quotedText(t: string): string | null {
  const m = /["“”«»']([^"“”«»']{2,80})["“”«»']/.exec(t);
  return m ? m[1].trim() : null;
}

function aspectFromAnswer(a: string | undefined): string | null {
  if (!a) return null;
  const m = /(\d{1,2}:\d{1,2})/.exec(a);
  return m ? m[1] : null;
}

function describe(list: Array<[RegExp, string]>, answer: string | undefined): string {
  if (!answer) return '';
  return list.find(([re]) => re.test(answer))?.[1] ?? answer;
}

function headlineFrom(request: string): string {
  const words = request
    .replace(/["“”«»]/g, '')
    .replace(/\b(crea|create|genera|generate|haz|make|diseña|design|un|una|a|an|the|el|la|de|del|para|for|con|with|p[oó]ster|cartel|poster|flyer|banner|imagen|image)\b/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 4);
  const s = words.join(' ');
  return s ? s.toUpperCase() : 'NEW COLLECTION';
}

function opFromText(t: string): { op: string; params: Record<string, string> } | null {
  if (has(t, /relight|reilumin|ilumina|iluminaci|lighting|luz/i)) {
    const preset = has(t, /ne[oó]n/i) ? 'neon' : has(t, /estudio|studio/i) ? 'softbox' : has(t, /luna|moon/i) ? 'moonlight' : has(t, /vela|candle/i) ? 'candle' : 'golden-hour';
    return { op: 'relight', params: { preset, direction: has(t, /derech|right/i) ? 'right' : 'left', intensity: 'medium' } };
  }
  if (has(t, /[aá]ngulo|angle|perspectiv|vista|view/i)) {
    const angle = has(t, /perfil|profile/i) ? 'profile-right' : has(t, /arriba|top|cenital/i) ? 'top-down' : has(t, /espalda|behind|back/i) ? 'back' : has(t, /cerca|close/i) ? 'close-up' : 'three-quarter-left';
    return { op: 'angle', params: { angle } };
  }
  if (has(t, /upscale|escala|resoluci[oó]n|4k|nitidez|sharpen/i)) return { op: 'upscale', params: { factor: has(t, /4x|4k|×4/i) ? '4' : '2' } };
  if (has(t, /quita(r)? (el )?fondo|remove (the )?background|sin fondo|transparent|transparente|recorta/i)) return { op: 'remove_bg', params: {} };
  if (has(t, /reencuadr|reframe|extiende|outpaint|ampl[ií]a/i)) return { op: 'reframe', params: { aspect: detectAspect(t) ?? '16:9' } };
  if (has(t, /variaci|variation|variante|variant/i)) return { op: 'variations', params: { strength: 'medium', count: String(detectCount(t) ?? 2) } };
  if (has(t, /anima|animate|video|vídeo|movimiento|motion/i)) return { op: 'animate', params: { motion: t } };
  return null;
}

export function offlinePlan(input: OfflineInput): OfflineAction {
  const request = input.request.trim();
  const lang = detectLang(request);
  const tx = T[lang];
  const low = request.toLowerCase();

  if (isConversational(request) && !input.attachments.length) return { kind: 'reply', text: tx.help };

  const wantsVideo = detectVideo(low);
  const aspect = detectAspect(low) ?? aspectFromAnswer(input.answers.format);
  const count = detectCount(low) ?? (input.answers.count ? Number.parseInt(input.answers.count, 10) || 1 : null);
  const duration = detectDuration(low) ?? (input.answers.duration ? Number.parseInt(input.answers.duration, 10) || null : null);
  const imageAttachments = input.attachments.filter((a) => a.kind === 'image');
  const videoAttachments = input.attachments.filter((a) => a.kind === 'video');
  const designer = input.workspace === 'designer';

  // Guided clarification rounds.
  if (input.style === 'guided' && input.round < input.maxRounds && !imageAttachments.length && !videoAttachments.length) {
    const qs: AgentQuestion[] = [];
    if (input.round === 0) {
      if (!hasStyleWords(low) && !input.answers.style) qs.push({ id: 'style', question: tx.style, options: tx.styles, allowCustom: true, multi: false });
      if (!aspect && !designer) qs.push({ id: 'format', question: tx.format, options: tx.formats, allowCustom: false, multi: false });
      if (wantsVideo && !duration) qs.push({ id: 'duration', question: tx.duration, options: ['5s', '8s', '10s'], allowCustom: false, multi: false });
      if (!wantsVideo && !count && !designer) qs.push({ id: 'count', question: tx.count, options: ['1', '2', '4'], allowCustom: false, multi: false });
    } else if (input.round === 1) {
      if (!input.answers.mood) qs.push({ id: 'mood', question: tx.mood, options: tx.moods, allowCustom: true, multi: false });
      if (designer && !quotedText(request) && !input.answers.headline) {
        qs.push({ id: 'headline', question: tx.headline, options: [headlineFrom(request), tx.noText], allowCustom: true, multi: false });
      }
    }
    if (qs.length) return { kind: 'questions', intro: input.round === 0 ? tx.introQ1 : tx.introQ2, questions: qs };
  }

  const styleText = describe(STYLE_TEXT, input.answers.style);
  const moodText = describe(MOOD_TEXT, input.answers.mood);
  const prompt = [request, styleText, moodText, input.skillHint].filter(Boolean).join(', ');
  const steps: RawStep[] = [];

  // Operations on attached media.
  if (imageAttachments.length || videoAttachments.length) {
    const src = imageAttachments[0] ?? videoAttachments[0];
    if (src.kind === 'video') {
      const wantsFrame = has(low, /frame|fotograma|captura|still/i);
      steps.push(
        wantsFrame
          ? { id: 's1', kind: 'op', title: lang === 'es' ? 'Fotograma' : 'Frame', op: 'extract_frame', input: `asset:${src.id}`, params: { which: has(low, /primer|first/i) ? 'first' : 'last' } }
          : { id: 's1', kind: 'op', title: lang === 'es' ? 'Continuación' : 'Continuation', op: 'continue', input: `asset:${src.id}`, params: { motion: request } },
      );
    } else {
      const op = opFromText(low);
      if (op) {
        steps.push({ id: 's1', kind: 'op', title: titleFor(op.op, lang), op: op.op, input: `asset:${src.id}`, params: op.op === 'animate' ? { motion: request } : op.params });
      } else {
        steps.push({
          id: 's1',
          kind: 'image',
          title: lang === 'es' ? 'Edición' : 'Edit',
          prompt,
          refs: imageAttachments.map((a) => `asset:${a.id}`),
          aspect: aspect ?? undefined,
          count: count ?? 1,
        });
      }
      // In the Designer the edited image lands on layer 1 (animation output is video, which layers cannot hold).
      if (designer && !(steps[0].kind === 'op' && steps[0].op === 'animate')) {
        steps.push({ id: 'l1', kind: 'layer', title: 'Layer 1', layer_type: 'raster', source: 's1', target: 'base' });
      }
    }
    return { kind: 'plan', text: tx.planReady, plan: { title: steps[0].title ?? 'Plan', summary: request, steps } };
  }

  // Workflow templates.
  if (input.workflow && input.workflow.workspaces.includes(input.workspace)) {
    for (const s of input.workflow.steps) {
      if (s.kind === 'layer') continue;
      steps.push({
        id: s.id,
        kind: s.kind,
        title: s.title,
        prompt: s.prompt ? s.prompt.replace('{prompt}', prompt) : undefined,
        op: s.op,
        input: s.input,
        params: s.params,
        refs: s.refs,
        first_frame: s.firstFrame,
        aspect: aspect ?? s.aspect,
      });
    }
    if (designer) appendDesignerLayers(steps, request, input, lang);
    return { kind: 'plan', text: tx.planReady, plan: { title: input.workflow.name, summary: request, steps } };
  }

  if (designer) {
    steps.push({ id: 's1', kind: 'image', title: lang === 'es' ? 'Fondo' : 'Background', prompt: `${prompt}, background composition with negative space for a headline`, count: 1 });
    appendDesignerLayers(steps, request, input, lang);
    return { kind: 'plan', text: tx.planReady, plan: { title: lang === 'es' ? 'Diseño' : 'Design', summary: request, steps } };
  }

  const node = input.workspace === 'node';
  if (wantsVideo) {
    // Image first, then animate: better control and consistent across providers.
    const shared = node ? 't1' : undefined;
    if (shared) steps.push({ id: 't1', kind: 'text', title: 'Prompt', text: prompt });
    steps.push({ id: 's1', kind: 'image', title: lang === 'es' ? 'Fotograma clave' : 'Key frame', prompt: shared ? '' : prompt, prompt_from: shared, aspect: aspect ?? '16:9', count: 1 });
    steps.push({
      id: 's2',
      kind: 'video',
      title: lang === 'es' ? 'Video' : 'Video',
      prompt: shared ? 'natural motion, smooth cinematic camera movement' : `${prompt}, natural motion, smooth cinematic camera movement`,
      prompt_from: shared,
      first_frame: 's1',
      aspect: aspect ?? '16:9',
      duration: duration ?? 5,
    });
    return { kind: 'plan', text: tx.planReady, plan: { title: lang === 'es' ? 'Imagen → video' : 'Image → video', summary: request, steps } };
  }

  if (node) {
    steps.push({ id: 't1', kind: 'text', title: 'Prompt', text: prompt });
    steps.push({ id: 's1', kind: 'image', title: lang === 'es' ? 'Imagen' : 'Image', prompt: '', prompt_from: 't1', aspect: aspect ?? undefined, count: count ?? 1 });
  } else {
    steps.push({ id: 's1', kind: 'image', title: lang === 'es' ? 'Imagen' : 'Image', prompt, aspect: aspect ?? undefined, count: count ?? 1 });
  }
  return { kind: 'plan', text: tx.planReady, plan: { title: truncateTitle(request), summary: request, steps } };
}

function appendDesignerLayers(steps: RawStep[], request: string, input: OfflineInput, lang: Lang): void {
  const doc = input.doc ?? { width: 1080, height: 1350 };
  const imageStep = steps.find((s) => s.kind === 'image');
  if (imageStep) steps.push({ id: 'l1', kind: 'layer', title: 'Layer 1', layer_type: 'raster', source: imageStep.id, target: 'base' });
  const answer = input.answers.headline;
  const noText = answer && /^(sin texto|no text)$/i.test(answer.trim());
  const headline = quotedText(request) ?? (answer && !noText ? answer : null) ?? (noText ? null : headlineFrom(request));
  if (!headline) return;
  const fontSize = Math.round(doc.width / 9);
  const y = Math.round(doc.height * 0.08);
  steps.push({
    id: 'l2',
    kind: 'layer',
    title: lang === 'es' ? 'Titular' : 'Headline',
    layer_type: 'text',
    text: headline,
    target: 'new',
    style: { font_family: 'Display', font_size: fontSize, font_weight: 800, color: '#ffffff', align: 'center', line_height: 1, letter_spacing: 1 },
    box: { x: Math.round(doc.width * 0.08), y, width: Math.round(doc.width * 0.84) },
  });
  const lines = Math.max(1, Math.ceil(headline.length / 12));
  steps.push({
    id: 'l3',
    kind: 'layer',
    title: lang === 'es' ? 'Acento' : 'Accent',
    layer_type: 'vector',
    target: 'new',
    shapes: [{ type: 'rect', x: Math.round(doc.width * 0.44), y: y + fontSize * lines + Math.round(fontSize * 0.35), w: Math.round(doc.width * 0.12), h: Math.max(6, Math.round(doc.width / 150)), fill: '#d4f25a', stroke: null, radius: 4 }],
  });
}

function titleFor(op: string, lang: Lang): string {
  const es: Record<string, string> = { relight: 'Reiluminar', angle: 'Cambiar ángulo', upscale: 'Escalar', remove_bg: 'Quitar fondo', reframe: 'Reencuadrar', variations: 'Variaciones', animate: 'Animar' };
  const en: Record<string, string> = { relight: 'Relight', angle: 'Change angle', upscale: 'Upscale', remove_bg: 'Remove background', reframe: 'Reframe', variations: 'Variations', animate: 'Animate' };
  return (lang === 'es' ? es : en)[op] ?? op;
}

function truncateTitle(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > 40 ? `${t.slice(0, 39)}…` : t || 'Plan';
}
