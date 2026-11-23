import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Connection handles are small by design (card visual identity); their click zone must not be: >= 24 x 24 px.
const css = ['src/styles/node.css', 'src/styles/node-system.css'].map((f) => readFileSync(f, 'utf8')).join('\n');
const sources = ['nodes.tsx', 'SystemNode.tsx', 'ConnectedNodeMenu.tsx', 'CanvasNotices.tsx'].map((f) => readFileSync(`src/components/node/${f}`, 'utf8')).join('\n');

/** The class that marks each kind of connection handle in the sources. */
const CONNECTABLE = ['port', 'nc-next', 'nc-result'];

describe('connection handles keep a 24 px click zone', () => {
  it('every <Handle> in the node sources is a known connection handle or a non-connectable anchor', () => {
    const classes = [...sources.matchAll(/<Handle\b[^>]*?className=(?:\{`|")([^`"]*)/g)].map((m) => m[1]);
    expect(classes.length).toBeGreaterThan(3);
    for (const c of classes) {
      const known = CONNECTABLE.some((k) => c.split(/\s+/).includes(k)) || c.includes('node-notice-anchor');
      expect(known, `new handle class "${c}": give it a 24 px ::after zone in node-system.css and list it here`).toBe(true);
    }
  });

  it.each(CONNECTABLE)('.%s has a transparent ::after of at least 24 x 24 px', (cls) => {
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].split(',').some((s) => s.trim().endsWith(`.${cls}::after`)));
    expect(rules.length, `no .${cls}::after rule`).toBeGreaterThan(0);
    const body = rules.map((m) => m[2]).join(';');
    for (const prop of ['width', 'height']) {
      const px = body.match(new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*(?:calc\\()?(\\d+(?:\\.\\d+)?)px`))?.[1];
      expect(Number(px), `.${cls}::after ${prop}`).toBeGreaterThanOrEqual(24);
    }
    expect(body).toMatch(/content:\s*''/);
    expect(body).toMatch(/background:\s*transparent/);
  });

  it('the visible size of the handles is untouched', () => {
    expect(css).toMatch(/\.port \{ width: 0\.5625rem!important; height: 0\.5625rem!important;/);
    expect(css).toMatch(/\.nc-next\.react-flow__handle \{[^}]*width: 22px; height: 22px;/);
    expect(css).toMatch(/\.nc-result\.react-flow__handle \{[^}]*width: 15px; height: 15px;/);
  });
});
