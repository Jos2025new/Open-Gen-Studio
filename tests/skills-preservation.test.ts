import { expect, it } from 'vitest';
import beforeSplit from './fixtures/skills/before-split.json';
import { CONTINUITY_POLICY, WORKFLOW_CONTRACT } from '../src/engine/procedure';
import { describeWorkflow, readGuide, skillById, workflowById } from '../src/engine/skills';

const SEEDANCE_PATTERNS = [
  '- Timed script: segments with one shot type, one main action and one sound line each.',
  '- Character lock: a stable name per reference, what it keeps and what it must not bring.',
  '- Storyboard grid to video: a numbered panel sheet made first as an image, then used as the reference.',
  '- Handheld UGC vlog: believability through named consumer-camera flaws, not "high quality".',
  '- Anime style lock: measurable style parameters plus a list of neighbouring styles to exclude.',
  '- Stop-motion cadence: frame rate and hold count, the craft material, and the smoothing effects banned.',
  '- Do not mix several templates in one prompt, repeat the full wardrobe in every beat, or ask for a long storyboard in a short duration.',
  '- Image to video: the opening image (first frame) is not the identity or design image (reference); do not fix pose or background from an identity reference.'
].join('\n');

const PEOPLE_LOOK_LINE = '- People: a person the prompt does not describe comes out East Asian. State each new person\'s look (skin tone, hair, features) as the "default look for people" line says, unless the user asked otherwise or a reference or start image shows them (then the image sets the look).';

// Historical fixture stays unchanged; only the explicitly reviewed contract corrections are substituted.
it.each(Object.entries(beforeSplit))('read_guide preserves the exact pre-split text for %s', (id, text) => {
  let expected = text
    .replace('workflow (follow this structure, adapt prompts to the request):', `workflow (${WORKFLOW_CONTRACT}):`)
    .replace('fixed (do not ask):', 'template defaults (unless the user specified otherwise):')
    .replace('needs (ask the missing ones in the one questions card):', 'brief fields (reuse supplied values; ask only missing user data in Auto; creative choices optional in Guided):')
    .replace('Establish the character once (a clear front view) and pass that output as a reference to every later image step. Repeat identity anchors (face, hair, outfit, palette) in each prompt.', 'Use the provided character image as the identity source in every consuming step. If no image exists, establish one source first and use text to establish that source, not as a substitute for passing it to related outputs. View changes preserve the source pose and outfit unless requested otherwise.');
  if (id === 'model:seedance') {
    // cf1f286 (before this task): style is appended once per prompt by the app.
    expected = expected.replace("- Replace the grade family with a STYLE FORMULA of 80\u2013100 words and repeat it word for word in every shot and every asset. Literal repetition is the whole consistency mechanism; rephrasing it \"similarly\" in shot 3 loses the look.", "- Replace the grade family with a STYLE FORMULA of 50\u2013100 words, identical word for word in every clip and every asset (character, location and prop images); rephrasing it \"similarly\" in clip 3 loses the look. Write it once as the plan's \"style\": the app appends it verbatim to every image and video prompt of the plan. Inside one prompt it appears once, never per shot; the shots carry only action, camera and time.");
    expected = expected.replace("Style formula (repeat verbatim in every shot): 2D anime, hand-drawn line art with clean tapered black contours, flat cel shading in two tones, painted watercolour backgrounds with visible paper grain, muted teal-and-mustard palette, animation on twos, no photographic depth of field, no realism.", "Style formula (the plan's \"style\", appended once to this prompt and verbatim to every other clip or asset): 2D anime, hand-drawn line art with clean tapered black contours, flat cel shading in two tones, painted watercolour backgrounds with visible paper grain, muted teal-and-mustard palette, animation on twos, no photographic depth of field, no realism.");
    expected = expected.replace('Cinematic prose in English,', 'Cinematic prose,').replace('EDIT AND EXTEND (2.5', `GENRE PATTERNS (source: https://github.com/LearnPrompt/awesome-seedance; a case library, not a ranking)\n${SEEDANCE_PATTERNS}\n\nEDIT AND EXTEND (2.5`);
    // 2026-10-18: the people-look line (peopleLook.ts) after the source line.
    const lines = expected.split('\n');
    lines.splice(3, 0, PEOPLE_LOOK_LINE, '');
    expected = lines.join('\n');
  }
  if (id === 'workflow:storyboard') {
    // 2026-10-25 (user): story first, as many frames as beats, the last one closes; refs s1 for identity and style plus the previous frame.
    const w = workflowById('storyboard')!;
    const before = text.split('\n');
    const steps = describeWorkflow(w).split('\n').filter((l) => l.startsWith('  - '));
    expected = [before[0], `${w.name}: ${w.description}`, ...steps, ...before.slice(6, 9), `  continuity: ${w.continuity}`, `skill Storyboard: ${skillById('storyboard')!.guidance}`].join('\n')
      .replace('workflow (follow this structure, adapt prompts to the request):', `workflow (${WORKFLOW_CONTRACT}):`)
      .replace('fixed (do not ask):', 'template defaults (unless the user specified otherwise):')
      .replace('needs (ask the missing ones in the one questions card):', 'brief fields (reuse supplied values; ask only missing user data in Auto; creative choices optional in Guided):');
  }
  if (id.startsWith('workflow:')) {
    const lines = expected.split('\n');
    lines.splice(2, 0, `preservation: ${CONTINUITY_POLICY}`);
    const skillAt = lines.findIndex(line => line.startsWith('skill '));
    lines.splice(skillAt < 0 ? lines.length : skillAt, 0, 'Before propose_plan: check the declared preservation sources reach every consuming result; text repetition alone does not establish continuity.');
    expected = lines.join('\n');
  }
  expect(readGuide(id)).toBe(expected);
});
