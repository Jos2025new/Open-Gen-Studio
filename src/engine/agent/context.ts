import { formatUsd, truncate } from '../../lib/format';
import { aspectLabel, durationChoices, paramByRole } from '../params';
import { skillById, workflowById, describeWorkflow } from '../skills';
import { OPS } from '../ops';
import { PREFERRED, REMOTE_PROVIDERS } from '../providers/registry';
import { isConnected, modelSummary } from '../catalog';
import type { AgentStyle, Session, Workspace } from '../types';
import { useStore } from '../../store/store';
import { activeDoc } from '../design/actions';

const get = useStore.getState;

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
- video: prompt, model?, aspect?, duration?, resolution?, audio?, first_frame?, last_frame?.
- op: op, input, params? — operations on an existing image or video:
  relight {preset: golden-hour|softbox|overcast|rim|neon|candle|moonlight|chiaroscuro, direction: left|right|top|front|behind|below, intensity: subtle|medium|strong}
  angle {angle: front|three-quarter-left|three-quarter-right|profile-left|profile-right|back|top-down|high|low|close-up|wide}
  upscale {factor: 2|4} · remove_bg {} · reframe {aspect} · variations {strength: subtle|medium|strong, count: 1-4} · edit {instruction}
  animate {motion} (image → video) · extract_frame {which: first|last} (video → image, free) · continue {motion} (video → next clip from its last frame)
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
- If the validator rejects a plan, fix exactly the reported problems and call propose_plan again.`;

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
    if (d.length) parts.push(`durations [${d.join(', ')}]s`);
    parts.push(schema?.slots.firstFrame ? 'accepts first_frame' : 'text-to-video only');
    if (paramByRole(schema, 'audio')) parts.push('audio optional');
  } else {
    parts.push(schema?.slots.images ? `accepts up to ${schema.slots.images.max} refs` : 'no image input');
  }
  const cur = [
    settings.aspect ? `aspect ${aspectLabel(settings.aspect)}` : '',
    settings.resolution ? `resolution ${settings.resolution}` : '',
    kind === 'video' && settings.duration ? `duration ${settings.duration}s` : '',
    kind === 'image' ? `count ${settings.count}` : '',
  ].filter(Boolean);
  if (cur.length) parts.push(`current: ${cur.join(', ')}`);
  return parts.join(' · ');
}

function alternatives(): string {
  const lines: string[] = [];
  for (const p of REMOTE_PROVIDERS) {
    if (!isConnected(p)) continue;
    const ids = [...PREFERRED[p].image.slice(0, 2), ...PREFERRED[p].edit.slice(0, 1), ...PREFERRED[p].video.slice(0, 2)];
    for (const id of ids) {
      const m = modelSummary(`${p}::${id}`);
      if (m) lines.push(`${m.ref} — ${m.kind}${m.acceptsImage ? ', image input' : ''} — ${m.name}`);
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
  lines.push(`image model: ${describeModel('image')}`);
  lines.push(`video model: ${describeModel('video')}`);
  lines.push(`other models:\n${alternatives()}`);
  if (opts.attachments.length) {
    lines.push(
      `attached by the user: ${opts.attachments
        .map((id) => {
          const a = st.assets[id];
          return a ? `asset:${id} (${a.kind} ${a.width}×${a.height})` : '';
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
          return `  asset:${a.id} — ${a.kind} ${a.width}×${a.height} — ${what}`;
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
