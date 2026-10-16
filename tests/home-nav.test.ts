import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CREATE, SPACES, TOOLS_MAIN, TOOLS_MORE, openCreate, openHome, openSpace, openTool, isListed } from '../src/components/shell/navModel';
import { HomeView } from '../src/components/shell/HomeView';
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
  it('Home has its three sections, the bento cards and an enabled 3D', () => {
    const html = renderToStaticMarkup(createElement(HomeView));
    for (const label of ['Create', 'Tools', 'Latest']) expect(html).toContain(`aria-label="${label}"`);
    for (const t of ['Studio', 'Node Canvas', 'Designer']) expect(html).toContain(`<span class="home-card-title">${t}</span>`);
    for (const t of ['image', 'video', 'audio', 'model3d']) expect(html).toContain(`style="grid-area:${t}"`);
    expect(html).toMatch(/<button type="button" class="home-tile t-model3d" style="grid-area:model3d" aria-label="3D"/);
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
