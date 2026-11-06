import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Every floating bar and the panels docked to them, in the same order as their rules; all take their look from the --bar-* tokens. */
const BARS = ['.sidebar::before', '.designer-side', '.composer', '.tool-dock-variants, .tool-dock-family', '.tool-dock-card', '.tool-dock .tool-dock-stack > .tool-dock-variants.is-fixed', '.tool-dock-hide-prompt.is-pill', '.topbar-group', '.layers-peek-handle', '.canvas-navigation', '.designer-view', '.home-bar', '.context-strip', '.value-notice', '.selection-panel', '.react-flow__panel.node-side', '.node-side.designer-corner', '.thread-peek.is-open', '.thread-peek-folded .thread-toggle', '.designer .document-picker-toggle'];
const css = readdirSync('src/styles').filter((f) => f.endsWith('.css')).map((f) => readFileSync(`src/styles/${f}`, 'utf8')).join('\n');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim().split('\n').pop()!.trim(), body: m[2] }));
const LOOK = /(?:^|;)\s*(background|border|border-color|box-shadow):([^;]*)/g;

describe('one shared style for the bars', () => {
  it.each(BARS)('%s', (bar) => {
    const own = rules.filter((r) => r.sel === bar);
    expect(own.length).toBeGreaterThan(0);
    for (const { body } of own) for (const [, prop, value] of body.matchAll(LOOK)) {
      if (prop === 'background') expect(value).toMatch(/var\(--bar-bg\)|transparent/);
      if (prop === 'box-shadow') expect(value).toMatch(/var\(--bar-shadow\)|none/);
      if (prop.startsWith('border') && /--(panel-line|frame-border|border)\b/.test(value)) expect(value).toContain('--bar-line');
    }
  });
  it('the tokens follow the main bar', () => {
    const tokens = readFileSync('src/styles/tokens.css', 'utf8');
    expect(tokens).toMatch(/--bar-bg: var\(--surface\); --bar-line: var\(--frame-border\); --bar-shadow: none;/);
    expect(tokens).toMatch(/--toolbar-radius: var\(--r-m\);/);
  });
});
