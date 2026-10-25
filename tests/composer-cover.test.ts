import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/styles/prompt-box.css', 'utf8');

describe('chat under the composer', () => {
  it('is covered from the box down to the edge, except on the empty chat where the box is not floating', () => {
    expect(css).toMatch(/\.composer-dock\.dock-chat::before \{[^}]*bottom: -40px;[^}]*background: var\(--bg-canvas\)/);
    expect(css).toMatch(/\.ws-chat:has\(\.chat-empty\) \.composer-dock\.dock-chat::before \{ content: none; \}/);
  });
});
