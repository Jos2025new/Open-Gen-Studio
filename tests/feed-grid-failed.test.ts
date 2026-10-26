import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Sandbox 2026-10-26: a failed result in a row of three kept its 300px minimum, overflowed its 200px column and slid under the next image.
const studio = readFileSync('src/styles/studio.css', 'utf8');
const chat = readFileSync('src/styles/chat.css', 'utf8');

describe('a failed result in a row of results', () => {
  it('fits its column and wraps long provider ids', () => {
    expect(chat).toMatch(/\.gen-card\.status-error, \.gen-card\.status-canceled \{[^}]*min-width: 300px/);
    expect(studio).toMatch(/\.feed-gen-grid \.gen-card \{ width: 100%; min-width: 0; max-width: 100%; overflow-wrap: anywhere; \}/);
  });
});
