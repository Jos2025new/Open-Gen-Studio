import { modelPriority } from '../agent/modelPriority';
import { withCaptureSetting } from '../captureStyles';
import { exposeShotSubjects, transportsNamedSubjects } from '../continuity';
import { followUpProblem, modelChange, modelMove, namedOverConfirmed, partNamed } from '../modelNamed';
import { model3dProblem } from '../modelRules';
import { refsLimit } from '../officialLimits';
import { aspectLabel, audioInputProblem, coerceSettings, isAutoOption, nearestAspect, paramByRole, ratioOf, routeVideoInputs, shotsProblem, videoInputProblem } from '../params';
import { aspectFor } from '../planAspect';
import { countFollowsCard } from '../planCount';
import { storyboardProblem, videoFix } from '../planFix';
import { promptTooLong } from '../planSent';
import { withRealismSetting } from '../realism';
import { placeRoles, stepRolesLine } from '../refRoles';
import { RouteMode, VIDEO_PURPOSES, VideoPurpose, routeFits, routeMode, routeVideo } from '../routing';
import type { ImageStep, Model3dStep, ModelSchema, VideoStep } from '../types';
import type { RawStep } from '../plan';
import { cleanParams, didYouMean, familyRef } from './shared';
import type { StepEnv } from './env';

export async function normalizeMedia(s: RawStep, env: StepEnv): Promise<void> {
  const { ctx, raw, rawSteps, errors, adjustments, steps, st, share, stepRoles, refKind, expectImage, inputAspect, frameOf } = env;
  const where = `Step ${s.id}`;
  const title = (s.title ?? '').trim() || s.id!;
  const kind = s.kind as 'image' | 'model3d' | 'video';
  // An asset id in the prompt is an unwired input: it becomes the step's image.
  for (const token of new Set((s.prompt ?? '').match(/asset:[A-Za-z0-9_-]+/g) ?? [])) {
    const a = ctx.asset(token.slice(6));
    if (!a) continue;
    s.prompt = (s.prompt ?? '').split(token).join('').replace(/\s{2,}/g, ' ').trim();
    if (s.first_frame === token || s.refs?.includes(token)) continue;
    const asStart = kind === 'video' && a.kind === 'image' && !s.first_frame && !s.refs?.length;
    if (asStart) s.first_frame = token;
    else s.refs = [...(s.refs ?? []), token];
    adjustments.push(`${s.id}: ${token} moved from the prompt to the step's ${asStart ? 'start frame' : 'references'}`);
  }
  // A start frame also in refs is one input twice: keep it as the start frame.
  if (s.first_frame && s.refs?.includes(s.first_frame)) s.refs = s.refs.filter((r) => r !== s.first_frame);
  const refs = ((s.refs ?? []) as string[]).filter(Boolean);
  if (s.prompt_from) {
    const k = refKind(s.prompt_from, where);
    if (k && k !== 'text') errors.push(`${where}: prompt_from must reference a text step. Fix: write the text in "prompt" and drop prompt_from (an image or clip goes in refs or first_frame).`);
  }
  const sheet = kind === 'video' && storyboardProblem(s);
  if (sheet) errors.push(`${where}: ${sheet}`);
  // References are images, videos or audio.
  const refKinds = refs.map((r) => refKind(r, where));
  refKinds.forEach((k, i) => {
    if (k && k !== 'image' && k !== 'raster' && k !== 'video' && k !== 'audio') errors.push(`${where}: ref "${refs[i]}" produces ${k}; refs must be images, videos or audio.`);
  });
  const imageRefs = refs.filter((_, i) => refKinds[i] !== 'video' && refKinds[i] !== 'audio');
  const videoRefs = refs.filter((_, i) => refKinds[i] === 'video');
  const audioRefs = refs.filter((_, i) => refKinds[i] === 'audio');
  if (kind === 'video') {
    expectImage(s.first_frame, `${where} first_frame`);
    expectImage(s.last_frame, `${where} last_frame`);
  }
  // Phase 2: what the user confirmed wins over what the plan wrote (the prompts were written for it).
  let conf = kind === 'video' || kind === 'image' ? ctx.confirmed?.(kind) : undefined;
  // Several confirmed models of this kind (an A/B comparison): each step keeps the part of the model line it names.
  const parts = kind === 'video' || kind === 'image' ? ctx.confirmedParts?.(kind) ?? [] : [];
  if (parts.length > 1) {
    const match = s.model?.trim() ? await partNamed(parts, s.model.trim(), ctx.getModel) : undefined;
    if (!match) { errors.push(`${where}: Choose one confirmed model explicitly: ${parts.map((p) => p.modelRef).join(', ')}. Do not substitute another comparison model.`); return; }
    conf = match;
  }
  // A model named in THIS request is never swapped silently: the user confirms first.
  const asked = conf && parts.length <= 1 && s.model?.trim() ? await namedOverConfirmed(ctx, s.model.trim(), conf.modelRef, s.user_requested) : undefined;
  if (asked) {
    errors.push(`${where}: The user named ${asked.name} (${asked.ref}); call confirm_settings for ${kind} with model ${asked.ref} first.`);
    return;
  }
  const ask = conf && parts.length <= 1 && ctx.switchedTo?.(kind) ? await followUpProblem(ctx, conf.modelRef, kind) : undefined;
  if (ask) { errors.push(`${where}: ${ask}`); return; }
  if (conf) {
    const confName = (await ctx.getModel(conf.modelRef))?.model.name ?? conf.modelRef;
    const stepNeedsImage = refs.length > 0 || Boolean(s.first_frame);
    const wrote = s.model?.trim();
    // The same model line in the variant these inputs need (the card was made for other inputs).
    const route = kind === 'image' ? (stepNeedsImage ? 'edit' : 'text') : routeMode({ firstFrame: Boolean(s.first_frame), refs: imageRefs.length });
    s.model = ctx.variantModel
      ? ctx.variantModel(conf.modelRef, route) ?? conf.modelRef
      : stepNeedsImage === conf.needsImage ? conf.modelRef : confName;
    // A family name (e.g. Nano Banana 2) is the same choice written loosely: not worth a note.
    // Noted only for another model line; the confirmed model's own variant is the same choice.
    const wroteModel = wrote?.includes('::') ? (await ctx.getModel(wrote))?.model : undefined;
    const confModel = (await ctx.getModel(conf.modelRef))?.model;
    if (wrote && wroteModel && confModel && modelChange(wroteModel, confModel)) adjustments.push(`${s.id}: ${modelMove(wroteModel, confModel)}`);
    // Same meaning is not an adjustment ("1:1" = "2048x2048"; "1776x2368" = "1776*2368").
    const norm = (v: unknown) => String(v).toLowerCase().replace(/[×*]/g, 'x').replace(/\s+/g, '');
    const sameValue = (field: string, a: unknown, b: unknown) => {
      if (field === 'aspect') { const ra = ratioOf(String(a)), rb = ratioOf(String(b)); if (ra && rb) return Math.abs(ra / rb - 1) < 0.04; }
      return norm(a) === norm(b);
    };
    const keep = (field: 'resolution' | 'aspect' | 'duration' | 'count', value: string | number | undefined) => {
      if (value == null) return;
      const had = (s as Record<string, unknown>)[field];
      if (had != null && !sameValue(field, had, value)) adjustments.push(`${s.id}: ${field} ${String(had)} → ${String(value)} (confirmed)`);
      (s as Record<string, unknown>)[field] = value;
    };
    keep('resolution', conf.resolution);
    keep('aspect', kind === 'image' ? aspectFor(s, raw, rawSteps, imageRefs, inputAspect, conf.aspect, adjustments) : conf.aspect);
    if (kind === 'video') keep('duration', conf.duration);
    if (kind === 'image' && countFollowsCard(rawSteps, s)) keep('count', conf.count);
  }
  if (!conf && (kind === 'image' || kind === 'video') && typeof s.user_requested === 'boolean' && ctx.composerChosen?.(kind)) {
    const choice = modelPriority({ composer: ctx.defaultModel(kind, imageRefs.length > 0 || Boolean(s.first_frame)) ?? undefined, proposed: s.model?.trim(), userRequested: s.user_requested });
    const wrote = s.model && (await ctx.getModel(s.model))?.model;
    const kept = choice.modelRef && (await ctx.getModel(choice.modelRef))?.model;
    if (wrote && kept && modelChange(wrote, kept)) adjustments.push(`${s.id}: kept your ${kind} model (the plan had named ${wrote.name})`);
    s.model = choice.modelRef;
  }
  // Model choice depends on the image inputs; it runs again if video refs become frames (O1).
  const pickModel = async (pickNotes: string[], skipOverride = false) => {
    const needsImage = refs.length > 0 || Boolean(s.first_frame);
    let modelRef = familyRef(ctx, s.model, kind, needsImage, s.id!, pickNotes);
    let pickedRoute: RouteMode | undefined;
    let routeParams: Record<string, string> | undefined;
    const routeRefs = imageRefs.length + (imageRefs.length && s.first_frame ? 1 : 0);
    if (!modelRef && kind === 'video') {
      const route = routeMode({ firstFrame: Boolean(s.first_frame), refs: imageRefs.length });
      const override = skipOverride ? undefined : ctx.routeModel?.(route);
      if (override) {
        modelRef = override;
        pickedRoute = route;
        pickNotes.push(`${s.id}: ${route} video → user model (${override.split('::')[0]})`);
      // No exact override: preserve C2. A global composer pick still wins; otherwise use the purpose table.
      } else if (ctx.composerChosen && !ctx.composerChosen('video')) {
        const purpose: VideoPurpose = VIDEO_PURPOSES.includes(s.purpose as VideoPurpose) ? (s.purpose as VideoPurpose) : 'normal';
        const routed = await routeVideo(purpose, { firstFrame: Boolean(s.first_frame), refs: routeRefs, duration: s.duration }, ctx.getModel);
        if (routed) {
          modelRef = routed.ref;
          routeParams = routed.entry.params;
          pickNotes.push(`${s.id}: ${purpose} video → ${routed.entry.name} (${routed.ref.split('::')[0]})`);
        }
      }
    }
    if (!modelRef && ctx.composerChosen?.(kind) && ctx.defaultIsFallback?.(kind, needsImage)) {
      const fallback = ctx.defaultModel(kind, needsImage);
      if (fallback) pickNotes.push(`${s.id}: your ${kind} model has no variant that takes ${kind === 'video' ? 'a start image' : 'an input image'}, so ${(await ctx.getModel(fallback))?.model.name ?? fallback.split('::')[1]} is used — pick one in Models to choose it yourself`);
    }
    modelRef ||= ctx.defaultModel(kind, needsImage) ?? undefined;
    return { modelRef, pickedRoute, routeParams, routeRefs, needsImage, resolved: modelRef ? await ctx.getModel(modelRef) : null };
  };
  let pickNotes: string[] = [];
  let pick = await pickModel(pickNotes);
  // O1: a model without video inputs gets each video ref's last frame (free, local) instead of a rejection.
  const takesVideo = (sl: ModelSchema['slots']) => Boolean(sl.clips ?? sl.refVideos ?? sl.mixedRefs);
  if (kind === 'video' && videoRefs.length && pick.resolved?.model.kind === 'video' && !takesVideo(pick.resolved.schema.slots)) {
    const frames = videoRefs.map((r) => frameOf(r, 'last', s.id!));
    refs.splice(0, refs.length, ...refs.map((r) => (videoRefs.includes(r) ? frames[videoRefs.indexOf(r)] : r)));
    imageRefs.push(...frames);
    videoRefs.length = 0;
    adjustments.push(`${s.id}: ${frames.length > 1 ? `${frames.length} reference videos → their last frames` : 'reference video → its last frame'} (${pick.resolved.model.name} takes no videos)`);
    if (!s.model) {
      pickNotes = [];
      pick = await pickModel(pickNotes);
    }
  }
  // A route model the user picked that cannot take this step (e.g. no reference input): the default takes over, noted.
  if (pick.pickedRoute && pick.resolved && !routeFits(pick.resolved.model, pick.resolved.schema, { mode: pick.pickedRoute, refs: pick.routeRefs, duration: s.duration })) {
    pickNotes = [`${s.id}: your ${pick.pickedRoute}-to-video model (${pick.resolved.model.name}) cannot take this step; the default model is used`];
    pick = await pickModel(pickNotes, true);
  }
  adjustments.push(...pickNotes);
  // A routed entry's own settings (FLUX 3 Draft: quality "draft"); the step's params win.
  if (pick.routeParams) s.params = { ...pick.routeParams, ...(s.params ?? {}) };
  const { modelRef, needsImage, resolved } = pick;
  if (!modelRef) {
    errors.push(`${where}: no ${kind} model is available. Ask the user to connect a provider.`);
    return;
  }
  if (!resolved) {
    errors.push(`${where}: model "${modelRef}" was not found in the catalog.${didYouMean(ctx, modelRef, kind, needsImage)}`);
    return;
  }
  if (resolved.model.kind !== kind) {
    errors.push(`${where}: model "${modelRef}" generates ${resolved.model.kind}, not ${kind}. Fix: set kind "${resolved.model.kind}", or leave "model" out for the default ${kind} model.`);
    return;
  }
  const { schema } = resolved;
  if (schema.missing?.length) errors.push(`${where}: model "${modelRef}" needs ${schema.missing.join(', ')}, which the app cannot send yet. Pick another model.`);
  st.set(s.id!, transportsNamedSubjects(schema.slots));
  if (kind === 'image' || kind === 'model3d') {
    const slot = schema.slots.images;
    const extra = schema.slots.source ? 1 : 0;
    const cap = refsLimit(schema, s.count);
    if (imageRefs.length && !slot) errors.push(`${where}: model "${modelRef}" does not accept reference images. Fix: ${s.model ? 'leave "model" out (the app switches to a variant that takes images) or ' : ''}drop refs.`);
    else if (slot && imageRefs.length > cap) errors.push(`${where}: model "${modelRef}" accepts at most ${cap} reference image(s)${slot.total ? ` next to ${s.count ?? 1} result(s): references + results ≤ ${slot.total} per call` : ''}. Fix: refs: [${imageRefs.slice(0, cap).map((r) => `"${r}"`).join(', ')}] (drop ${imageRefs.slice(cap).join(', ')}), split the results, or merge refs first in one image step.`);
    if (imageRefs.length < (slot?.min ?? 0) + extra) errors.push(`${where}: model "${modelRef}" requires ${extra ? 'a source image first, then reference images' : 'an input image'} (refs). Fix: ${!imageRefs.length ? `if this step makes a new image from text, ${s.model ? 'name the text-to-image variant or leave "model" out' : 'leave refs empty and name a text-to-image model'}; add refs only when it really edits or uses an image — never an unrelated image just to satisfy the model.` : `put the image it edits (an image step or asset:<id>) in refs.`}`);
    const clips = schema.slots.clips;
    if (videoRefs.length && !clips) errors.push(`${where}: model "${modelRef}" does not take video refs. Fix: add a step { kind: "op", op: "extract_frame", input: "${videoRefs[0]}", params: { which: "last" } } and put that step in refs instead.`);
    else if (clips && (videoRefs.length > clips.max || videoRefs.length < clips.min)) errors.push(`${where}: model "${modelRef}" takes ${clips.min}–${clips.max} video clip ref(s).`);
    const audioProblem = audioInputProblem(schema.slots, audioRefs.length);
    if (audioProblem) errors.push(`${where}: model "${modelRef}" ${audioProblem}`);
  } else {
    // A required start image can use the request's sole attached image.
    const needsStart = Boolean(schema.slots.firstFrame?.required) || (!resolved.model.acceptsText && Boolean(schema.slots.firstFrame));
    const attached = ctx.requestImages?.() ?? [];
    if (needsStart && !s.first_frame && !refs.length && attached.length === 1) {
      s.first_frame = `asset:${attached[0]}`;
      adjustments.push(`${s.id}: start frame = your attached image (the model needs one)`);
    }
    // Same routing as the composer and the job runner (params.routeVideoInputs).
    const routed = routeVideoInputs(schema.slots, imageRefs, videoRefs, s.first_frame);
    const problem = videoInputProblem(schema.slots, { firstFrame: Boolean(routed.firstFrame), lastFrame: Boolean(s.last_frame), sourceVideo: false, images: routed.images.length, videos: routed.videos.length, audios: audioRefs.length, resolution: s.resolution });
    if (problem) errors.push(`${where}: model "${modelRef}" ${problem} Fix: ${videoFix(schema.slots, { ...routed, lastFrame: Boolean(s.last_frame), sourceVideo: false, audios: audioRefs.length, resolution: s.resolution }, Boolean(s.model))}`);
    if (s.last_frame && !schema.slots.lastFrame) errors.push(`${where}: model "${modelRef}" does not support last_frame. Fix: drop last_frame and describe the ending in the prompt${s.model ? ', or name a model with a last-frame input' : ''}.`);
    if (!s.first_frame && !refs.length && schema.slots.promptRequired === false && !resolved.model.acceptsText) errors.push(`${where}: model "${modelRef}" needs first_frame. Fix: set first_frame to an image step or asset:<id>${s.model ? ', or leave "model" out for a text-to-video model' : ''}.`);
    if (s.times?.some((t) => t != null) && !schema.slots.keyframes) adjustments.push(`${s.id}: times ignored, "${modelRef}" has no keyframes`);
  }
  const rolesLine = stepRolesLine(stepRoles.get(s.id!), imageRefs, modelRef, schema.slots.promptRefs, where, errors);
  const prompt = placeRoles(rolesLine, kind === 'video' && schema.slots.shots ? exposeShotSubjects((s.prompt ?? '').trim(), s.shots, schema.slots.shots.max) : (s.prompt ?? '').trim(), modelRef, kind);
  // Cited images need a wired ref or frame; otherwise the model invents them.
  const cited = /@image\s*\d|<picture\s*\d>|<image_(ref_)?\d>|\b(image|picture)\s*\d\b/i.exec(prompt)?.[0];
  if (cited && !refs.length && !s.first_frame && !s.last_frame) errors.push(`${where}: the prompt cites "${cited}" but the step has no refs, so the model would invent it. Fix: put that image in refs (asset:<id> or a step id), or drop the citation if the step is really made from text.`);
  if (!prompt && !s.prompt_from && schema.slots.promptRequired) errors.push(`${where}: a prompt is required. Fix: write "prompt" (what happens and how it looks).`);
  const tooLong = promptTooLong(kind, prompt, raw.style, schema.slots.promptMax);
  if (tooLong) errors.push(`${where}: model "${modelRef}" ${tooLong}`);
  if (kind === 'model3d') {
    if (videoRefs.length || audioRefs.length) errors.push(`${where}: 3D models take only images in refs.`);
    // Sizes are checked by the job runner once the images exist.
    const problem = model3dProblem(resolved.model.id, resolved.model, prompt || (s.prompt_from ? '…' : ''), imageRefs.map(() => ({ size: 0, width: 0, height: 0 })));
    if (problem) errors.push(`${where}: model "${modelRef}" ${problem.message}`);
  }
  const defaults = ctx.defaultSettings(kind);
  // R7: a clip made from an image, or an image redrawn from one image (a view, a lock-up, an edit), keeps that
  // image's shape unless the step sets one.
  const shape = !s.aspect && (kind === 'video' || (kind === 'image' && imageRefs.length === 1)) ? inputAspect(kind === 'video' ? s.first_frame ?? imageRefs[0] : imageRefs[0]) : undefined;
  const aspectOptions = paramByRole(schema, 'aspect')?.options?.filter((o) => !isAutoOption(o)) ?? [];
  const inherited = shape && aspectOptions.length ? nearestAspect(aspectOptions, shape) : undefined;
  if (inherited) adjustments.push(`${s.id}: aspect ${aspectLabel(inherited)} from the input image`);
  const { settings, changes } = coerceSettings(schema, kind, {
    ...defaults,
    aspect: s.aspect ?? inherited ?? defaults.aspect,
    resolution: s.resolution ?? defaults.resolution,
    duration: s.duration ?? share ?? defaults.duration,
    audio: s.audio ?? defaults.audio,
    count: kind === 'model3d' ? 1 : s.count ?? (kind === 'video' ? 1 : defaults.count ?? 1),
    seed: s.seed,
    // Only models with a negative prompt field take it (coerceSettings); others get constraints in the prompt.
    negative: typeof s.params?.negative_prompt === 'string' ? s.params.negative_prompt : undefined,
    shots: kind === 'video' ? s.shots?.map((shot) => ({ ...shot })) : undefined,
    // Structured params (colors as hex, palettes, style codes, ids): coerceSettings keeps only what the model takes.
    extras: s.params,
    advanced: s.model ? cleanParams(s.params) : { ...(defaults.advanced ?? {}), ...cleanParams(s.params) },
  });
  changes.forEach((c) => adjustments.push(`${s.id}: ${c}`));
  const shotProblem = kind === 'video' && schema.slots.shots ? shotsProblem(settings.shots, settings.duration) : null;
  if (shotProblem) errors.push(`${where}: ${shotProblem}`);
  // Candidates that differ: one variation per result; their number is the count (the confirmed one wins).
  const variations = kind === 'image' && Array.isArray(s.variations) ? s.variations.map((v) => String(v).trim()).filter(Boolean) : [];
  if (variations.length > 1) {
    const want = conf?.count;
    if (want && variations.length !== want) errors.push(`${where}: ${variations.length} variations but the user confirmed ${want} image${want === 1 ? '' : 's'}. Fix: write exactly ${want} variation${want === 1 ? '' : 's'}${want === 1 ? ' (or none)' : ''}.`);
    else settings.count = variations.length;
  }
  if (kind === 'image' || kind === 'model3d') {
    steps.push({ id: s.id!, kind, title, prompt, promptFrom: s.prompt_from, modelRef, settings: withCaptureSetting(withRealismSetting(settings, kind, s.realism, s.shot), kind, s.capture, ctx.librarySubjects?.()), refs, ...(variations.length > 1 && kind === 'image' ? { variations } : {}) } satisfies ImageStep | Model3dStep);
  } else {
    steps.push({
      id: s.id!,
      kind,
      title,
      prompt,
      promptFrom: s.prompt_from,
      modelRef,
      settings: withCaptureSetting({ ...settings, count: Math.min(settings.count, 2) }, kind, s.capture, ctx.librarySubjects?.()),
      firstFrame: s.first_frame,
      lastFrame: s.last_frame,
      refs: refs.length ? refs : undefined,
      times: s.times?.length ? s.times : undefined,
    } satisfies VideoStep);
  }
}
