import { expect, it } from 'vitest';
import beforeSplit from './fixtures/skills/before-split.json';
import { CONTINUITY_POLICY, WORKFLOW_CONTRACT } from '../src/engine/procedure';
import { readGuide } from '../src/engine/skills';

// Historical fixture stays unchanged; only the explicitly reviewed contract corrections are substituted.
it.each(Object.entries(beforeSplit))('read_guide preserves the exact pre-split text for %s', (id, text) => {
  let expected = text
    .replace('workflow (follow this structure, adapt prompts to the request):', `workflow (${WORKFLOW_CONTRACT}):`)
    .replace('fixed (do not ask):', 'template defaults (unless the user specified otherwise):')
    .replace('needs (ask the missing ones in the one questions card):', 'brief fields (reuse supplied values; ask only missing user data in Auto; creative choices optional in Guided):')
    .replace('Establish the character once (a clear front view) and pass that output as a reference to every later image step. Repeat identity anchors (face, hair, outfit, palette) in each prompt.', 'Use the provided character image as the identity source in every consuming step. If no image exists, establish one source first and use text to establish that source, not as a substitute for passing it to related outputs. View changes preserve the source pose and outfit unless requested otherwise.');
  if (id.startsWith('workflow:')) {
    const lines = expected.split('\n');
    lines.splice(2, 0, `preservation: ${CONTINUITY_POLICY}`);
    const skillAt = lines.findIndex(line => line.startsWith('skill '));
    lines.splice(skillAt < 0 ? lines.length : skillAt, 0, 'Before propose_plan: check the declared preservation sources reach every consuming result; text repetition alone does not establish continuity.');
    expected = lines.join('\n');
  }
  expect(readGuide(id)).toBe(expected);
});
