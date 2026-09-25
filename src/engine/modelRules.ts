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
