import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Sandbox 2026-10-26: the user's message showed an empty line above and below its text (the <p>'s default margins).
const css = readFileSync('src/styles/prompt-box.css', 'utf8');

describe("the user's message bubble", () => {
  it('keeps only its own padding around the text', () => {
    expect(css).toMatch(/\.bubble > p \{ margin: 0; \}/);
  });
});
