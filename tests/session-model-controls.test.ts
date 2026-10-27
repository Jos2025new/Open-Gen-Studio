// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
vi.mock('../src/engine/catalog', async (original) => ({ ...await original<typeof import('../src/engine/catalog')>(), loadCatalogs: vi.fn(async () => undefined) }));
const sessionDefaults = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock('../src/engine/agent/sessionModel', () => ({ setSessionModelAsDefault: sessionDefaults.set }));
vi.mock('../src/components/ui/Popover', async (original) => ({
  ...await original<typeof import('../src/components/ui/Popover')>(),
  Popover: ({ open, children }: { open: boolean; children: import('react').ReactNode }) => open ? createElement('div', {}, children) : null,
}));
vi.mock('../src/components/composer/ModelList', () => ({ ModelList: () => null }));
import { AgentModelControls } from '../src/components/composer/AgentModelControls';
import { SettingsPanel } from '../src/components/shell/SettingsPanel';
import { useStore } from '../src/store/store';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(async () => {
  vi.clearAllMocks();
  const st = useStore.getState();
  const sessionId = st.activeSessionId;
  useStore.setState({
    composer: { ...st.composer, image: { ...st.composer.image, modelRef: 'local::composer-image' }, video: { ...st.composer.video, modelRef: 'local::composer-video' } },
    settings: { ...st.settings, agent: { ...st.settings.agent, updateComposerDefaults: false } },
    sessions: { ...st.sessions, [sessionId]: { ...st.sessions[sessionId], agent: { ...st.sessions[sessionId].agent, settings: { image: { modelRef: 'local::session-image', needsImage: false }, video: { modelRef: 'local::composer-video', needsImage: false } } } } },
  });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(AgentModelControls)));
  const chip = host.querySelector('.models-chip') as HTMLButtonElement;
  await act(async () => chip.click());
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('keeps composer defaults visible and offers the session image model as an explicit default action', () => {
  const image = [...host.querySelectorAll('.agent-model-row')].find(row => row.querySelector('.agent-model-role')?.textContent === 'Image');
  expect(image?.textContent).toContain('composer-image');
  expect([...image!.querySelectorAll('button')].some(button => button.textContent === 'Set as default')).toBe(true);
  expect([...host.querySelectorAll('.agent-model-row')].find(row => row.querySelector('.agent-model-role')?.textContent === 'Video')?.querySelector('.link-btn')).toBeNull();
  expect(useStore.getState().composer.image.modelRef).toBe('local::composer-image');
});
it('sets only the active session model as the composer default when asked', async () => {
  const image = [...host.querySelectorAll('.agent-model-row')].find(row => row.querySelector('.agent-model-role')?.textContent === 'Image');
  const action = [...image!.querySelectorAll('button')].find(button => button.textContent === 'Set as default') as HTMLButtonElement;
  await act(async () => action.click());
  expect(sessionDefaults.set).toHaveBeenCalledWith(useStore.getState().activeSessionId, 'image');
});
it('stores the Agent Settings checkbox as a composer-default preference', async () => {
  await act(async () => root.render(createElement(SettingsPanel)));
  const agentTab = [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Agent') as HTMLButtonElement;
  await act(async () => agentTab.click());
  const toggle = [...host.querySelectorAll('label.check-row')].find(row => row.textContent?.includes("Update the composer's default model"))?.querySelector('input') as HTMLInputElement;
  expect(toggle.checked).toBe(false);
  await act(async () => toggle.click());
  expect(useStore.getState().settings.agent.updateComposerDefaults).toBe(true);
});
