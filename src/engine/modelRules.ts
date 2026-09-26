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
