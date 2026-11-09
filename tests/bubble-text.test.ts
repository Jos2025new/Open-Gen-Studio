import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Sandbox 2026-10-26: the user's message showed an empty line above and below its text (the <p>'s default margins).
const css = readFileSync('src/styles/prompt-box.css', 'utf8');
const chat = readFileSync('src/styles/chat.css', 'utf8');
const composer = readFileSync('src/styles/composer.css', 'utf8');

describe("the user's message bubble", () => {
  it('keeps only its own padding around the text', () => {
    expect(css).toMatch(/\.bubble > p \{ margin: 0; \}/);
  });
  // The composer follows the shared bar token (history 058); the message keeps its own surface.
  it('keeps the message surface and uses the shared bar background for the composer', () => {
    expect(chat).toMatch(/\.bubble \{ background: var\(--surface\);/);
    expect(composer).toMatch(/\.composer \{ background: var\(--bar-bg\);/);
    expect(readFileSync('src/styles/tokens.css', 'utf8')).toMatch(/--bar-bg:\s*var\(--surface\)/);
  });
});

// 2026-10-27: the model row became several buttons («Set as default»); its label keeps the left alignment and the chevron its faint colour.
describe('the composer model row', () => {
  it('keeps the row look after splitting it into buttons', () => {
    expect(composer).toMatch(/\.agent-model-row > button \{ text-align: left; \}/);
    expect(composer).toMatch(/\.agent-model-row > button > svg \{ color: var\(--text-3\); \}/);
  });
});
