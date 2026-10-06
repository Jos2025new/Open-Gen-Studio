import productGuide from '../guides/product.md?raw';
import socialGuide from '../guides/social.md?raw';
import directingGuide from '../guides/directing.md?raw';
import photographyGuide from '../guides/photography.md?raw';
import archvizGuide from '../guides/archviz.md?raw';
import archvizMotionGuide from '../guides/archviz-motion.md?raw';
import archvizSketchGuide from '../guides/archviz-sketch.md?raw';
import type { Skill } from './types';
import { workflowById } from './workflows';

export const SKILLS: Skill[] = [
  {
    id: 'product',
    name: 'Product photography',
    description: 'Commercial product shots: studio light, clean sets, hero angles.',
    guidance: 'Write prompts like a commercial product photographer: the product photo as the identity reference in every step (a fixed product description only when there is no image), light with direction and color temperature, lens and aperture per shot, a grounded contact shadow, negative space where copy goes. Load skill:product for the full guide before writing prompts.',
    guide: productGuide,
    promptHint: 'commercial product photography, studio lighting, crisp detail, clean background',
  },
  {
    id: 'character',
    name: 'Character consistency',
    description: 'Keep the same character across images and shots.',
    guidance: 'Use the provided character image as the identity source in every consuming step. If no image exists, establish one source first and repeat the fixed identity description only in text-only prompts. View changes preserve the source pose and outfit unless requested otherwise.',
    promptHint: 'consistent character, same face and outfit',
  },
  {
    id: 'photography',
    name: 'Photography glossary',
    description: 'Optional reference: shot sizes, angles, lenses and light recipes for any still. Load only when unsure; never needed for a simple request.',
    guidance: 'Shot, angle, lens with depth of field, and light with source, direction and color temperature, written as causes; mood word last.',
    guide: photographyGuide,
    promptHint: 'natural photographic look, considered lens and lighting',
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

export function skillById(id: string | null | undefined): Skill | undefined {
  return SKILLS.find((s) => s.id === id);
}

/** The skill in effect: the one the user picked, else the one the workflow recommends. */
export function activeSkill(skillId: string | null | undefined, workflowId: string | null | undefined): Skill | undefined {
  return skillById(skillId) ?? skillById(workflowById(workflowId)?.skill);
}

