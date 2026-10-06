import { expect, it } from 'vitest';
import beforeSplit from './fixtures/skills/before-split.json';
import { WORKFLOW_CONTRACT } from '../src/engine/procedure';
import { readGuide } from '../src/engine/skills';

// Historical fixture stays unchanged; only the explicitly reviewed contract corrections are substituted.
it.each(Object.entries(beforeSplit))('read_guide preserves the exact pre-split text for %s', (id, text) => {
  const expected = text
    .replace('workflow (follow this structure, adapt prompts to the request):', `workflow (${WORKFLOW_CONTRACT}):`)
    .replace('fixed (do not ask):', 'template defaults (unless the user specified otherwise):')
    .replace('needs (ask the missing ones in the one questions card):', 'brief fields (reuse supplied values; ask only missing user data in Auto; creative choices optional in Guided):')
    .replace('Establish the character once (a clear front view) and pass that output as a reference to every later image step. Repeat identity anchors (face, hair, outfit, palette) in each prompt.', 'Use the provided character image as the identity source in every consuming step. If no image exists, establish one source first and repeat the fixed identity description only in text-only prompts. View changes preserve the source pose and outfit unless requested otherwise.');
  expect(readGuide(id)).toBe(expected);
});
