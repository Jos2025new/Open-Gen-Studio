import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const card = /pc-card|pc-info|pc-fade|pc-tile|pc-stat|pc-excerpt|pc-glyph/;
const rules = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => card.test(l.split('{')[0]));

it('cards (Sessions and Library) take their fade and overlay colours from the theme, never a fixed black or white', () => {
  for (const f of ['src/components/ui/PanelControls.css', 'src/components/gallery/GalleryLayout.css']) {
    const fixed = rules(f).filter((l) => /rgba\((0|10|12|255),|:\s*#fff\b/.test(l.replace('--pc-on-ink: #fff', '')));
    expect(fixed, f).toEqual([]);
  }
});

it('the card ink is the theme’s own page colour (no extra black), kept light on light bases, and scoped to cards', () => {
  const css = readFileSync('src/components/ui/PanelControls.css', 'utf8');
  expect(css).toMatch(/--pc-ink: color-mix\(in oklab, var\(--bg-canvas\), #000 var\(--pc-ink-shade\)\)/);
  expect(css).toMatch(/--pc-ink-shade: 0%/);
  expect(css).toMatch(/\[data-base="claro"\] \.pc-card, \[data-base="blanco"\] \.pc-card \{ --pc-on-ink: var\(--text\); \}/);
  expect(readFileSync('src/styles/tokens.css', 'utf8')).not.toMatch(/--pc-ink/);
});

it('the tile fade reaches the full ink before the cover ends, and the card is that ink, so no seam or second block shows', () => {
  const css = readFileSync('src/components/ui/PanelControls.css', 'utf8');
  expect(css).toMatch(/\.pc-card\.pc-tile \{[^}]*background: var\(--pc-ink\); \}/);
  expect(css).toMatch(/\.pc-tile \.pc-open \{[^}]*width: 46%/);
  expect(css).toMatch(/\.pc-tile \.pc-info \{[^}]*var\(--pc-ink\) 45%\)/);
});
