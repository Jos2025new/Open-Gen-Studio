import { formatUsd, truncate } from '../../lib/format';
import { aspectLabel, capabilityHints, durationChoices, paramByRole } from '../params';
import { skillById, workflowById, describeWorkflow } from '../skills';
import { AGENT_OP_IDS, OPS } from '../ops';
import { PREFERRED, REMOTE_PROVIDERS } from '../providers/registry';
import { isConnected, modelSummary } from '../catalog';
import type { AgentStyle, Session, Workspace } from '../types';
import { useStore } from '../../store/store';
import { activeDoc } from '../design/actions';

const get = useStore.getState;

/** One line per operation, built from OPS so the prompt cannot drift from the registry. */
const OP_LINES = AGENT_OP_IDS.map((id) => {
  const op = OPS[id];
  const fields = op.fields.map((f) => (f.options ? `${f.key}: ${f.options.map((o) => o.value).join('|')}` : f.key)).join(', ');
  return `  ${id} {${fields}} (${op.input} → ${op.output}) — ${op.description}`;
}).join('\n');

export const SYSTEM_PROMPT = `You are the operator of Open Gen Studio, a creative production tool for images, video and layered design. You turn requests into precise, executable plans. You are efficient: you remove ambiguity with specific, sensible decisions and you do exactly what was asked — no extra deliverables, no filler.

How you act
- Creative work (anything that produces or edits images, videos, node flows or layouts) always goes through propose_plan. The app validates the plan, shows it with its cost, the user approves and the app executes it. Never claim you generated something yourself.
- Conversation, advice or questions about the app: answer in plain text, briefly, without tools.
- Mode "auto": never ask questions. Decide missing details yourself (style, framing, lighting, format, count) and propose the plan in this turn.
- Mode "guided": call ask_questions to settle real ambiguity, at most the number of rounds stated in the context, 1-4 questions per round, each with concrete options. When rounds are used up or nothing important is ambiguous, propose the plan.
- Reply in the user's language. Text outside tools: one or two short sentences.

Writing prompts
- Each generation prompt is a complete, specific description: subject, action, setting, composition or shot size, lighting, style, palette, lens; for video also camera movement and motion. Usually 40-120 words. Write prompts in English unless the user asks otherwise; it works best with most models.
- Never bake long text into image prompts. In the Designer, headlines and copy go on text layers.

Plan steps (propose_plan.steps is a DAG; ids s1, s2, … and l1, l2, … for layers)
- image: prompt, model?, aspect?, resolution?, count?, refs? (reference or source images).
- video: prompt, model?, aspect?, duration?, resolution?, audio?, first_frame?, last_frame?, refs? (reference images/videos, or keyframe images in order), times? (keyframe seconds, parallel to refs).
- op: op, input, params? — operations on an existing image or video:
${OP_LINES}
- text: text — copy, or a shared prompt used by image/video steps through prompt_from.
- layer (Designer workspace only): layer_type raster|text|vector.
  raster: source (an image reference), target "base" | "new" | <raster layer id>. "base" is layer 1: the main generated image always goes to base.
  text: text, style {font_family: Inter|Grotesk|Serif|Display|Condensed|Mono, font_size, font_weight, color "#hex", align left|center|right, line_height, letter_spacing}, box {x, y, width} in document pixels, target "new" or an existing text layer id.
  vector: shapes [{type: rect|ellipse|line, x, y, w, h, fill "#hex"|null, stroke "#hex"|null, stroke_width, radius}], target "new" or an existing vector layer id.
  Images only go on raster layers, text only on text layers, shapes only on vector layers. Video cannot be placed on layers.
- References: "s1" (first output of step s1), "s1#2" (its second output), "asset:<id>" (an existing asset listed in the context), "layer:<id>" (pixels of a raster layer).
- Omit "model" to use the user's selected model; the app switches to an image-capable variant when refs or first_frame are used. Set "model" only to a ref listed in the context when it is clearly a better fit.
- Keep plans minimal: the fewest steps that fully deliver the request. count defaults to 1; use more only when asked or clearly useful (max 4).
- In the Node workspace the plan becomes connected nodes: structure it as a clean left-to-right flow (use text steps + prompt_from when several steps share a prompt).
- The app computes costs from provider prices; do not quote prices.
- If the validator rejects a plan, fix exactly the reported problems and call propose_plan again.

Model-specific inputs (each model's accepted inputs are listed in the context; use only what it lists)
- Reference-to-video models take refs (images, and videos where listed) instead of first_frame; describe in the prompt what each reference is for (character, style, setting).
- Keyframe models (FLUX 3 keyframes-to-video): refs are the keyframe images in order. One image opens the clip; two pin start and end (works best when they share camera position, lighting and objects); 3–10 form an experimental storyboard spread evenly, reliable for simple transitions, weak for large subject motion. Set an explicit duration (5–20 s): it sets the pace, shorter is punchier. Use times only to pin a moment on purpose; positions must be unique. Keep the output aspect equal to the keyframes' aspect. The prompt describes the journey between frames ("starts as…, then…, ends as…"); write HARD CUT only when a cut is wanted.
- Clip models (video_clips): a video ref is trimmed to the span the model takes; the app picks the whole clip or its first seconds.
- Audio: an audio asset in refs is the speech for lip-sync / avatar models (required there), an optional soundtrack, or reference audio, as the model's inputs say.
- Seedance 2.5 edits or extends a clip through the video_edit / video_extend ops (edit: clips of 4–30 s; extend: 2–30 s).
- Subjects (Kling models listing "subjects"): mention a session subject as @Name in the prompt; the app sends its images as the model's element and keeps the identity. Use only subjects listed in the context.
- Multi-shot (models listing "multi-shot"): shots [{prompt, duration}] whose seconds add up to the step duration; one clear action per shot.
Sources: docs.bfl.ai/flux_3/flux3_video, runware.ai FLUX 3 keyframes guide.`;

function describeModel(kind: 'image' | 'video'): string {
  const st = get();
  const { modelRef, settings } = st.composer[kind];
  const m = modelSummary(modelRef);
  const schema = st.catalog.schemas[modelRef];
  const parts = [`${modelRef}${m ? ` (${m.name})` : ''}`];
  const aspect = paramByRole(schema, 'aspect');
  if (aspect?.options?.length) parts.push(`aspects [${aspect.options.map(aspectLabel).join(', ')}]`);
  const res = paramByRole(schema, 'resolution');
  if (res?.options?.length) parts.push(`resolutions [${res.options.join(', ')}]`);
  if (kind === 'video') {
    const d = durationChoices(schema);
    if (d.length) parts.push(`durations [${d.map((x) => (x > 0 ? x : 'auto')).join(', ')}]s`);
    if (paramByRole(schema, 'audio')) parts.push('audio optional');
  }
  parts.push(`inputs: ${capabilityHints(schema, kind).join('; ')}`);
  const cur = [
    settings.aspect ? `aspect ${aspectLabel(settings.aspect)}` : '',
    settings.resolution ? `resolution ${settings.resolution}` : '',
    kind === 'video' && settings.duration ? `duration ${settings.duration}s` : '',
    kind === 'image' ? `count ${settings.count}` : '',
  ].filter(Boolean);
  if (cur.length) parts.push(`current: ${cur.join(', ')}`);
  return parts.join(' · ');
}

/** "image 1024×768", "video 1280×720 5.0s", "audio 12.4s". */
function assetShape(a: { kind: string; width: number; height: number; duration?: number }): string {
  const secs = a.duration ? ` ${a.duration.toFixed(1)}s` : '';
  return a.kind === 'audio' ? `audio${secs}` : `${a.kind} ${a.width}×${a.height}${secs}`;
}

function alternatives(): string {
  const st = get();
  const lines: string[] = [];
  for (const p of REMOTE_PROVIDERS) {
    if (!isConnected(p)) continue;
    const ids = [...PREFERRED[p].image.slice(0, 2), ...PREFERRED[p].edit.slice(0, 1), ...PREFERRED[p].video.slice(0, 2)];
    for (const id of ids) {
      const m = modelSummary(`${p}::${id}`);
      if (m) lines.push(`${m.ref} — ${m.kind}${m.acceptsImage ? ', image input' : ''} — ${m.name}`);
    }
    // Models with special inputs, so the agent can pick one when the request needs it.
    const special = Object.values(st.catalog.models).filter((m) => m.provider === p && /(keyframes|reference)-to-(video|image)/.test(m.id)).slice(0, 6);
    for (const m of special) {
      const schema = st.catalog.schemas[m.ref];
      lines.push(`${m.ref} — ${m.kind} — ${m.name}${schema ? ` — inputs: ${capabilityHints(schema, m.kind).join('; ')}` : ''}`);
    }
  }
  return lines.length ? lines.join('\n') : 'Only the local demo models are connected.';
}

export function buildContext(session: Session, opts: { workspace: Workspace; style: AgentStyle; round: number; maxRounds: number; attachments: string[] }): string {
  const st = get();
  const lines: string[] = [];
  lines.push(`workspace: ${opts.workspace}`);
  lines.push(
    opts.style === 'auto'
      ? 'mode: auto (one shot: do not ask questions)'
      : `mode: guided (question rounds used ${opts.round} of ${opts.maxRounds}${opts.round >= opts.maxRounds ? ' — propose the plan now' : ''})`,
  );
  const skill = skillById(st.composer.skillId);
  if (skill) lines.push(`skill: ${skill.name} — ${skill.guidance}`);
  const wf = workflowById(st.composer.workflowId);
  if (wf) lines.push(`workflow (follow this structure, adapt prompts to the request):\n${describeWorkflow(wf)}`);
  const subjects = session.subjects ?? [];
  if (subjects.length) lines.push(`subjects (mention as @Name): ${subjects.map((s) => `@${s.name}${s.description ? ` — ${s.description}` : ''}`).join(', ')}`);
  lines.push(`image model: ${describeModel('image')}`);
  lines.push(`video model: ${describeModel('video')}`);
  lines.push(`other models:\n${alternatives()}`);
  if (opts.attachments.length) {
    lines.push(
      `attached by the user: ${opts.attachments
        .map((id) => {
          const a = st.assets[id];
          return a ? `asset:${id} (${assetShape(a)})` : '';
        })
        .filter(Boolean)
        .join(', ')}`,
    );
  }
  const recent = Object.values(st.assets)
    .filter((a) => a.sessionId === session.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 10);
  if (recent.length) {
    lines.push(
      `recent assets (newest first):\n${recent
        .map((a) => {
          const g = a.generationId ? st.generations[a.generationId] : undefined;
          const what = g ? (g.op ? OPS[g.op.id].label : truncate(g.prompt, 70)) : a.origin;
          return `  asset:${a.id} — ${assetShape(a)} — ${what}`;
        })
        .join('\n')}`,
    );
  }
  if (opts.workspace === 'designer') {
    const doc = activeDoc(session.id);
    if (doc) {
      const layers = doc.layers.map((l, i) => `  ${i + 1}. ${l.id} ${l.type} "${l.name}"${l.id === doc.activeLayerId ? ' (active)' : ''}${l.locked ? ' (locked)' : ''}`);
      lines.push(`designer document "${doc.name}" ${doc.width}×${doc.height}px; layers bottom→top:\n${layers.join('\n') || '  (empty)'}`);
    } else {
      lines.push('designer: no document yet (one is created at the composer image aspect; the generated image becomes layer 1).');
    }
  }
  if (opts.workspace === 'node') {
    const g = session.graph;
    lines.push(`node graph: ${g.nodes.length} nodes, ${g.edges.length} connections (new flows are placed beside existing ones)`);
  }
  const remaining = st.settings.budgetUsd - st.spentUsd;
  lines.push(`budget remaining: ${formatUsd(Math.max(0, remaining))}`);
  if (session.agent.notes.length) lines.push(`since your last turn:\n${session.agent.notes.map((n) => `  - ${n}`).join('\n')}`);
  return `<studio_context>\n${lines.join('\n')}\n</studio_context>`;
}
