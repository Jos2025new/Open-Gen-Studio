import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('fonts', () => {
  it('the Designer font is loaded at startup, because its documents name it', () => {
    const main = readFileSync('src/main.tsx', 'utf8');
    const doc = readFileSync('src/engine/design/doc.ts', 'utf8');
    expect(doc).toContain("'Inter Variable'");
    expect(main).toContain("import '@fontsource-variable/inter';");
  });
});
