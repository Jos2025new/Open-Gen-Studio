import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('panels above the toolbox are as wide as their content, never a full-width row with empty gaps', () => {
  const css = readFileSync('src/styles/tool-dock.css', 'utf8');
  expect(css).toMatch(/\.tool-dock-stack \{[^}]*align-items: flex-start;/);
  expect(css).toMatch(/\.tool-dock \.tool-dock-stack > \* \{ width: fit-content; max-width: 100%; \}/);
  expect(css).toMatch(/\.tool-dock \.tool-dock-strip \.context-strip \{ position: static; width: auto;/);
});
