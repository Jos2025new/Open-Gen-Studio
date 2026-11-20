/* The inputs of a send: media by slot, subjects, prompt rules, keyframes and clips (moved out of jobs.ts execute(), Opus #4). */
import { maskToAlpha } from '../lib/media';
import { InputError } from './errors';
import { model3dProblem, sourceVideoRule } from './modelRules';
import { refsLimit } from './officialLimits';
import { OPS, isVideoOpEngine } from './ops';
import { audioInputProblem, songProblem, clipTrim, shotsProblem, routeAudio, durationChoices, placeKeyframes, paramByRole, routeVideoInputs, videoInputProblem } from './params';
import { mapSubjectPrompts } from './subjectPrompts';
import type { MediaInput } from './providers/types';
import type { GenSettings, Generation, MediaKind, ModelSchema, ModelSummary } from './types';
import { useStore } from '../store/store';
import { mediaInput, frameInput } from './assetIO';

const get = useStore.getState;

export interface SlotInputs {
  refs: MediaInput[];
  refVideos: MediaInput[];
  audios: MediaInput[];
  firstFrame?: MediaInput;
  lastFrame?: MediaInput;
  video?: MediaInput;
  mask?: MediaInput;
  audio?: MediaInput;
  refAudios: MediaInput[];
}

/** The media the send carries, by slot: the operation's source or the generation's references, frames, mask and audio. */
export async function slotInputs(g: Generation, model: ModelSummary, schema: ModelSchema, kind: MediaKind): Promise<SlotInputs> {
    let refs: MediaInput[] = [];
    let refVideos: MediaInput[] = [];
    let audios: MediaInput[] = [];
    let firstFrame: MediaInput | undefined;
    let lastFrame: MediaInput | undefined;
    let video: MediaInput | undefined;
    if (g.op) {
      const def = OPS[g.op.id];
      if (isVideoOpEngine(def.engine)) {
        video = await mediaInput(g.op.sourceAssetId);
        const rule = sourceVideoRule(model.id);
        const range = def.engine === 'video_edit' ? rule?.seconds.edit : def.engine === 'video_extend' ? rule?.seconds.extend : undefined;
        const seconds = get().assets[g.op.sourceAssetId]?.duration;
        if (range && seconds != null && (seconds < range[0] || seconds > range[1])) {
          throw new InputError('VIDEO_DURATION', `${model.name} takes clips of ${range[0]}–${range[1]} s for this; this one is ${seconds.toFixed(1)} s.`);
        }
        // No source-video field (Seedance 2.5 omni reference): the clip goes in as the one reference video.
        if (!schema.slots.video && (schema.slots.refVideos || schema.slots.mixedRefs)) {
          refVideos = [video];
          video = undefined;
        }
      } else if (def.engine === 'video') {
        firstFrame = g.op.id === 'continue' ? await frameInput(g.op.sourceAssetId, 'last') : await mediaInput(g.op.sourceAssetId);
      } else {
        refs.push(await mediaInput(g.op.sourceAssetId));
        for (const id of String(g.op.params._refs ?? '').split(',').filter(Boolean)) refs.push(await mediaInput(id));
      }
    } else {
      for (const r of g.inputs.refs) {
        const kind = get().assets[r]?.kind;
        (kind === 'video' ? refVideos : kind === 'audio' ? audios : refs).push(await mediaInput(r));
      }
      if (g.inputs.firstFrame) firstFrame = await mediaInput(g.inputs.firstFrame);
      if (g.inputs.lastFrame) lastFrame = await mediaInput(g.inputs.lastFrame);
    }
    if (g.op && g.inputs.lastFrame) lastFrame = await mediaInput(g.inputs.lastFrame);
    // Mask operations (Edit region, Remove object): only models that declare a mask, in their convention.
    let mask: MediaInput | undefined;
    const engine = g.op ? OPS[g.op.id].engine : undefined;
    if (g.op && (engine === 'inpaint' || engine === 'remove_object')) {
      const def = OPS[g.op.id];
      const maskId = String(g.op.params.mask ?? '');
      const maskAsset = get().assets[maskId];
      if (!maskAsset) throw new InputError('MASK_MISSING', `${def.label} needs a mask: paint the area in Sketch.`);
      if (!schema.slots.mask) throw new InputError('MASK_UNSUPPORTED', `${model.name} cannot take a mask. Pick a model for ${def.label} in Settings → Operations.`);
      const src = get().assets[g.op.sourceAssetId];
      if (src && (maskAsset.width !== src.width || maskAsset.height !== src.height)) {
        throw new InputError('MASK_SIZE', `The mask is ${maskAsset.width}×${maskAsset.height} but the image is ${src.width}×${src.height}.`);
      }
      const input = await mediaInput(maskId);
      mask = schema.slots.mask.convention === 'alpha' ? { ...input, blob: await maskToAlpha(input.blob), mime: 'image/png' } : input;
    }
    if (g.kind === 'image' && (schema.slots.images?.min ?? 0) + (schema.slots.source ? 1 : 0) > refs.length) {
      throw new Error(`${model.name} needs ${schema.slots.source ? 'a source image plus reference images' : 'an input image'}.`);
    }
    if (kind === 'model3d') {
      if (refVideos.length || audios.length || firstFrame || lastFrame) throw new InputError('MODEL3D_MEDIA_INPUT', `${model.name} takes only images.`);
      if (refs.length && !schema.slots.images) throw new InputError('MODEL3D_NO_IMAGE_INPUT', `${model.name} takes text only.`);
      const problem = model3dProblem(model.id, model, g.prompt, refs.map((r) => ({ size: r.blob.size, width: r.width, height: r.height })));
      if (problem) throw new InputError(problem.code, `${model.name} ${problem.message}`);
    }
    if (g.kind === 'image' && refs.length && !schema.slots.images) throw new Error(`${model.name} does not accept input images.`);
    if (g.kind === 'video' && !video && !(g.op && refVideos.length)) {
      // A reference-to-video model has no start frame: an image given as one becomes a reference.
      const routed = routeVideoInputs(schema.slots, refs, refVideos, firstFrame);
      ({ firstFrame, images: refs, videos: refVideos } = routed);
      const problem = videoInputProblem(schema.slots, { firstFrame: Boolean(firstFrame), lastFrame: Boolean(lastFrame), sourceVideo: Boolean(video), images: refs.length, videos: refVideos.length, audios: audios.length, resolution: g.settings.resolution });
      if (problem) throw new Error(`${model.name} ${problem}`);
    }
    if (video && !schema.slots.video) throw new Error(`${model.name} does not take a source video. Pick a video-to-video model in Settings → Operations.`);
    if (g.kind === 'image' && refVideos.length && !schema.slots.clips) throw new InputError('VIDEO_REF_UNSUPPORTED', `${model.name} does not take video references.`);
    if (g.kind === 'image' && refVideos.length < (schema.slots.clips?.min ?? 0)) throw new InputError('VIDEO_REF_REQUIRED', `${model.name} needs a reference video clip.`);
    if (kind === 'image' || kind === 'audio') {
      const problem = audioInputProblem(schema.slots, audios.length);
      if (problem) throw new InputError('AUDIO_INPUT', `${model.name} ${problem}`);
    }
    if (kind === 'audio') {
      if (refs.length || refVideos.length || firstFrame || lastFrame) throw new InputError('AUDIO_MEDIA_INPUT', `${model.name} takes no images or videos.`);
      const song = songProblem(schema, g.prompt, g.settings);
      if (song) throw new InputError(song.code, `${model.name}: ${song.message}`);
    }
    // Audio: the first track to a single-track field (lip-sync, soundtrack), the rest as references.
    const { audio, refAudios } = routeAudio(schema.slots, audios);
    return { refs, refVideos, audios, firstFrame, lastFrame, video, mask, audio, refAudios };
}

type Shots = ReturnType<typeof mapSubjectPrompts>['shots'];
export interface SubjectInputs {
  refs: MediaInput[];
  prompt: string;
  shots: Shots;
  elements?: Array<{ name: string; description?: string; frontal?: MediaInput; refs: MediaInput[]; video?: MediaInput; voiceId?: string }>;
}

/** "@Name" mentions: the provider's elements where it has them, else subject images joined to the references. */
export async function subjectInputs(g: Generation, model: ModelSummary, schema: ModelSchema, slots: SlotInputs): Promise<SubjectInputs> {
  const { refVideos, refAudios } = slots;
  let { refs } = slots;
    // Subjects: "@Name" mentions become the provider's elements (Kling); elsewhere just the name.
    // A plan's own reference (not yet chosen for the library) wins over a library item with the same name.
    const local = g.inputs.subjects ?? [];
    const subjects = [...local, ...(g.inputs.nodeLibrary ?? get().library).filter((x) => !local.some((l) => l.name.toLowerCase() === x.name.toLowerCase()))];
    const elSlot = schema.slots.elements;
    const mappedSubjects = mapSubjectPrompts(g.prompt, g.settings.shots, subjects, schema, model.id, refs.length);
    const mentioned = { ids: mappedSubjects.ids };
    let prompt = mappedSubjects.prompt;
    let elements: Array<{ name: string; description?: string; frontal?: MediaInput; refs: MediaInput[]; video?: MediaInput; voiceId?: string }> | undefined;
    if (elSlot && mentioned.ids.length) {
      if (mentioned.ids.length > elSlot.max) throw new InputError('SUBJECTS_MAX', `${model.name} takes up to ${elSlot.max} subjects; the prompt mentions ${mentioned.ids.length}.`);
      elements = [];
      for (const sid of mentioned.ids) {
        const s = subjects.find((x) => x.id === sid)!;
        const video = elSlot.video && s.videoAssetId ? await mediaInput(s.videoAssetId) : undefined;
        if (!s.frontalAssetId && !video) throw new InputError('SUBJECT_INCOMPLETE', `Subject "${s.name}" needs a frontal image${elSlot.video ? ' or a video' : ''}.`);
        elements.push({
          name: s.name,
          description: s.description,
          frontal: s.frontalAssetId ? await mediaInput(s.frontalAssetId) : undefined,
          refs: await Promise.all(s.refAssetIds.slice(0, elSlot.refMax).map((r) => mediaInput(r))),
          video,
          voiceId: s.voiceId,
        });
      }
    }
    // Models without elements (R10): subject images join the references; the mention becomes the model's own
    // syntax, numbered from the step's real references (frontal views first).
    const subjectImages = mappedSubjects.subjectImages;
    if (subjectImages) {
      if (mentioned.ids.length) {
        const chosen = mentioned.ids.map((id) => subjects.find((x) => x.id === id)!);
        const incomplete = chosen.find((s) => !s.frontalAssetId);
        if (incomplete) throw new InputError('SUBJECT_INCOMPLETE', `Subject "${incomplete.name}" needs a frontal image to be used with ${model.name}.`);
        const used = schema.slots.mixedRefs ? refs.length + refVideos.length + refAudios.length : refs.length;
        const max = refsLimit(schema, g.settings.count);
        const room = max - used;
        if (chosen.length > room) throw new InputError('SUBJECTS_MAX', `${model.name} takes ${max} reference image${max === 1 ? '' : 's'}; the step already has ${used}, so ${chosen.length} subject${chosen.length === 1 ? '' : 's'} do not fit.`);
        const frontals = await Promise.all(chosen.map((s) => mediaInput(s.frontalAssetId!)));
        const views = chosen.flatMap((s) => s.refAssetIds).slice(0, room - chosen.length);
        refs = [...refs, ...frontals, ...(await Promise.all(views.map((id) => mediaInput(id))))];
      }
    }
    return { refs, prompt, shots: mappedSubjects.shots, elements };
}

/** What the model's own rules say about the inputs, the prompt length and the shots; the settings the send runs with. */
export function promptShape(g: Generation, model: ModelSummary, schema: ModelSchema, kind: MediaKind, slots: SlotInputs, subjects: SubjectInputs): { prompt: string; genSettings: GenSettings } {
  const { firstFrame, lastFrame, video, audios } = slots;
  const { refs } = subjects;
  const { refVideos } = slots;
  let { prompt } = subjects;
  const mappedSubjects = { shots: subjects.shots };
    if (kind === 'video' && schema.slots.frameRules) {
      const problem = videoInputProblem(schema.slots, { firstFrame: Boolean(firstFrame), lastFrame: Boolean(lastFrame), sourceVideo: Boolean(video), images: refs.length, videos: refVideos.length, audios: audios.length, resolution: g.settings.resolution });
      if (problem) throw new Error(`${model.name} ${problem}`);
    }
    const promptMax = schema.slots.promptMax;
    if (promptMax && prompt.length > promptMax) throw new InputError('PROMPT_TOO_LONG', `${model.name} takes prompts up to ${promptMax} characters (this one has ${prompt.length}).`);
    // Multi-shot storyboard: shots must add up to the clip; some providers take shots instead of the prompt.
    const shotProblem = schema.slots.shots ? shotsProblem(g.settings.shots, g.settings.duration) : null;
    if (shotProblem) throw new InputError('SHOTS_DURATION', `${model.name}: ${shotProblem}`);
    let genSettings = g.settings;
    if (mappedSubjects.shots) genSettings = { ...g.settings, shots: mappedSubjects.shots };
    if (schema.slots.shots?.exclusivePrompt && g.settings.shots?.length) prompt = '';

    return { prompt, genSettings };
}

/** Keyframe images at frame positions and reference videos as trimmed clips, for the models that take them that way. */
export function structuredSlots(g: Generation, schema: ModelSchema, subjects: SubjectInputs, slots: SlotInputs, settings: GenSettings) {
  let { refs } = subjects;
  let { refVideos } = slots;
  let genSettings = settings;
    // Structured inputs: keyframe images at frame positions, reference videos as trimmed clips.
    let keyframes: Array<{ input: MediaInput; frame: number }> | undefined;
    let clips: Array<{ input: MediaInput; start: number; end: number }> | undefined;
    if (schema.slots.keyframes && refs.length) {
      // Positions need an explicit length (BFL): the chosen one, else the model's default, else its shortest.
      const choices = durationChoices(schema).filter((d) => d > 0);
      const def = Number(paramByRole(schema, 'duration')?.default);
      const duration = genSettings.duration != null && genSettings.duration > 0 ? genSettings.duration : Number.isFinite(def) && def > 0 ? def : choices[0] ?? 5;
      genSettings = { ...genSettings, duration };
      const frames = placeKeyframes(refs.length, duration, schema.slots.keyframes.fps, refs.map((r) => g.inputs.times?.[r.assetId]));
      keyframes = refs.map((input, i) => ({ input, frame: frames[i] }));
      refs = [];
    }
    if (schema.slots.clips && refVideos.length) {
      const slot = schema.slots.clips;
      clips = refVideos.map((input) => {
        const [start, end] = clipTrim(slot, get().assets[input.assetId]?.duration, g.inputs.trims?.[input.assetId]);
        return { input, start, end };
      });
      refVideos = [];
    }

    return { keyframes, clips, refs, refVideos, genSettings };
}
