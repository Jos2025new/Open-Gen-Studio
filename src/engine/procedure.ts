import { AGENT_OP_IDS, OPS } from './ops';
import type { MediaKind, SettingsChoice, Workspace } from './types';

/** Same boundary used by the runtime and described by both agent-facing contracts. */
export const SETTINGS_POLICY = 'Outside Nodes, only image/video steps require confirm_settings before prompts. An op step, including one using an uploaded image, does not require that card. Settings persist for this request and its revisions; a newly introduced image/video kind needs its own confirmation. Settings confirmation is separate from plan approval and spending authorization.';

export function missingSettingsKind(workspace: Workspace, kinds: string[], settings: Partial<Record<MediaKind, SettingsChoice>> | undefined): 'image' | 'video' | null {
  if (workspace === 'node') return null;
  return kinds.includes('video') && !settings?.video ? 'video' : kinds.includes('image') && !settings?.image ? 'image' : null;
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
