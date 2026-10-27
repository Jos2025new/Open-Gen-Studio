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
  // 2026-10-26: message and prompt box stood out too much from the background; they take the step closest to it.
  it('message and prompt box sit one soft step above the background', () => {
    expect(chat).toMatch(/\.bubble \{ background: var\(--surface\);/);
    expect(composer).toMatch(/\.composer \{ background: var\(--surface\);/);
  });
});

// 2026-10-27: the model row became several buttons («Set as default»); its label keeps the left alignment and the chevron its faint colour.
describe('the composer model row', () => {
  it('keeps the row look after splitting it into buttons', () => {
    expect(composer).toMatch(/\.agent-model-row > button \{ text-align: left; \}/);
    expect(composer).toMatch(/\.agent-model-row > button > svg \{ color: var\(--text-3\); \}/);
  });
});
