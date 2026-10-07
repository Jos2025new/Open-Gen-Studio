import { AGENT_OP_IDS, OPS } from './ops';
import type { MediaKind, SettingsChoice, Workspace } from './types';

/** Same boundary used by the runtime and described by both agent-facing contracts. */
export const SETTINGS_POLICY = 'Outside Nodes, only image/video steps require confirm_settings before prompts. An op step, including one using an uploaded image, does not require that card. Settings persist for this request and its revisions; a newly introduced image/video kind needs its own confirmation. Settings confirmation is separate from plan approval and spending authorization.';

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
}

/**
 * Replaces the blanket "always ask" gate with a risk-based decision.
 *
 * - **automate**: reuse existing confirmed settings without asking
 *   (low cost, single result, reversible, model already set).
 * - **expose**: show the card pre-filled but don't block the plan —
 *   the user can change it if they want.
 * - **ask**: block the plan until the user confirms
 *   (new kind, high cost, unknown cost, user chose model, or multiple candidates).
 */
export function needsConfirmation(input: ConfirmationInput): ConfirmationAction {
  const { workspace, kinds, settings, userChoseModel, estimatedCost, hasMultipleCandidates } = input;
  if (workspace === 'node') return 'automate'; // Nodes own their settings per-node.

  for (const kind of kinds) {
    // A kind that was never confirmed must ask.
    if (!settings?.[kind]) return 'ask';
  }

  // Video always asks: high cost, long wait, hard to reverse.
  if (kinds.includes('video')) return 'ask';

  // High or unknown cost asks.
  if (estimatedCost === null || estimatedCost > 0.5) return 'ask';

  // Multiple candidates ask: user should choose count / model.
  if (hasMultipleCandidates) return 'ask';

  // User named a model: expose so they see the card but don't block.
  if (userChoseModel) return 'expose';

  // Low-cost, single result, no user model override: safe to reuse.
  return 'automate';
}

/**
 * Human-readable policy for agent-facing text.
 * Describes when the app decides on its own vs. when it asks.
 */
export const AUTOMATION_POLICY =
  'The app decides automatically when: the request is a low-cost single image, ' +
  'settings are already confirmed for this session, and the user did not name a model. ' +
  'It shows a pre-filled settings card (without blocking) when the user named a model. ' +
  'It asks and blocks when: cost is high or unknown, video is involved, ' +
  'multiple candidates are requested, or a kind has never been confirmed in this session.';

/**
 * Convenience: the gate that runtime uses to decide whether propose_plan is allowed
 * without a preceding confirm_settings call.
 *
 * Returns null (allowed) or a message explaining what the agent must do.
 */
export function planRequiresSettings(workspace: Workspace, kinds: string[], settings: Partial<Record<MediaKind, SettingsChoice>> | undefined): string | null {
  // Keep using the existing function for the strict check:
  // a kind that was never confirmed still blocks.
  const missing = missingSettingsKind(workspace, kinds, settings);
  if (!missing) return null;
  return `Not shown: call confirm_settings first (kind "${missing}") so the user confirms the model, resolution${missing === 'video' ? ', duration' : ', how many images'} and aspect; then write the prompts for the confirmed model and call propose_plan.`;
}

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
