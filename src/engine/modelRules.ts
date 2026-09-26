/**
 * Model rules the provider schemas do not state, each with its source. The job runner, the model lists and
 * the agent read them from here, so a rule is written once. Add a rule only with a documented source.
 */

export interface SourceVideoRule {
  /** Provider model ids the rule applies to. */
  match: RegExp;
  /** The source clip goes to the reference-video list (no dedicated source field). */
  asReference: boolean;
  /** Accepted source clip length in seconds, per operation. */
  seconds: { edit?: [number, number]; extend?: [number, number] };
  source: string;
}

export const SOURCE_VIDEO_RULES: SourceVideoRule[] = [
  {
    // Omni reference: one reference video is edited (4–30 s, duration -1, ratio adaptive) or extended (2–30 s, ratio adaptive).
    match: /(^|\/)bytedance\/seedance-2\.5(\/us)?\/reference-to-video$|^bytedance\/seedance-2\.5(-turbo)?$/,
    asReference: true,
    seconds: { edit: [4, 30], extend: [2, 30] },
    source: 'API DOC/bytedance seedance 2 5.md (omni_reference_task_type); Atlas schema reference_videos: duration [2,30]s',
  },
];

export function sourceVideoRule(modelId: string): SourceVideoRule | undefined {
  return SOURCE_VIDEO_RULES.find((r) => r.match.test(modelId));
}

/** Takes a source clip for edit/extend even though it is listed as reference-to-video. */
export function takesSourceAsReference(modelId: string): boolean {
  return Boolean(sourceVideoRule(modelId)?.asReference);
}

export interface Model3dRule {
  match: RegExp;
  /** Longest prompt in characters. */
  promptMax?: number;
  /** Input image limits. */
  image?: { maxBytes?: number; maxSide?: number; ratio?: [number, number] };
  /** Views sent together (Meshy multi-image: 1–4 views of one object). */
  views?: [number, number];
  source: string;
}

export const MODEL3D_RULES: Model3dRule[] = [
  { match: /^tripo-h3\.1\//, promptMax: 1024, source: 'Atlas schema tripo-h3.1-text-to-3d.json (prompt maxLength 1024)' },
  {
    match: /^bytedance\/seed3d-v2\.0\//,
    image: { maxBytes: 10 * 1024 * 1024, maxSide: 4095, ratio: [0.4, 2.5] },
    source: 'Atlas schema bytedance-seed3d-v2.0-image-to-3d.json (image ≤10 MB, <4096×4096 px, aspect 0.4–2.5)',
  },
  { match: /^meshy\/v7\.1\/multi-image-to-3d$/, views: [1, 4], source: 'NanoGPT 3D catalog: "one to four views of the same object"' },
];

/** What stops a 3D request before it is sent, as an error code and message; null when it can go. */
export function model3dProblem(
  modelId: string,
  m: { acceptsText: boolean; acceptsImage: boolean },
  prompt: string,
  images: Array<{ size: number; width: number; height: number }>,
): { code: string; message: string } | null {
  if (!m.acceptsImage && images.length) return { code: 'MODEL3D_NO_IMAGE_INPUT', message: 'takes text only; remove the attached images or pick an image-to-3D model.' };
  if (!m.acceptsText && !images.length) return { code: 'MODEL3D_IMAGE_REQUIRED', message: 'needs a reference image of the object.' };
  if (m.acceptsText && !m.acceptsImage && !prompt.trim()) return { code: 'PROMPT_MISSING', message: 'needs a description of the object.' };
  const rule = MODEL3D_RULES.find((r) => r.match.test(modelId));
  if (!rule) return null;
  if (rule.promptMax && prompt.length > rule.promptMax) return { code: 'PROMPT_TOO_LONG', message: `takes prompts up to ${rule.promptMax} characters (this one has ${prompt.length}).` };
  if (rule.views && (images.length < rule.views[0] || images.length > rule.views[1])) return { code: 'MODEL3D_VIEWS', message: `takes ${rule.views[0]}–${rule.views[1]} views of the same object (got ${images.length}).` };
  const lim = rule.image;
  for (const img of lim ? images : []) {
    if (lim!.maxBytes && img.size > lim!.maxBytes) return { code: 'IMAGE_TOO_LARGE', message: `takes images up to ${lim!.maxBytes / 1048576} MB.` };
    if (lim!.maxSide && Math.max(img.width, img.height) > lim!.maxSide) return { code: 'IMAGE_TOO_LARGE', message: `takes images under ${lim!.maxSide + 1}×${lim!.maxSide + 1} px.` };
    const r = img.width && img.height ? img.width / img.height : 1;
    if (lim!.ratio && (r < lim!.ratio[0] || r > lim!.ratio[1])) return { code: 'IMAGE_ASPECT', message: `takes images with aspect ratio ${lim!.ratio[0]}–${lim!.ratio[1]} (this one is ${r.toFixed(2)}).` };
  }
  return null;
}

/**
 * How a family's prompt cites its references, when the endpoint's own schema does not say (a schema's
 * `promptRefs` always wins: it is the most specific source). Rendered once in the agent's system prompt.
 */
export interface ReferenceProtocol {
  family: string;
  note: string;
  source: string;
}

export const REFERENCE_PROTOCOLS: ReferenceProtocol[] = [
  {
    family: 'Seedance 2.0 / 2.5',
    note: '@Image1, @Image2… (@Video1, @Audio1), numbered per type in refs order; one job per reference plus what it must not bring ("@Image1 is the character; ignore its background").',
    source: 'Atlas schema seedance-2.5/reference-to-video (prompt: "Cite reference inputs in submission order with @-syntax"); API DOC/bytedance seedance 2 5.md (example Odysseus@image2)',
  },
  {
    family: 'Wan 3',
    note: '@Image1 defines… ("@Image1 defines the character. Do not use the image background."); with first/last frame, leave free references out.',
    source: 'ai-director guide wan3/prompting.md lines 88–123 (user machine); fal schema wan-3.0/reference-to-video ("Image 1 … Video 1")',
  },
  {
    family: 'MiniMax H3',
    note: '<Picture 1>, <Picture 2> (not @Image1), with timing when it helps ("<Picture 1> aligns with the 0.00-second mark"); with good references the prompt covers action, camera and sound, not appearance.',
    source: 'MiniMax-H3 VIDEO_PROMPT_WRITING_GUIDE_ref_en.md; ai-director guide minimax-h3 lines 29–31, 104',
  },
];

/** What a preferred model is best for and what to avoid it for: the user-approved purpose table (R1) and schema limits. */
export interface ModelFit {
  match: RegExp;
  bestFor: string;
  avoidFor?: string;
  source: string;
}

export const MODEL_FITS: ModelFit[] = [
  { match: /seedance[-/]?2[.-]0[-/]?(fast|mini)|seedance-2-0-(fast|mini)/i, bestFor: 'drafts and tests (fast, cheap)', avoidFor: 'final pieces', source: 'purpose table approved 2026-09-26' },
  { match: /minimax[-/]h3-fast/i, bestFor: 'drafts and tests (fast, cheap)', avoidFor: 'final pieces', source: 'purpose table approved 2026-09-26' },
  { match: /seedance[-/]?2[.-]5/i, bestFor: 'long takes (up to 30 s) and many references', avoidFor: 'cheap drafts', source: 'purpose table approved 2026-09-26; API DOC/bytedance seedance 2 5.md (duration up to 30 s)' },
  { match: /wan-3\.0/i, bestFor: 'short clips and final pieces (default video model)', source: 'purpose table approved 2026-09-26' },
];

export function modelFit(modelId: string): string | undefined {
  const f = MODEL_FITS.find((x) => x.match.test(modelId));
  return f ? `best for ${f.bestFor}${f.avoidFor ? `; avoid for ${f.avoidFor}` : ''}` : undefined;
}
