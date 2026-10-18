import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CREATE, SPACES, TOOLS_MAIN, TOOLS_MORE, openCreate, openHome, openSpace, openTool, isListed } from '../src/components/shell/navModel';
import { HomeView, ToolsRow } from '../src/components/shell/HomeView';
import { SidebarNav } from '../src/components/shell/SidebarNav';
import { OPS, opsFor } from '../src/engine/ops';
import { useStore } from '../src/store/store';

const ui = () => useStore.getState().ui;

describe('navigation model', () => {
  it('every image, video and audio operation is a tool exactly once, none that need Sketch or several clips', () => {
    const ids = [...TOOLS_MAIN, ...TOOLS_MORE].map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const expected = (['image', 'video', 'audio'] as const).flatMap((k) => opsFor(k).map((o) => o.id));
    expect([...ids].sort()).toEqual([...expected].sort());
    for (const id of ids) expect(OPS[id].viaSketch || OPS[id].multiInput).toBeFalsy();
  });
  it('Studio opens chat in agent mode; Canvas and Designer open their workspaces; all leave Home', () => {
    openHome();
    expect(ui().home).toBe(true);
    useStore.setState((s) => ({ composer: { ...s.composer, mode: 'image' } }));
    openSpace(SPACES[0]);
    expect(ui().home).toBe(false);
    expect(ui().workspace).toBe('chat');
    expect(useStore.getState().composer.mode).toBe('agent');
    openSpace(SPACES[1]);
    expect(ui().workspace).toBe('node');
    openSpace(SPACES[2]);
    expect(ui().workspace).toBe('designer');
  });
  it('Image, Video, Audio and 3D open the chat with that mode', () => {
    expect(CREATE.map((c) => c.id)).toEqual(['image', 'video', 'audio', 'model3d']);
    for (const c of CREATE) {
      openHome();
      openCreate(c);
      expect(useStore.getState().composer.mode).toBe(c.mode);
      expect(ui()).toMatchObject({ workspace: 'chat', home: false });
    }
  });
  it('a tool opens the Tools space with that operation selected', () => {
    openHome();
    openTool(TOOLS_MAIN[0]);
    expect(ui()).toMatchObject({ space: 'tools', toolOp: TOOLS_MAIN[0].id, home: false, workspace: 'chat' });
  });
  it('working copies are not listed', () => {
    expect(['generated', 'upload', 'design', 'frame'].every((origin) => isListed({ origin }))).toBe(true);
    expect(['sketch', 'mask', 'view3d'].some((origin) => isListed({ origin }))).toBe(false);
  });
});

describe('rendering', () => {
  it('Home has the hero, then Apps, Tools, For deeper work and Latest', () => {
    const html = renderToStaticMarkup(createElement(HomeView));
    for (const label of ['Apps', 'Tools', 'For deeper work', 'Latest']) expect(html).toContain(`aria-label="${label}"`);
    expect(html).toContain('class="home-hero"');
    for (const t of ['Image', 'Video', 'Audio', '3D']) expect(html).toMatch(new RegExp(`<span class="home-app-title">${t}</span>`));
    expect(html).toMatch(/<button type="button" class="home-app t-model3d" aria-label="3D"/);
    expect(html).toMatch(/<span class="home-app-icon">/);
    for (const t of ['Canvas', 'Designer']) expect(html).toContain(`<span class="home-space-title">${t}</span>`);
    expect(html).toMatch(/<button type="button" class="home-space" disabled="" aria-label="Projects — soon">/);
    expect(html).not.toContain('grid-area');
    expect(html).toContain('Make more with AI tools');
    expect(html).toContain('class="home-kicker">Tools</div>');
    expect(html).not.toContain('plan-kicker');
    expect(html).not.toContain('>Apps</div>');
  });
  it('Tools show 58 px circles with a last "More"; expanded, the same row ends in "Less"', () => {
    const collapsed = renderToStaticMarkup(createElement(ToolsRow));
    expect(collapsed.match(/class="home-tool[ "]/g)).toHaveLength(TOOLS_MAIN.length + 1);
    expect(collapsed).toMatch(/aria-expanded="false"[^>]*>.*>More</);
    const expanded = renderToStaticMarkup(createElement(ToolsRow, { defaultMore: true }));
    expect(expanded.match(/class="home-tool[ "]/g)).toHaveLength(TOOLS_MAIN.length + TOOLS_MORE.length + 1);
    expect(expanded).toMatch(/aria-expanded="true"[^>]*>.*>Less</);
  });
  it('the wide bar has collapsible Spaces, Create and Tools sections with text', () => {
    const html = renderToStaticMarkup(createElement(SidebarNav, { wide: true }));
    for (const s of ['Spaces', 'Create', 'Tools']) expect(html).toMatch(new RegExp(`class="nav-head"[^>]*aria-expanded="true"[^>]*><span>${s}</span>`));
    expect(html).toContain('nav-grid');
    expect(html).toContain('Studio');
  });
  it('the narrow bar has one icon per section and no text of its own', () => {
    const html = renderToStaticMarkup(createElement(SidebarNav, { wide: false }));
    for (const s of ['Spaces', 'Create', 'Tools']) expect(html).toContain(`aria-label="${s}"`);
    expect(html.match(/<button/g)).toHaveLength(3);
    expect(html.replace(/<[^>]+>/g, '')).toBe('');
  });
});
