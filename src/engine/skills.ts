import { MODEL_GUIDES, modelGuide } from './guides';
import type { Workspace } from './types';
import productGuide from './guides/product.md?raw';
import socialGuide from './guides/social.md?raw';
import directingGuide from './guides/directing.md?raw';
import archvizGuide from './guides/archviz.md?raw';
import archvizMotionGuide from './guides/archviz-motion.md?raw';
import archvizSketchGuide from './guides/archviz-sketch.md?raw';

/* Skills shape how the agent writes prompts; workflows give it a proven step structure. */

export interface Skill {
  id: string;
  name: string;
  description: string;
  /** Guidance appended to the agent context while the skill is active. */
  guidance: string;
  /** Full guide, returned only by read_guide (never injected in every message like `guidance`). */
  guide?: string;
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
  /** Skills the agent loads for particular steps (what each one teaches is in its index line). */
  skills?: Array<{ id: string; for: string }>;
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
    guidance: 'Write prompts like a commercial product photographer: one product sheet repeated in every prompt, the product photo as a reference in every step, light with direction and color temperature, lens and aperture per shot, a grounded contact shadow, negative space where copy goes. Load skill:product for the full guide before writing prompts.',
    guide: productGuide,
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
    guidance: 'Describe shots with film language: shot size, lens, camera movement (dolly, crane, handheld), subject action, lighting and mood, in one sentence per beat. Prefer 16:9 unless asked otherwise. Generate a still first when image-to-video will improve control. Load skill:cinematic before writing clip prompts (exact camera moves, emotion as visible causes, identity on clips without an image).',
    guide: directingGuide,
    promptHint: 'cinematic, anamorphic lens, film grain, dramatic lighting',
  },
  {
    id: 'social',
    name: 'Social ad',
    description: 'Scroll-stopping vertical creatives with room for copy.',
    guidance: 'Default to 9:16 (stories/reels) or 4:5 (feed). Strong focal subject, high contrast, a clear hook, safe margins for UI, space for a headline. Claims only verified ones. Load skill:social for the full guide (brief, concepts, copy, which flow) before planning.',
    guide: socialGuide,
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
    guidance: 'Specify architectural style, materials, time of day and camera height; keep verticals straight (architectural photography). For a project (renders, views, walkthroughs) load skill:archviz.',
    promptHint: 'architectural photography, natural light, straight verticals',
  },
  {
    id: 'archviz',
    name: 'Archviz stills',
    description: 'Architectural renders: building sheet, materials, light, camera and straight verticals, scale.',
    guidance: 'Write like an architectural photographer: one building sheet repeated in every view, one light condition with direction, eye-level camera with straight verticals, materials per surface. Load skill:archviz for the full guide before writing prompts.',
    guide: archvizGuide,
    promptHint: 'architectural visualization, photoreal render, tilt-shift, straight verticals, natural light',
  },
  {
    id: 'archviz-motion',
    name: 'Archviz walkthroughs',
    description: 'Camera moves for walkthroughs and flythroughs from a render: one slow move per clip, subtle life, rigid structure.',
    guidance: 'From an approved render: one slow, stable camera move per clip (dolly, tracking, orbit, drone reveal), subtle ambient life, architecture rigid and unchanged. Load skill:archviz-motion before writing video prompts.',
    guide: archvizMotionGuide,
    promptHint: 'slow steady architectural walkthrough, rigid structure, subtle ambient motion',
  },
  {
    id: 'archviz-sketch',
    name: 'Sketch to render',
    description: 'A sketch, clay model or floor plan turned into a photoreal render that keeps its massing and openings.',
    guidance: 'The sketch is the design: keep massing, proportions, openings and viewpoint; add only materials, light and landscape, as an edit of the attached image. Load skill:archviz-sketch before writing the prompt.',
    guide: archvizSketchGuide,
    promptHint: 'photoreal architectural render from sketch, exact massing and openings',
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
    // Default set from Buzzy Agent (the shots that sell); formats from Higgsfield as variants.
    id: 'product-pack',
    name: 'Product photoshoot',
    description: 'Product set that sells: hero, lifestyle, detail and features shot; or one format (packshot, banner, carousel, ad pack, try-on, CGI, restyle).',
    workspaces: ['chat', 'node'],
    skill: 'product',
    needs: [
      'the product (photo, or a description with shape, materials and colors)',
      'destination: marketplace 1:1, feed 4:5, stories 9:16, Pinterest 2:3 or web banner 16:9 (sets the aspect)',
      'style: clean studio white, minimal, dramatic luxury or lifestyle',
      'brand colors (hex), if any',
      'how many variants per shot',
      'a short video of the hero? "No" (recommended) or 360° turn / slow orbit',
      'a second refining pass (label, edges, reflections; costs one edit per image)? "No" (recommended) or "Yes"',
    ],
    continuity:
      'One product identity: write the product sheet once and repeat it in every prompt; pass the product photo as a reference in every step and the hero (s1) in later ones. Never change the product between shots. Video and second pass only when the user said yes: an animate step from the approved hero, an edit step per chosen image.',
    variants: [
      { id: 'packshot', name: 'Packshot', description: 'Catalog: neutral or white background, three clean angles.', steps: [
        { id: 's1', kind: 'image', title: 'Front', prompt: '{prompt}, packshot on seamless white, soft studio light', aspect: '1:1' },
        { id: 's2', kind: 'op', title: '3/4 view', op: 'angle', input: 's1', params: { angle: 'three-quarter-left' } },
        { id: 's3', kind: 'op', title: 'Top view', op: 'angle', input: 's1', params: { angle: 'top-down' } },
      ] },
      { id: 'lifestyle', name: 'Lifestyle', description: 'The product in real use: three scenes with hands or action.', steps: [
        { id: 's1', kind: 'image', title: 'Scene 1', prompt: '{prompt}, lifestyle, product in use, natural light', aspect: '4:5' },
        { id: 's2', kind: 'image', title: 'Scene 2', prompt: '{prompt}, lifestyle, another moment of use', refs: ['s1'], aspect: '4:5' },
        { id: 's3', kind: 'image', title: 'Scene 3', prompt: '{prompt}, lifestyle, hands interacting with the product', refs: ['s1'], aspect: '4:5' },
      ] },
      { id: 'closeup', name: 'Close-up with a person', description: 'Hands, face and product: application or demo.', steps: [
        { id: 's1', kind: 'image', title: 'Close-up', prompt: '{prompt}, close-up, hands and face with the product, application', aspect: '4:5' },
      ] },
      { id: 'pinterest', name: 'Pinterest', description: 'Vertical 2:3 moodboard aesthetic.', steps: [
        { id: 's1', kind: 'image', title: 'Pin', prompt: '{prompt}, editorial moodboard styling, vertical', aspect: '2:3' },
      ] },
      { id: 'hero-banner', name: 'Hero banner', description: 'Wide web, email or campaign header with copy space.', steps: [
        { id: 's1', kind: 'image', title: 'Banner', prompt: '{prompt}, wide hero banner, product on the left third, empty space on the right for copy', aspect: '16:9' },
      ] },
      { id: 'carousel', name: 'Social carousel', description: '3–10 connected slides with one visual system.', steps: [
        { id: 's1', kind: 'image', title: 'Slide 1 · cover', prompt: '{prompt}, carousel cover', aspect: '4:5' },
        { id: 's2', kind: 'image', title: 'Slide 2', prompt: '{prompt}, same set and light, next idea', refs: ['s1'], aspect: '4:5' },
        { id: 's3', kind: 'image', title: 'Slide 3', prompt: '{prompt}, same set and light, closing idea', refs: ['s1'], aspect: '4:5' },
      ] },
      { id: 'ad-pack', name: 'Ad pack', description: 'One master adapted to Meta, TikTok, Pinterest and Google ratios.', steps: [
        { id: 's1', kind: 'image', title: 'Master 1:1', prompt: '{prompt}, ad creative, clear focal product, space for a headline', aspect: '1:1' },
        { id: 's2', kind: 'op', title: 'Feed 4:5', op: 'reframe', input: 's1', params: { aspect: '4:5' } },
        { id: 's3', kind: 'op', title: 'Stories 9:16', op: 'reframe', input: 's1', params: { aspect: '9:16' } },
        { id: 's4', kind: 'op', title: 'Pinterest 2:3', op: 'reframe', input: 's1', params: { aspect: '2:3' } },
        { id: 's5', kind: 'op', title: 'Display 16:9', op: 'reframe', input: 's1', params: { aspect: '16:9' } },
      ] },
      { id: 'try-on', name: 'Virtual try-on', description: 'A generated model wearing or using the product.', steps: [
        { id: 's1', kind: 'image', title: 'Try-on', prompt: '{prompt}, a model wearing or using the product, the product unchanged', aspect: '4:5' },
      ] },
      { id: 'conceptual', name: 'Conceptual / CGI', description: 'Levitation, splashes, sculptural or surreal sets for premium brands.', steps: [
        { id: 's1', kind: 'image', title: 'Concept', prompt: '{prompt}, conceptual product shot, levitating, dramatic studio light', aspect: '4:5' },
      ] },
      { id: 'restyle', name: 'Restyle', description: 'New look, mood or season for an existing image; subject and composition kept. The input is the user image.', steps: [
        { id: 's1', kind: 'op', title: 'Restyle', op: 'edit', params: { instruction: '{prompt}; keep the product and composition exactly' } },
      ] },
    ],
    steps: [
      { id: 's1', kind: 'image', title: 'Hero shot', prompt: '{prompt}, hero product shot, clean studio light, neutral background', aspect: '1:1' },
      { id: 's2', kind: 'image', title: 'Lifestyle', prompt: '{prompt}, lifestyle, the product in a real setting of use', refs: ['s1'], aspect: '1:1' },
      { id: 's3', kind: 'image', title: 'Macro detail', prompt: '{prompt}, macro close-up of the material and finish', refs: ['s1'], aspect: '1:1' },
      { id: 's4', kind: 'image', title: 'Features shot', prompt: '{prompt}, clean product shot with empty areas for feature callouts, no text', refs: ['s1'], aspect: '1:1' },
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
    continuity: 'Shots 2–4 use shot 1 as reference; a character or object in 2+ shots keeps one visual source in each (the attached image in refs, or a library @Name); neighboring shots change at least one of shot size, subject or angle.',
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
    // One UGC piece per plan (Higgsfield review): one creator and one product throughout; variants never mix.
    id: 'ugc',
    name: 'UGC video',
    description: 'Creator-style vertical video: review, unboxing, try-on or tutorial; one creator and one product.',
    // Chat only, like story: plan subjects and join_clips do not exist in Nodes.
    workspaces: ['chat'],
    skill: 'ugc',
    skills: [{ id: 'cinematic', for: 'the clip prompts' }],
    needs: [
      'the product (photo, or a description)',
      'the creator: an attached photo, or a description (age range, style); generated once and kept',
      'language of the spoken lines',
      'total duration',
      'claims to use: only benefits the user states or the product shows (none → neutral)',
    ],
    fixed: { aspect: '9:16' },
    continuity:
      'The creator and product images (attached, or the approved key frame) go in the refs of every step and are cited with the model\'s reference syntax and their role; never describe them again. Save them to the library only if the user asks or says yes in the questions card. Claims only from the brief. One variant per piece: two formats are two plans. Spoken lines in the chosen language, quoted, short.',
    variants: [
      { id: 'review', name: 'Review', description: 'Creator talks to camera holding the product: hook, two benefits, verdict.' },
      { id: 'unboxing', name: 'Unboxing', description: 'Hands open the package, reveal and first reaction.', steps: [
        { id: 's1', kind: 'image', title: 'Key frame · package', prompt: '{prompt}, hands holding the closed package, phone-shot, natural light', aspect: '9:16' },
        { id: 's2', kind: 'video', title: 'Unboxing clip', prompt: '{prompt}, opening the package, reveal of the product, genuine reaction', firstFrame: 's1', aspect: '9:16' },
      ] },
      { id: 'try-on', name: 'Try-on', description: 'The creator wears or uses the product and shows it from two sides.' },
      { id: 'tutorial', name: 'Tutorial', description: 'Step by step use, one clip per step, joined.', steps: [
        { id: 's1', kind: 'image', title: 'Key frame', prompt: '{prompt}, creator with the product, ready to show how to use it', aspect: '9:16' },
        { id: 's2', kind: 'video', title: 'Step 1', prompt: '{prompt}, step 1', firstFrame: 's1', aspect: '9:16' },
        { id: 's3', kind: 'video', title: 'Step 2', prompt: '{prompt}, step 2', refs: ['s1'], aspect: '9:16' },
        { id: 's4', kind: 'op', title: 'Join clips', op: 'join_clips', input: 's2', more: ['s3'] },
      ] },
    ],
    steps: [
      { id: 's1', kind: 'image', title: 'Key frame', prompt: '{prompt}, creator holding the product, phone-shot selfie framing, natural light', aspect: '9:16' },
      { id: 's2', kind: 'video', title: 'UGC clip', prompt: '{prompt}, talking to camera about the product, handheld', firstFrame: 's1', aspect: '9:16' },
    ],
  },
  {
    id: 'shot-sequence',
    name: 'Shot sequence',
    description: 'Key frame, first clip and a continuation.',
    workspaces: ['chat', 'node'],
    skill: 'cinematic',
    skills: [{ id: 'cinematic', for: 'every clip prompt' }],
    needs: ['the scene or a start image', 'total duration'],
    fixed: { aspect: '16:9' },
    continuity: 'Each clip continues from the last frame of the previous one; a character or object in 2+ clips keeps one visual source in each (the attached image in refs, or a library @Name); neighboring clips change at least one of shot size, subject or angle.',
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
    skills: [{ id: 'cinematic', for: 'every clip prompt' }],
    needs: [
      'tone or genre (offer 2–3 treatments as options when the brief is abstract or the user has no idea; recommend the one that fits the image)',
      'sound: dialogue or voice-over, music and ambience, or silent (only for models with audio)',
      'format: the attached image\'s aspect (recommended) or another',
      'character references first? "No, use my image" (recommended when the image shows the character clearly) or "Yes, a character sheet first" (a cheap first plan; the user picks one, then the clips)',
    ],
    continuity:
      'One identity: the attached image (or the character-sheet image the user picked) goes in the refs of every clip, cited with the model\'s reference syntax and its role ("the girl in @Image1") — never describe her look again; a clip with no image of her repeats the same 3–6 literal traits (skill:cinematic). Save her to the library only if the user asks or says yes in the questions card. Each clip is one closed beat with a start and an end (hook → conflict → payoff), written as action, camera and sound; the durations add up to the requested total (set total_duration). Neighboring clips change at least one of shot size, subject or angle. All clips go in one plan (the user unchecks what they do not want), followed by join_clips over them in order. If the story does not fit the length, say so with numbers and offer extending, focusing on one moment or compressing in the questions card.',
    steps: [
      { id: 's1', kind: 'video', title: 'Clip 1 · hook', prompt: '{prompt}' },
      { id: 's2', kind: 'video', title: 'Clip 2 · conflict', prompt: '{prompt}' },
      { id: 's3', kind: 'video', title: 'Clip 3 · payoff', prompt: '{prompt}' },
      { id: 's4', kind: 'op', title: 'Join clips', op: 'join_clips', input: 's1', more: ['s2', 's3'] },
    ],
  },
  {
    // Archviz set: renders, a walkthrough, a full tour and sketch → render. Skills teach each step; the building
    // render is the reference (refs) of every view and clip, so the architecture stays the same.
    id: 'archviz-render',
    name: 'Archviz render',
    description: 'Architectural renders: a hero exterior or interior, or a set of views of the same building.',
    workspaces: ['chat', 'node'],
    skill: 'archviz',
    skills: [{ id: 'archviz', for: 'every render prompt' }],
    needs: ['the building or space (style, exterior or interior), or an image of it', 'light or time of day when it matters'],
    continuity: 'One building sheet repeated in every view; the hero render is the reference for the other views, and the approved render goes in the refs of every later view (save it to the library only if the user asks).',
    variants: [
      { id: 'exterior', name: 'Exterior hero', description: 'One exterior render, three-quarter view at eye level.', steps: [{ id: 's1', kind: 'image', title: 'Exterior', prompt: '{prompt}, exterior, three-quarter view, eye level', aspect: '16:9' }] },
      { id: 'interior', name: 'Interior', description: 'One interior render of the main space.', steps: [{ id: 's1', kind: 'image', title: 'Interior', prompt: '{prompt}, interior, camera at 1.4 m, one-point perspective', aspect: '3:2' }] },
      {
        id: 'set',
        name: 'Set of views',
        description: 'Facade, living space, bedroom and terrace of the same building.',
        steps: [
          { id: 's1', kind: 'image', title: 'Facade', prompt: '{prompt}, main facade, exterior', aspect: '16:9' },
          { id: 's2', kind: 'image', title: 'Living space', prompt: '{prompt}, living room and kitchen interior, same building', refs: ['s1'], aspect: '16:9' },
          { id: 's3', kind: 'image', title: 'Bedroom', prompt: '{prompt}, main bedroom interior, same building', refs: ['s1'], aspect: '16:9' },
          { id: 's4', kind: 'image', title: 'Terrace', prompt: '{prompt}, terrace or garden, same building', refs: ['s1'], aspect: '16:9' },
        ],
      },
    ],
    steps: [{ id: 's1', kind: 'image', title: 'Render', prompt: '{prompt}', aspect: '16:9' }],
  },
  {
    id: 'archviz-walkthrough',
    name: 'Archviz walkthrough',
    description: 'One render animated into a walkthrough or flythrough clip (dolly, orbit, drone reveal, exterior to interior).',
    workspaces: ['chat', 'node'],
    skill: 'archviz-motion',
    skills: [
      { id: 'archviz', for: 'the render, when there is no approved image yet' },
      { id: 'archviz-motion', for: 'the clip prompt' },
    ],
    needs: ['the render to animate (an image, or a description to render first)', 'the camera move, if the user has one in mind'],
    continuity: 'The render is the first frame of the clip; the clip directs the camera and the life, never redescribes the architecture.',
    variants: [
      { id: 'dolly', name: 'Dolly in', description: 'Slow dolly toward the entrance or the window wall.' },
      { id: 'orbit', name: 'Orbit', description: 'Slow 30–60° orbit around the building corner.' },
      { id: 'drone', name: 'Drone reveal', description: 'Rising aerial move that reveals the site.' },
      {
        id: 'inside',
        name: 'Exterior to interior',
        description: 'From the facade through the open door into the main space: two clips joined (chat only).',
        steps: [
          { id: 's1', kind: 'image', title: 'Facade near the door', prompt: '{prompt}, exterior near the open glazed entrance', aspect: '16:9' },
          { id: 's2', kind: 'image', title: 'Main interior', prompt: '{prompt}, main interior seen from the entrance, same building', refs: ['s1'], aspect: '16:9' },
          { id: 's3', kind: 'video', title: 'Approach', prompt: '{prompt}, slow dolly toward the open door', firstFrame: 's1', aspect: '16:9' },
          { id: 's4', kind: 'video', title: 'Inside', prompt: '{prompt}, the camera continues forward into the room', firstFrame: 's2', aspect: '16:9' },
          { id: 's5', kind: 'op', title: 'Join clips', op: 'join_clips', input: 's3', more: ['s4'] },
        ],
      },
    ],
    steps: [
      { id: 's1', kind: 'image', title: 'Render', prompt: '{prompt}', aspect: '16:9' },
      { id: 's2', kind: 'video', title: 'Walkthrough', prompt: '{prompt}, one slow steady camera move', firstFrame: 's1', aspect: '16:9' },
    ],
  },
  {
    id: 'archviz-tour',
    name: 'Archviz tour',
    description: 'A full property tour: key views of one building, one clip per view, joined in order with optional ambient music.',
    workspaces: ['chat'],
    skill: 'archviz-motion',
    skills: [
      { id: 'archviz', for: 'the key views' },
      { id: 'archviz-motion', for: 'each clip and the order of the tour' },
    ],
    needs: ['the building (description or images)', 'total length', 'ambient music: yes (generated) or no'],
    continuity: 'Facade → entrance → main interior → terrace. The facade render is the reference (refs) for every other view; each clip starts from its view (first_frame); neighboring clips change shot size or angle; the clips are joined in order (join_clips, with params.music set to a music step or an audio asset when the user wants music).',
    steps: [
      { id: 's1', kind: 'image', title: 'Facade', prompt: '{prompt}, main facade at golden hour', aspect: '16:9' },
      { id: 's2', kind: 'image', title: 'Entrance', prompt: '{prompt}, entrance and hall, same building', refs: ['s1'], aspect: '16:9' },
      { id: 's3', kind: 'image', title: 'Living space', prompt: '{prompt}, main living space, same building', refs: ['s1'], aspect: '16:9' },
      { id: 's4', kind: 'image', title: 'Terrace', prompt: '{prompt}, terrace or garden, same building', refs: ['s1'], aspect: '16:9' },
      { id: 'v1', kind: 'video', title: 'Arrival', prompt: '{prompt}, slow dolly toward the house', firstFrame: 's1', aspect: '16:9' },
      { id: 'v2', kind: 'video', title: 'Entrance', prompt: '{prompt}, slow walk-through of the hall', firstFrame: 's2', aspect: '16:9' },
      { id: 'v3', kind: 'video', title: 'Living space', prompt: '{prompt}, slow pan across the living space', firstFrame: 's3', aspect: '16:9' },
      { id: 'v4', kind: 'video', title: 'Terrace', prompt: '{prompt}, slow pull-back revealing the terrace', firstFrame: 's4', aspect: '16:9' },
      { id: 'j1', kind: 'op', title: 'Join the tour', op: 'join_clips', input: 'v1', more: ['v2', 'v3', 'v4'] },
    ],
  },
  {
    id: 'archviz-sketch',
    name: 'Sketch to render',
    description: 'A hand sketch, clay model or floor plan turned into a photoreal render that keeps its design; optionally animated.',
    workspaces: ['chat', 'node'],
    skill: 'archviz-sketch',
    skills: [
      { id: 'archviz-sketch', for: 'the render from the sketch' },
      { id: 'archviz-motion', for: 'the clip, when the user wants one' },
    ],
    needs: ['the sketch, clay render or floor plan (an image)', 'materials and light, when not obvious'],
    continuity: 'The attached sketch is the design: the render is an edit of it (refs: the sketch) that keeps massing, openings and viewpoint.',
    variants: [
      { id: 'sketch', name: 'Hand sketch', description: 'A drawing turned into a photoreal render.' },
      { id: 'clay', name: 'Clay / white model', description: 'A grey 3D render given materials and light.' },
      { id: 'plan', name: 'Floor plan', description: 'A plan turned into a rendered top-down plan or an interpreted perspective.' },
    ],
    steps: [{ id: 's1', kind: 'image', title: 'Render', prompt: '{prompt}, photoreal architectural render that keeps the exact massing, openings and viewpoint of the attached sketch' }],
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
    w.skills?.length ? `skills (read_guide each before writing its steps): ${w.skills.map((k) => `skill:${k.id} for ${k.for}`).join('; ')}` : '',
  ].filter(Boolean);
  return [`${w.name}: ${w.description}`, ...lines, ...extra.map((e) => `  ${e}`)].join('\n');
}

/** One line per workflow and skill, for the agent's system prompt: name and when to use it. */
export function guideIndex(): string {
  return [
    ...WORKFLOWS.map((w) => `  workflow:${w.id} — ${w.name}: ${w.description}${w.variants?.length ? ` (variants: ${w.variants.map((v) => v.id).join(', ')})` : ''}${canvasNote(w)}`),
    ...SKILLS.map((k) => `  skill:${k.id} — ${k.name}: ${k.description}`),
    ...MODEL_GUIDES.map((g) => `  model:${g.id} — how to write prompts for ${g.name}`),
  ].join('\n');
}

const ALL_CANVASES: Workspace[] = ['chat', 'node', 'designer'];

/** " (chat only)" when a workflow does not work on every canvas; the prompt stays the same on all of them. */
function canvasNote(w: Workflow): string {
  return ALL_CANVASES.every((c) => w.workspaces.includes(c)) ? '' : ` (${w.workspaces.join(', ')} only)`;
}

/** Why read_guide refuses a workflow on this canvas, with what to do instead; undefined when it fits. */
export function guideWorkspaceProblem(id: string, workspace: Workspace): string | undefined {
  const [type, rest = ''] = id.trim().split(':');
  if (type !== 'workflow') return undefined;
  const w = workflowById(rest.split('/')[0]);
  if (!w || w.workspaces.includes(workspace)) return undefined;
  const instead = workspace === 'node' ? ' For several clips keep the same narrative split, one node per clip, without join_clips.' : '';
  return `Workflow "${w.id}" works only on the ${w.workspaces.join(' / ')} canvas; you are on the ${workspace} canvas. Plan the request directly with the steps this canvas supports.${instead}`;
}

/** The full text of a skill or workflow for read_guide ("skill:product", "workflow:storyboard", "workflow:ugc/unboxing"). */
export function readGuide(id: string): string | undefined {
  const [type, rest = ''] = id.trim().split(':');
  if (type === 'model') return modelGuide(rest)?.text;
  if (type === 'skill') {
    const k = skillById(rest);
    return k ? `${k.name}: ${k.guidance}${k.guide ? `\n\n${k.guide}` : ''}` : undefined;
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
