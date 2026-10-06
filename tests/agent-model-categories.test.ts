// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
const picks = vi.hoisted(() => ({ pick: vi.fn(async () => undefined), reset: vi.fn(async () => undefined) }));
vi.mock('../src/engine/catalog', async (original) => ({ ...await original<typeof import('../src/engine/catalog')>(), pickComposerModel: picks.pick, resetComposerModel: picks.reset }));
vi.mock('../src/components/ui/Popover', async (original) => ({
  ...await original<typeof import('../src/components/ui/Popover')>(),
  Popover: ({ open, children }: { open: boolean; children: import('react').ReactNode }) => open ? createElement('div', {}, children) : null,
}));
vi.mock('../src/components/composer/ModelList', () => ({
  ModelList: ({ kind, automaticVariants, onSelect }: { kind: string; automaticVariants: boolean; onSelect: (ref: string | null) => void }) => createElement('div', { 'data-kind': kind, 'data-auto-variants': String(automaticVariants) },
    createElement('button', { onClick: () => onSelect('local::chosen') }, 'Pick model'),
    createElement('button', { onClick: () => onSelect(null) }, 'Auto')),
}));
import { AgentModelControls } from '../src/components/composer/AgentModelControls';
import { useStore } from '../src/store/store';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(async () => {
  vi.clearAllMocks();
  const st = useStore.getState();
  useStore.setState({ composer: { ...st.composer, userPicked: {}, videoRoutes: { image: 'old::video' } }, settings: { ...st.settings, ops: { ...st.settings.ops, edit: 'old::image', videoEdit: 'old::edit' } } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(AgentModelControls)));
  await click('Models');
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === label || b.querySelector('.agent-model-role')?.textContent === label || (label === 'Models' && b.classList.contains('models-chip')));
  expect(button, label).toBeTruthy();
  await act(async () => button!.click());
}
it('shows exactly five categories in the requested order', () => {
  expect([...host.querySelectorAll('.agent-model-role')].map(el => el.textContent)).toEqual(['Director', 'Image', 'Video', 'Music', '3D']);
});
it('does not discard saved choices simply by opening Models', () => {
  expect(useStore.getState().composer.videoRoutes).toEqual({ image: 'old::video' });
  expect(useStore.getState().settings.ops.edit).toBe('old::image');
  expect(picks.reset).not.toHaveBeenCalled();
});
it.each([['Image', 'image'], ['Video', 'video'], ['Music', 'audio'], ['3D', 'model3d']])('%s uses automatic variants and selects its media kind', async (label, kind) => {
  await click(label);
  expect(host.querySelector('[data-kind]')?.getAttribute('data-auto-variants')).toBe('true');
  await click('Pick model');
  expect(picks.pick).toHaveBeenCalledWith(kind, 'local::chosen');
  if (kind === 'video') {
    expect(useStore.getState().composer.videoRoutes).toBeUndefined();
    expect(useStore.getState().settings.ops.videoEdit).toBeNull();
  }
  if (kind === 'image') expect(useStore.getState().settings.ops.edit).toBeNull();
});
it.each([['Image', 'image'], ['Video', 'video'], ['3D', 'model3d']])('Auto releases %s and its hidden overrides', async (label, kind) => {
  await click(label); await click('Auto');
  expect(picks.reset).toHaveBeenCalledWith(kind);
  if (kind === 'image') expect(useStore.getState().settings.ops.edit).toBeNull();
  if (kind === 'video') expect(useStore.getState().composer.videoRoutes).toBeUndefined();
});
