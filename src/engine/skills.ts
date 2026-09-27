import { MODEL_GUIDES, modelGuide } from './guides';
import type { Workspace } from './types';

/* Skills shape how the agent writes prompts; workflows give it a proven step structure. */

export interface Skill {
  id: string;
  name: string;
  description: string;
  /** Guidance appended to the agent context while the skill is active. */
  guidance: string;
  /** Short suffix the offline planner appends to prompts. */
  promptHint: string;
}

export interface WorkflowStepTemplate {
  id: string;
  kind: 'image' | 'video' | 'op' | 'text' | 'layer';
  title: string;
  /** `{prompt}` is replaced by the user's request. */
  prompt?: string;
  op?: string;
  input?: string;
  /** join_clips: the clips after `input`, in order. */
  more?: string[];
  params?: Record<string, string>;
  refs?: string[];
  firstFrame?: string;
  aspect?: string;
  layerType?: 'raster' | 'text' | 'vector';
  source?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  workspaces: Workspace[];
  /** Skill applied with this workflow when the user picked none. */
  skill?: string;
  /** Values the workflow decides and does not ask. Never the resolution: it follows the chosen quality (cost). */
  fixed?: { model?: string; aspect?: string; audio?: boolean };
  /** Inputs the workflow needs; missing ones are asked in the one questions card. */
  needs?: string[];
  /** Formats of the same workflow; only the chosen one is loaded. */
  variants?: Array<{ id: string; name: string; description: string; steps?: WorkflowStepTemplate[] }>;
  /** How steps chain: what an approved result feeds next, and the one identity kept throughout. */
  continuity?: string;
  steps: WorkflowStepTemplate[];
}

export const SKILLS: Skill[] = [
  {
    id: 'product',
    name: 'Product photography',
    description: 'Commercial product shots: studio light, clean sets, hero angles.',
    guidance: 'Write prompts like a commercial product photographer: hero angle, controlled studio or lifestyle lighting, lens (e.g. 85mm, macro), surface and reflections, clean negative space for copy. Keep the product exact across steps by passing it as a reference.',
    promptHint: 'commercial product photography, studio lighting, crisp detail, clean background',
  },
  {
    id: 'character',
    name: 'Character consistency',
    description: 'Keep the same character across images and shots.',
    guidance: 'Establish the character once (a clear front view) and pass that output as a reference to every later image step. Repeat identity anchors (face, hair, outfit, palette) in each prompt.',
    promptHint: 'consistent character, same face and outfit',
  },
  {
    id: 'cinematic',
    name: 'Cinematic video',
    description: 'Shot language, camera moves and film lighting.',
    guidance: 'Describe shots with film language: shot size, lens, camera movement (dolly, crane, handheld), subject action, lighting and mood, in one sentence per beat. Prefer 16:9 unless asked otherwise. Generate a still first when image-to-video will improve control.',
    promptHint: 'cinematic, anamorphic lens, film grain, dramatic lighting',
  },
  {
    id: 'social',
    name: 'Social ad',
    description: 'Scroll-stopping vertical creatives with room for copy.',
    guidance: 'Default to 9:16 (stories/reels) or 4:5 (feed). Strong focal subject, high contrast, a clear hook, safe margins for UI, space for a headline.',
    promptHint: 'bold social media ad, high contrast, clear focal point, space for headline',
  },
  {
    id: 'poster',
    name: 'Poster & typography',
    description: 'Layouts with headline, hierarchy and negative space.',
    guidance: 'Think as a graphic designer: generate a background with deliberate negative space, then add real text layers (headline, subline) and simple vector accents in the Designer. Never bake long text into the image.',
    promptHint: 'poster background, strong composition, generous negative space for typography',
  },
  {
    id: 'brand',
    name: 'Brand identity',
    description: 'Moodboards, marks and on-brand visuals.',
    guidance: 'Keep a single palette and visual language across outputs. State colors as hex values, materials and typography mood explicitly.',
    promptHint: 'cohesive brand visual, consistent palette, minimal',
  },
  {
    id: 'storyboard',
    name: 'Storyboard',
    description: 'Sequential frames with continuity.',
    guidance: 'Break the idea into numbered beats. Keep style, characters and lighting continuous; reference the first frame in later frames.',
    promptHint: 'storyboard frame, consistent style, continuity',
  },
  {
    id: 'ugc',
    name: 'UGC look',
    description: 'Authentic, phone-shot creator content.',
    guidance: 'Handheld smartphone look, natural light, real environments, casual framing, slight imperfections. Vertical by default.',
    promptHint: 'authentic UGC, shot on phone, natural light, handheld',
  },
  {
    id: 'fashion',
    name: 'Fashion editorial',
    description: 'Editorial styling, poses and lighting.',
    guidance: 'Write like a fashion photographer: styling, fabric, pose, location, strobe or natural light, editorial color grade.',
    promptHint: 'high fashion editorial, styled, magazine quality',
  },
  {
    id: 'interior',
    name: 'Interiors & architecture',
    description: 'Spaces, materials and natural light.',
    guidance: 'Specify architectural style, materials, time of day and camera height; keep verticals straight (architectural photography).',
    promptHint: 'architectural photography, natural light, straight verticals',
  },
];

export const WORKFLOWS: Workflow[] = [
  {
    id: 'image-to-video',
    name: 'Image → Video',
    description: 'Design the key still, then animate it.',
    workspaces: ['chat', 'node'],
    skill: 'cinematic',
    needs: ['a start image or a description of the subject'],
    continuity: 'The key frame is the first frame of the clip.',
    steps: [
      { id: 's1', kind: 'image', title: 'Key frame', prompt: '{prompt}', aspect: '16:9' },
      { id: 's2', kind: 'video', title: 'Animate', prompt: '{prompt}, subtle natural motion, slow camera push-in', firstFrame: 's1', aspect: '16:9' },
    ],
  },
  {
    id: 'product-pack',
    name: 'Product ad pack',
    description: 'Hero shot, relit variant, vertical cut and a short clip.',
    workspaces: ['chat', 'node'],
    skill: 'product',
    needs: ['the product (photo or description)'],
    continuity: 'One product identity: every step derives from the hero shot.',
    steps: [
      { id: 's1', kind: 'image', title: 'Hero shot', prompt: '{prompt}, hero product shot, studio lighting', aspect: '1:1' },
      { id: 's2', kind: 'op', title: 'Golden relight', op: 'relight', input: 's1', params: { preset: 'golden-hour', direction: 'left', intensity: 'medium' } },
      { id: 's3', kind: 'op', title: 'Vertical 9:16', op: 'reframe', input: 's1', params: { aspect: '9:16' } },
      { id: 's4', kind: 'op', title: 'Product clip', op: 'animate', input: 's1', params: { motion: 'slow orbit around the product, soft reflections' } },
    ],
  },
  {
    id: 'character-sheet',
    name: 'Character sheet',
    description: 'One character from four angles.',
    workspaces: ['chat', 'node'],
    skill: 'character',
    needs: ['the character (image or description)'],
    continuity: 'Every view derives from the front view; one identity throughout.',
    steps: [
      { id: 's1', kind: 'image', title: 'Front view', prompt: '{prompt}, full body, front view, neutral background', aspect: '3:4' },
      { id: 's2', kind: 'op', title: '3/4 view', op: 'angle', input: 's1', params: { angle: 'three-quarter-left' } },
      { id: 's3', kind: 'op', title: 'Profile', op: 'angle', input: 's1', params: { angle: 'profile-right' } },
      { id: 's4', kind: 'op', title: 'Back view', op: 'angle', input: 's1', params: { angle: 'back' } },
    ],
  },
  {
    id: 'storyboard',
    name: 'Storyboard · 4 shots',
    description: 'Four continuous frames of one scene.',
    workspaces: ['chat', 'node'],
    skill: 'storyboard',
    needs: ['the story or scene'],
    fixed: { aspect: '16:9' },
    continuity: 'Shots 2–4 use shot 1 as reference; neighboring shots change at least one of shot size, subject or angle.',
    steps: [
      { id: 's1', kind: 'image', title: 'Shot 1 · establishing', prompt: '{prompt}, establishing wide shot', aspect: '16:9' },
      { id: 's2', kind: 'image', title: 'Shot 2 · medium', prompt: '{prompt}, medium shot, same scene and style', refs: ['s1'], aspect: '16:9' },
      { id: 's3', kind: 'image', title: 'Shot 3 · close-up', prompt: '{prompt}, close-up detail, same scene and style', refs: ['s1'], aspect: '16:9' },
      { id: 's4', kind: 'image', title: 'Shot 4 · closing', prompt: '{prompt}, closing shot, same scene and style', refs: ['s1'], aspect: '16:9' },
    ],
  },
  {
    id: 'social-set',
    name: 'Social format set',
    description: 'One visual adapted to 1:1, 4:5 and 9:16.',
    workspaces: ['chat', 'node'],
    skill: 'social',
    needs: ['the subject or message'],
    continuity: 'Every format reframes the master.',
    steps: [
      { id: 's1', kind: 'image', title: 'Master', prompt: '{prompt}', aspect: '1:1' },
      { id: 's2', kind: 'op', title: 'Feed 4:5', op: 'reframe', input: 's1', params: { aspect: '4:5' } },
      { id: 's3', kind: 'op', title: 'Story 9:16', op: 'reframe', input: 's1', params: { aspect: '9:16' } },
    ],
  },
  {
    id: 'shot-sequence',
    name: 'Shot sequence',
    description: 'Key frame, first clip and a continuation.',
    workspaces: ['chat', 'node'],
    skill: 'cinematic',
    needs: ['the scene or a start image', 'total duration'],
    fixed: { aspect: '16:9' },
    continuity: 'Each clip continues from the last frame of the previous one; neighboring clips change at least one of shot size, subject or angle.',
    steps: [
      { id: 's1', kind: 'image', title: 'Key frame', prompt: '{prompt}', aspect: '16:9' },
      { id: 's2', kind: 'video', title: 'Clip 1', prompt: '{prompt}', firstFrame: 's1', aspect: '16:9' },
      { id: 's3', kind: 'op', title: 'Clip 2', op: 'continue', input: 's2', params: { motion: 'the action continues naturally' } },
    ],
  },
  {
    // F2: the agreed story flow (brief in one card → subject → one plan with every clip → join), built from the
    // Higgsfield and ImagineArt comparisons. The clip count and length come from the request, never from the refs.
    id: 'story',
    name: 'Story / series',
    description: 'A short story, a series episode or several clips with a recurring character: brief, one identity, closed beats, one joined video.',
    workspaces: ['chat'],
    skill: 'cinematic',
    needs: [
      'tone or genre (offer 2–3 treatments as options when the brief is abstract or the user has no idea; recommend the one that fits the image)',
      'sound: dialogue or voice-over, music and ambience, or silent (only for models with audio)',
      'format: the attached image\'s aspect (recommended) or another',
      'character references first? "No, use my image" (recommended when the image shows the character clearly) or "Yes, a character sheet first" (a cheap first plan; the user picks one, then the clips)',
    ],
    continuity:
      'One identity: save the character as a subject in propose_plan.subjects (from the attached image, or from the character-sheet image the user picked) and mention it as @Name in every clip — never describe her look again. Each clip is one closed beat with a start and an end (hook → conflict → payoff), written as action, camera and sound; the durations add up to the requested total (set total_duration). Neighboring clips change at least one of shot size, subject or angle. All clips go in one plan (the user unchecks what they do not want), followed by join_clips over them in order. If the story does not fit the length, say so with numbers and offer extending, focusing on one moment or compressing in the questions card.',
    steps: [
      { id: 's1', kind: 'video', title: 'Clip 1 · hook', prompt: '{prompt}' },
      { id: 's2', kind: 'video', title: 'Clip 2 · conflict', prompt: '{prompt}' },
      { id: 's3', kind: 'video', title: 'Clip 3 · payoff', prompt: '{prompt}' },
      { id: 's4', kind: 'op', title: 'Join clips', op: 'join_clips', input: 's1', more: ['s2', 's3'] },
    ],
  },
  {
    id: 'poster',
    name: 'Poster layout',
    description: 'Background on layer 1, headline and accent layers on top.',
    workspaces: ['designer'],
    skill: 'poster',
    needs: ['the headline', 'date or details'],
    steps: [
      { id: 's1', kind: 'image', title: 'Background', prompt: '{prompt}, poster background with negative space for a headline' },
      { id: 'l1', kind: 'layer', title: 'Background', layerType: 'raster', source: 's1' },
      { id: 'l2', kind: 'layer', title: 'Headline', layerType: 'text' },
      { id: 'l3', kind: 'layer', title: 'Accent', layerType: 'vector' },
    ],
  },
];

export function workflowById(id: string | null | undefined): Workflow | undefined {
  return WORKFLOWS.find((w) => w.id === id);
}

export function skillById(id: string | null | undefined): Skill | undefined {
  return SKILLS.find((s) => s.id === id);
}

/** The skill in effect: the one the user picked, else the one the workflow recommends. */
export function activeSkill(skillId: string | null | undefined, workflowId: string | null | undefined): Skill | undefined {
  return skillById(skillId) ?? skillById(workflowById(workflowId)?.skill);
}

export function describeWorkflow(w: Workflow): string {
  const lines = w.steps.map((s) => {
    const parts = [`${s.id}: ${s.kind}${s.op ? `(${s.op})` : ''}${s.layerType ? `(${s.layerType})` : ''} "${s.title}"`];
    if (s.input) parts.push(`input ${s.input}`);
    if (s.more?.length) parts.push(`more ${s.more.join(',')}`);
    if (s.firstFrame) parts.push(`first_frame ${s.firstFrame}`);
    if (s.refs?.length) parts.push(`refs ${s.refs.join(',')}`);
    if (s.source) parts.push(`source ${s.source}`);
    if (s.aspect) parts.push(`aspect ${s.aspect}`);
    return `  - ${parts.join(', ')}`;
  });
  const extra = [
    w.fixed ? `fixed (do not ask): ${Object.entries(w.fixed).map(([k, v]) => `${k} ${v}`).join(', ')}` : '',
    w.needs?.length ? `needs (ask the missing ones in the one questions card): ${w.needs.join('; ')}` : '',
    w.continuity ? `continuity: ${w.continuity}` : '',
    w.variants?.length ? `variants: ${w.variants.map((v) => `${v.id} (${v.description})`).join('; ')}` : '',
  ].filter(Boolean);
  return [`${w.name}: ${w.description}`, ...lines, ...extra.map((e) => `  ${e}`)].join('\n');
}

/** One line per workflow and skill, for the agent's system prompt: name and when to use it. */
export function guideIndex(): string {
  return [
    ...WORKFLOWS.map((w) => `  workflow:${w.id} — ${w.name}: ${w.description}${w.variants?.length ? ` (variants: ${w.variants.map((v) => v.id).join(', ')})` : ''}`),
    ...SKILLS.map((k) => `  skill:${k.id} — ${k.name}: ${k.description}`),
    ...MODEL_GUIDES.map((g) => `  model:${g.id} — how to write prompts for ${g.name}`),
  ].join('\n');
}

/** The full text of a skill or workflow for read_guide ("skill:product", "workflow:storyboard", "workflow:ugc/unboxing"). */
export function readGuide(id: string): string | undefined {
  const [type, rest = ''] = id.trim().split(':');
  if (type === 'model') return modelGuide(rest)?.text;
  if (type === 'skill') {
    const k = skillById(rest);
    return k ? `${k.name}: ${k.guidance}` : undefined;
  }
  if (type !== 'workflow') return undefined;
  const [wid, variant] = rest.split('/');
  const w = workflowById(wid);
  if (!w) return undefined;
  const v = variant ? w.variants?.find((x) => x.id === variant) : undefined;
  if (variant && !v) return undefined;
  const chosen: Workflow = v ? { ...w, name: `${w.name} · ${v.name}`, description: v.description, steps: v.steps ?? w.steps, variants: undefined } : w;
  const skill = skillById(w.skill);
  return `workflow (follow this structure, adapt prompts to the request):\n${describeWorkflow(chosen)}${skill ? `\nskill ${skill.name}: ${skill.guidance}` : ''}`;
}
