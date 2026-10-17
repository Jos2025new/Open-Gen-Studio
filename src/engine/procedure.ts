import { DEFAULT_SFX_REF, DEFAULT_SPEECH_REF } from './providers/nanogptAudio';
import { AGENT_OP_IDS, OPS } from './ops';
import type { AgentStyle, MediaKind, SettingsChoice, Workspace } from './types';

/** Question rounds per agent mode: auto one card, guided the rounds from Settings, direct none. */
export function roundsFor(style: AgentStyle, guidedRounds: number): number {
  return style === 'auto' ? 1 : style === 'direct' ? 0 : guidedRounds;
}

/** Same boundary used by the runtime and described by both agent-facing contracts. */
export const SETTINGS_POLICY = 'Outside Nodes, only image/video steps require confirm_settings before prompts. An op step that runs on an image model (edit engine) needs the image kind confirmed and runs on that model; other op steps need no card. A confirmed image/video kind stays confirmed for later requests in this session: a plan reuses it without a new card only when the automation policy allows it (low cost, image steps only, one candidate per step, no named model); otherwise the plan is shown with its choices or the card is asked again. A kind never confirmed needs its own confirmation. Settings confirmation is separate from plan approval and spending authorization.';

export function missingSettingsKind(workspace: Workspace, kinds: string[], settings: Partial<Record<MediaKind, SettingsChoice>> | undefined): 'image' | 'video' | null {
  if (workspace === 'node') return null;
  return kinds.includes('video') && !settings?.video ? 'video' : kinds.includes('image') && !settings?.image ? 'image' : null;
}

/**
 * Automation policy: decide whether a plan needs the settings card, can reuse
 * existing settings silently, or should expose the decision.
 *
 * Impact, detectability and reversibility govern the decision — not just
 * confidence.  §11 of the General Generative Project Model.
 */
export type ConfirmationAction = 'automate' | 'expose' | 'ask';

export interface ConfirmationInput {
  workspace: Workspace;
  /** The media kinds the plan includes (e.g. ['image'] or ['image','video']). */
  kinds: MediaKind[];
  /** Confirmed settings already on the session. */
  settings: Partial<Record<MediaKind, SettingsChoice>> | undefined;
  /** True when the user named or explicitly picked a model for this request. */
  userChoseModel: boolean;
  /** Estimated cost in USD for the plan (null = unknown). */
  estimatedCost: number | null;
  /** The plan has multiple candidate counts (count > 1 per step). */
  hasMultipleCandidates: boolean;
  /** Auto asks the settings card once per kind; spending is still approved on the plan card. */
  style?: AgentStyle;
}

/** Cost above which a plan's price is not reused silently (USD). Default chosen by the implementer; the user can change it. */
export const LOW_COST_USD = 0.5;

/**
 * Automation policy (§11): impact, detectability and reversibility decide, not confidence alone.
 *
 * - **ask** (block until confirm_settings): a kind was never confirmed in this session, or the plan's
 *   cost is unknown or above LOW_COST_USD (costly and hard to undo once paid).
 * - **expose** (no block; the plan card shows the model, count, duration and cost before approval):
 *   a confirmed kind whose cost is low, but the user named a model, the plan is a video, or it asks for
 *   several candidates (count > 1). The decision is visible, not hidden.
 * - **automate**: a confirmed kind, low cost, single result, no model named by the user.
 *
 * Plan approval and spending authorization stay separate (SETTINGS_POLICY); this only decides whether the
 * settings card must come first.
 */
export function needsConfirmation(input: ConfirmationInput): ConfirmationAction {
  const { workspace, kinds, settings, userChoseModel, estimatedCost, hasMultipleCandidates, style } = input;
  if (workspace === 'node') return 'automate'; // Nodes own their settings per-node.

  // A kind never confirmed in this session has nothing to reuse.
  if (kinds.some((kind) => !settings?.[kind])) return 'ask';

  // Unknown or costly plans must be confirmed: the price cannot be bounded enough to reuse silently.
  const costly = estimatedCost === null || estimatedCost > LOW_COST_USD;
  if (costly && style !== 'auto') return 'ask';
  if (costly) return 'expose';

  // Low cost, but a choice the user should see on the card before approving.
  if (userChoseModel || hasMultipleCandidates || kinds.includes('video')) return 'expose';

  return 'automate';
}

/** Why a plan needs its settings card, for the agent (empty when it does not). */
export function settingsAskReason(estimatedCost: number | null): string {
  return estimatedCost === null
    ? 'its cost cannot be predicted'
    : `its estimated cost is $${estimatedCost.toFixed(2)}, above $${LOW_COST_USD.toFixed(2)}`;
}

/**
 * Human-readable policy for agent-facing text. Must describe exactly what needsConfirmation does.
 */
export const AUTOMATION_POLICY =
  'The app reuses settings confirmed earlier in this session, without a new card, when the plan is a low-cost single image per step ' +
  '(no video step, no step with several candidates) and the user did not name a model. It shows the same plan with its model, count and cost on the card ' +
  '(without asking) when the user named a model, the plan is a video, or any step asks for several candidates. ' +
  'It asks and blocks when a kind was never confirmed in this session, or (not in Auto) when the plan\'s cost is unknown or above $' +
  LOW_COST_USD.toFixed(2) + '. In Auto a confirmed kind is never asked again for its cost: the plan card shows the price and the user approves the spending there.';

/**
 * The gate before a plan is normalized: a kind that was never confirmed still blocks, as before.
 * Returns null (allowed) or a message explaining what the agent must do.
 */
export function planRequiresSettings(workspace: Workspace, kinds: string[], settings: Partial<Record<MediaKind, SettingsChoice>> | undefined): string | null {
  const missing = missingSettingsKind(workspace, kinds, settings);
  if (!missing) return null;
  return `Not shown: call confirm_settings first (kind "${missing}") so the user confirms the model, resolution${missing === 'video' ? ', duration' : ', how many images'} and aspect; then write the prompts for the confirmed model and call propose_plan.`;
}

/** The message for a normalized plan whose cost needs the settings card (see needsConfirmation). */
export function costAskMessage(kinds: string[], estimatedCost: number | null): string {
  return `Not shown: ${settingsAskReason(estimatedCost)}. Call confirm_settings so the user confirms the model, resolution and count for ${kinds.join(' and ')}; then call propose_plan again with the confirmed values.`;
}

/** What an audio step makes, and the default model of each kind of sound (speech and effects added 2026-10-08). */
export const AUDIO_STEP = `music (an audio asset) or, with a lyrics model, song lyrics (text); speech: the prompt is exactly the words spoken, params.voice and, for Gemini or GPT-4o mini TTS, params.instructions (tone, pace); model: the composer's audio model if it is a speech model, else ${DEFAULT_SPEECH_REF} unless the user names one; sound effects: the prompt describes the sound, model ${DEFAULT_SFX_REF}.`;

/** Derived from the execution registry, not a second list of operation capabilities. */
export const OP_LINES = AGENT_OP_IDS.map(id => {
  const op = OPS[id];
  const fields = op.fields.map(f => f.options ? `${f.key}: ${f.options.map(o => o.value).join('|')}` : f.key).join(', ');
  const execution = op.engine === 'local' ? 'local execution; no provider' : 'provider generation; plan cost/approval applies';
  return `  ${id} {${fields}} (${op.input} → ${op.output}; ${execution}; engine ${op.engine}) — ${op.description}`;
}).join('\n');

export const OP_RESOLUTION = 'For edit/animate ops, model accepts an explicit compatible reference or family just as image/video steps do. Keep a model named or selected by the user by passing it explicitly; do not replace it with a workflow recommendation. Omitting model does not mean the composer model: execution uses the node choice, explicit op model, compatible source-generation model, then the configured/default operation model. The app validates compatibility and resolves family variants; an incompatible concrete model can be rejected. Image ops preserve source aspect using match-input or the nearest supported ratio; resolution uses the operation model defaults, not guaranteed source resolution. Global style applies to image/video steps, not op; use the operation note/instruction for an additional requested style. Future sources can leave model/format/cost provisional until they exist; the app revalidates before dispatch. Present the plan for approval; do not describe provisional choices as final.';

export const WORKFLOW_CONTRACT = 'Templates are examples of dependencies, not extra deliverables or mandatory counts. Adapt to the requested outputs and available inputs; retain valid sources and user choices. A provided source replaces a template preparation step. Distinct requested outputs use separate steps, each count 1 unless candidates were requested. Do not add a front view, sheet, neutral pose, pilot, candidate set or save action merely because a template contains it. Skills teach technique; they do not redefine the common settings, questions or approval policy.';

/** Shared preservation contract; domain guides specialize properties, not dependency policy. */
export const CONTINUITY_POLICY = 'Across related outputs, identify what must remain and its usable sources (identity, geometry, product details, style, voice, etc.). Reuse supplied sources; an appropriate first requested result can establish an invented source. Declare continuity: [{source, preserve, steps}] for consuming steps, excluding the source itself. Connect those sources through actual compatible refs, first_frame, input or derived content; a scene-to-clip link alone does not connect independent scenes. Repeated descriptions, scheduling and shared model names are not shared sources. Multiple sources and independent outputs are allowed; exclude explicitly requested changes. Explain capability limits rather than promise fidelity. Do not impose a master, project, sheet, save or extra generation. Describe what will be kept in the user language before approval.';

/** Compact video-direction rule included in the shared system prompt for every mode. */
export const VIDEO_DIRECTION_POLICY = 'Every video, mode and domain: preserve the requested medium, aspect, geometry and source identity/style. For related outputs that must share a style, set one plan.style block instead of rewriting it per shot. Recurring @Name subjects need source-backed continuity listing every consuming step, including mentions inside shots. For each reference, state its role and traits to carry/exclude; do not blend whole images. Per shot, specify framing, orientation, action and camera direction, amount, speed and what it reveals. Image-to-video describes changes; do not describe the image again. Describe motion as state → force/contact → response/inertia → result, in the requested 2D, stylised 3D or realistic logic; do not default to realism. Across beats/clips carry subject/object state, screen direction and camera axis unless changed. Distinguish a beat, an explicit cut, a transition generated inside a clip, and clips joined in editing. Time dialogue to its beat (~2.5 words/s); end action before the close and hold the final frame. State output aspect when it differs from references. About 2–5 s and one physical action per beat unless the model guide says otherwise; if beats do not fit the duration, drop beats instead of compressing; group constraints at the end in positive terms; audio: ambience plus at most one element; give any absolute size a visible scale object. Follow the confirmed model guide and available inputs; never promise fidelity.';
/** People in prompts: age and body follow the user or the target, always adults; safety stays. */
export const PEOPLE_RULE = 'Age: every human subject is an adult (18+) unless the work is kid-friendly (kodomo anime, picture books, family scenes) and never sexual. An age or range the user gives is followed exactly and kept in the prompt. Otherwise pick by target and vary inside the range, never a fixed number: social media, influencer, streamer, youtuber, beauty creator, "young" girl or guy, UGC for young audiences 18-22 (24 at most); business, professional, brand spokesperson 24-28; mothers, parents, family 22-32; above 28 only when the request is aimed at a mature sector (executive, doctor, senior, "mature"). Same for men. State it once as a number ("a 19-year-old woman", "an 18-year-old guy", "a 26-year-old businesswoman"), never "early twenties" by habit and never stacked with "mature", "adult features" or "not youthful" (models render that older). Body: follow the requested build (curvy, athletic, muscular, slim, plus-size…) and how prominent they want it, stated concretely (silhouette, proportions, musculature); never soften, average or normalize it, and keep it fitting the age (a young-adult build at 18-22). No sexualization beyond what the user asks. Students of 18-19 (a senior holding a banner for their school or university, a freshman) are fine as 18-19-year-olds in ordinary scenes. Sensual or body-focused requests are adults only: state an explicit age of 18 or more, never sexualize anything that reads as a minor, and keep school uniforms, teen or childlike wording out of sensual scenes.';
/** Which realism register the agent sets on a step. */
export const REALISM_RULE = 'Realism (realistic images and videos only; "realism" on the step): default "balanced" (natural, believable, not ad-polished, not degraded). "everyday" (phone / real footage) when the user says real, footage, grabado/filmado con el móvil, casero, UGC, iPhone, vlog, cámara de mano, como Sora, found footage. "cinematic" (polished lens and light) when they say cine, cinematográfico, anuncio, comercial, spot, película, tráiler, high quality or premium look. "studio" for controlled studio shots. For illustration, anime, painting, vector or 3D set "none". Optional "shot" (portrait, street, product, landscape, interior, food, pet) applies in cinematic only. Edits of a source image keep its style: no realism unless asked. Order: subject → camera + light → mood.';
/** Realistic video only (not 2D or stylised 3D): what makes generated footage look fake lives in time, so ask for less. */
export const VIDEO_REALISM_POLICY = 'Realistic video: one subject and one action per clip, a slow motivated camera, understated motion. Avoid hand close-ups and intricate manipulation, and splashes, shattering or crowds unless asked. No on-screen text in the generation (add it in post). Cadence per register: balanced natural motion blur, everyday 30 fps phone footage with handheld micro-shake, cinematic 24 fps with 180-degree shutter blur. With identity references keep noise and blur mild and never alter identity.';

/** Rules on comparing results, switching models and failed results (docs/history/039). Wired into the agent context after PEOPLE_RULE. */
export const WORK_RULES = [
  'When you compare images, cite each by its result number and asset id ("Result 2, asset:ast_…"): results you looked at arrive numbered.',
  'If the user asks for another provider or model, find it with find_models and set it as the step\'s model (propose_plan model / confirm_settings part); never say you cannot change it: you change it per step, not the composer selector.',
  'If a result comes out empty or wrong, say in one sentence what you saw, no apologies, and immediately propose a new attempt with a concrete adjustment (another seed, a more explicit prompt, another model).',
].map((r) => `- ${r}`).join('\n');
