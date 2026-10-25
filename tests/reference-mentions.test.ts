// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement as h, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { referenceChoices, stepReferenceChoices, useReferenceMentions } from '../src/components/ui/ReferenceMentions';
import type { Asset, PlanStep } from '../src/engine/types';
import { EditLine } from '../src/components/chat/PlanParts';
import { sendAgentMessage } from '../src/engine/agent/runtime';
vi.mock('../src/engine/agent/runtime', () => ({ sendAgentMessage: vi.fn() }));
vi.mock('../src/components/ui/AssetMedia', () => ({ AssetMedia: () => null }));
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(async () => { if (root) await act(async () => root.unmount()); document.body.innerHTML = ''; });

const choices = referenceChoices([{ id: 'a', label: 'Storyboard' }, { id: 'b', label: 'Character' }], [{ id: 'ana', name: 'Ana', refAssetIds: [] }], 'bytedance/seedance-2.0-mini');
function Field({ initial = 'Follow @' }: { initial?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(initial);
  const mentions = useReferenceMentions(ref, value, setValue, choices);
  return h('div', null, h('textarea', { ref, value, 'aria-label': 'Prompt', ...mentions.aria,
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => { setValue(e.target.value); mentions.sync(e.currentTarget); },
    onSelect: (e: React.SyntheticEvent<HTMLTextAreaElement>) => mentions.sync(e.currentTarget),
    onMouseUp: (e: React.MouseEvent<HTMLTextAreaElement>) => mentions.sync(e.currentTarget),
    onKeyDown: mentions.onKeyDown,
  }), mentions.menu);
}
async function mount(initial?: string) {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(h(Field, { initial })));
  const input = host.querySelector('textarea')!;
  input.focus(); input.setSelectionRange(input.value.length, input.value.length);
  await act(async () => { input.dispatchEvent(new Event('select', { bubbles: true })); });
  return input;
}
async function key(input: HTMLElement, key: string, isComposing = false) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, isComposing });
  await act(async () => { input.dispatchEvent(event); }); return event;
}
describe('reference autocomplete in the existing prompt field', () => {
  it('opens on @, chooses with arrows and Enter, and preserves focus', async () => {
    const input = await mount();
    expect(document.querySelectorAll('[role=option]')).toHaveLength(3);
    await key(input, 'ArrowDown');
    await act(async () => { input.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
    const event = await key(input, 'Enter');
    expect(event.defaultPrevented).toBe(true);
    expect(input.value).toBe('Follow @Image2 ');
    expect(document.activeElement).toBe(input);
    expect(document.querySelector('[role=listbox]')).toBeNull();
  });
  it('Escape leaves the text and closes the list; Enter during IME does not insert', async () => {
    const input = await mount();
    expect((await key(input, 'Enter', true)).defaultPrevented).toBe(false);
    expect(input.value).toBe('Follow @');
    await key(input, 'Escape');
    await act(async () => { input.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
    expect(input.value).toBe('Follow @'); expect(document.querySelector('[role=listbox]')).toBeNull();
  });
  it('replaces just the mention at the cursor and keeps the suffix', async () => {
    const input = await mount('Use @Cha then pan');
    input.setSelectionRange(8, 8);
    await act(async () => { input.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
    expect(document.querySelectorAll('[role=option]')).toHaveLength(1);
    await key(input, 'Enter'); expect(input.value).toBe('Use @Image2 then pan');
  });
  it('clicking a subject inserts its name instead of fixing its eventual reference index', async () => {
    const input = await mount();
    const option = document.querySelectorAll<HTMLButtonElement>('[role=option]')[2];
    await act(async () => { option.click(); }); expect(input.value).toBe('Follow @Ana ');
  });
  it('uses each model reference syntax and keeps image order', () => {
    expect(choices.map(c => c.mention)).toEqual(['@Image1', '@Image2', '@Ana']);
    expect(referenceChoices([{ id: 'x', label: 'Image' }], [], 'wan-3.0')[0].mention).toBe('Image 1');
    expect(referenceChoices([{ id: 'x', label: 'Image' }], [], 'grok-imagine-video')[0].mention).toBe('<IMAGE_0>');
  });
  it('opens after punctuation when the user types @', async () => {
    await mount('Look,@'); expect(document.querySelectorAll('[role=option]')).toHaveLength(3);
  });
  it('does not treat an email address as a reference', async () => {
    await mount('name@example.test'); expect(document.querySelector('[role=listbox]')).toBeNull();
  });
  it('selecting a mention in the existing plan editor does not send a revision', async () => {
    const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    await act(async () => root.render(h(EditLine, { label: 'Clip', references: choices, children: 'Existing prompt' })));
    await act(async () => { host.querySelector<HTMLButtonElement>('button')!.click(); });
    const input = host.querySelector('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '@');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(document.querySelectorAll('[role=option]')).toHaveLength(3);
    await key(input, 'Enter');
    expect(input.value).toBe('@Image1 '); expect(sendAgentMessage).not.toHaveBeenCalled();
  });
  it('uses the edited step refs, including future images, and prefers plan subjects over library names', () => {
    const source = { id: 'sheet', kind: 'image', title: 'Storyboard' } as PlanStep;
    const video = { kind: 'video', modelRef: 'openrouter::bytedance/seedance-2.0-mini', refs: ['asset:clip', 'sheet', 'asset:person'] } as PlanStep;
    const asset = (id: string, kind: Asset['kind'], name: string): Asset => ({ id, kind, name, mime: kind === 'image' ? 'image/png' : 'video/mp4', width: 64, height: 64, sessionId: 'test', origin: 'upload', stored: false, favorite: false, createdAt: 0 });
    const assets = { clip: asset('clip', 'video', 'Clip'), person: asset('person', 'image', 'Person') };
    const result = stepReferenceChoices(video, [source], assets, [{ id: 'ana', name: 'Ana', frontalAssetId: 'old', refAssetIds: [] }], [{ name: 'Ana', from: 'asset:person' }]);
    expect(result.map(c => c.mention)).toEqual(['@Image1', '@Image2', '@Ana']);
    expect(result.map(c => c.assetId)).toEqual([undefined, 'person', 'person']);
  });
});
