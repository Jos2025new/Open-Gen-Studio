// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined, delMany: async () => undefined },
  getAssetBlob: async () => undefined,
  peekAssetUrl: () => undefined,
  loadAssetUrl: async () => undefined,
  putAssetBlob: async () => undefined,
  deleteAssetBlobs: async () => undefined,
}));

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createSession, useStore } from '../src/store/store';
import { createDoc } from '../src/engine/design/doc';
import { previewRun } from '../src/engine/flow/actions';
import { stepSendSpec } from '../src/engine/planSteps/sendSpec';
import { buildContext } from '../src/engine/agent/context';
import { referenceChoices, stepReferenceChoices } from '../src/components/ui/ReferenceMentions';
import { MediaControls } from '../src/components/composer/MediaControls';
import { DocumentChoices, DocumentPicker } from '../src/components/designer/DocumentPicker';
import { DesignerWorkspace } from '../src/components/designer/DesignerWorkspace';
import type { Asset, PlanStep, Subject } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
}

const makeAsset = (id: string, sessionId: string): Asset => ({
  id, sessionId, kind: 'image', mime: 'image/png', name: `${id}.png`, createdAt: Date.now(), origin: 'upload', width: 512, height: 512, stored: true, favorite: false,
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const s = createSession('UI Test');
  useStore.setState({ sessions: { [s.id]: s }, activeSessionId: s.id, library: [], assets: {}, generations: {} });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('Contract 5 completion: kits stay out of mentions, sendSpec, flow, MediaControls, and agent context', () => {
  it('excludes kits from stepSendSpec nodeLibrary and flow previewRun subject checks', () => {
    const s = useStore.getState().sessions[useStore.getState().activeSessionId];
    const heroImg = makeAsset('a-hero', s.id);
    const hero: Subject = { id: 'sub-hero', name: 'Hero', kind: 'character', frontalAssetId: heroImg.id, refAssetIds: [] };
    const kit: Subject = { id: 'kit-1', name: 'AcmeBrand', kind: 'brand-kit', refAssetIds: [], pieces: [] };
    const modelRef = 'local::demo-img';
    useStore.setState((st) => ({
      assets: { [heroImg.id]: heroImg },
      library: [hero, kit],
      catalog: {
        ...st.catalog,
        models: { ...st.catalog.models, [modelRef]: { ref: modelRef, provider: 'local', id: 'demo-img', name: 'Demo', kind: 'image', acceptsText: true, acceptsImage: true, tags: [] } },
        schemas: { ...st.catalog.schemas, [modelRef]: { ref: modelRef, source: 'builtin', fetchedAt: Date.now(), slots: { images: { key: 'image_urls', multiple: true, min: 0, max: 4, format: 'url' } }, params: [] } },
      },
      sessions: {
        ...st.sessions,
        [s.id]: {
          ...s,
          graph: {
            nodes: [{ id: 'n1', position: { x: 0, y: 0 }, data: { kind: 'image', title: 'Shot', prompt: 'Poster using @AcmeBrand palette', modelRef, settings: { count: 1, advanced: {} }, outputIndex: 0 } }],
            edges: [],
          },
        },
      },
    }));

    const step: PlanStep = { id: 's1', kind: 'image', title: 'Shot', prompt: 'Poster for @AcmeBrand and @Hero', modelRef, refs: [], settings: { count: 1, advanced: {} } };
    const built = stepSendSpec(step, [step], undefined, useStore.getState());
    expect(built.spec?.inputs.nodeLibrary?.map((x) => x.id)).toEqual(['sub-hero']);

    // previewRun must ignore @AcmeBrand (a kit without frontalAssetId) instead of reporting "mentioned subject needs an available image".
    const preview = previewRun(s.id, ['n1']);
    expect(preview.errors).toEqual([]);
  });

  it('excludes kits from ReferenceMentions choices and stepReferenceChoices', () => {
    const hero: Subject = { id: 'sub-hero', name: 'Hero', kind: 'character', frontalAssetId: 'a1', refAssetIds: [] };
    const kit: Subject = { id: 'kit-1', name: 'AcmeDS', kind: 'design-system', refAssetIds: [] };
    expect(referenceChoices([], [hero, kit]).map((c) => c.mention)).toEqual(['@Hero']);
    const step: PlanStep = { id: 's1', kind: 'image', title: 'Shot', prompt: '', modelRef: 'local::demo-img', refs: [], settings: { count: 1, advanced: {} } };
    expect(stepReferenceChoices(step, [step], {}, [hero, kit]).map((c) => c.mention)).toEqual(['@Hero']);
  });

  it('excludes kits from MediaControls SubjectsChip', async () => {
    const s = useStore.getState().sessions[useStore.getState().activeSessionId];
    const heroImg = makeAsset('a-hero', s.id);
    const hero: Subject = { id: 'sub-hero', name: 'Hero', kind: 'character', frontalAssetId: heroImg.id, refAssetIds: [] };
    const kit: Subject = { id: 'kit-1', name: 'AcmeMood', kind: 'moodboard', refAssetIds: [] };
    const vRef = 'local::demo-vid';
    useStore.setState((st) => ({
      assets: { [heroImg.id]: heroImg },
      library: [hero, kit],
      composer: { ...st.composer, video: { ...st.composer.video, modelRef: vRef } },
      catalog: {
        ...st.catalog,
        models: { ...st.catalog.models, [vRef]: { ref: vRef, provider: 'local', id: 'demo-vid', name: 'DemoVid', kind: 'video', acceptsText: true, acceptsImage: true, tags: [] } },
        schemas: { ...st.catalog.schemas, [vRef]: { ref: vRef, source: 'builtin', fetchedAt: Date.now(), slots: { images: { key: 'image_urls', multiple: true, min: 0, max: 4, format: 'url' } }, params: [] } },
      },
    }));

    await act(async () => root.render(createElement(MediaControls, { kind: 'video', showModel: false })));
    const chip = host.querySelector<HTMLButtonElement>('button[aria-label="Subjects"]');
    expect(chip).toBeTruthy();
    expect(chip?.textContent).toContain('1 added');
    await act(async () => { chip!.click(); });
    const names = [...document.body.querySelectorAll('.subject-name')].map((el) => el.textContent);
    expect(names).toEqual(['@Hero']);
  });

  it('excludes kits from @Name library line in buildContext and adds a kit index line with contents and missing refs', () => {
    const s = useStore.getState().sessions[useStore.getState().activeSessionId];
    const a1 = makeAsset('a-logo', s.id);
    const hero: Subject = { id: 'sub-hero', name: 'Hero', kind: 'character', frontalAssetId: a1.id, refAssetIds: [] };
    const ds: Subject = {
      id: 'kit-ds', name: 'AcmeDS', kind: 'design-system', refAssetIds: [],
      pieces: [{ id: 'p-c', kind: 'color', color: '#ff0000' }],
      tokens: { colors: { primary: '#ff0000' }, fonts: { heading: 'Inter' } },
    };
    const brand: Subject = {
      id: 'kit-brand', name: 'AcmeBrand', kind: 'brand-kit', refAssetIds: [],
      pieces: [
        { id: 'p1', kind: 'kit', kitId: 'kit-ds' },
        { id: 'p2', kind: 'kit', kitId: 'kit-gone' },
        { id: 'p3', kind: 'asset', assetId: a1.id },
        { id: 'p4', kind: 'asset', assetId: 'a-missing' },
        { id: 'p5', kind: 'text', text: 'Bold and minimal' },
      ],
      links: [{ id: 'l1', from: 'p3', to: 'p5', label: 'tone' }],
    };
    useStore.setState({ assets: { [a1.id]: a1 }, library: [hero, ds, brand] });

    const text = buildContext(useStore.getState().sessions[s.id], { workspace: 'chat', style: 'auto', round: 0, maxRounds: 2, attachments: [] });
    const mentionLine = text.split('\n').find((l) => l.startsWith('library (mention as @Name')) ?? '';
    expect(mentionLine).toContain('@Hero');
    expect(mentionLine).not.toContain('AcmeDS');
    expect(mentionLine).not.toContain('AcmeBrand');

    const kitLine = text.split('\n').find((l) => l.startsWith('library kits')) ?? '';
    expect(kitLine).toBeTruthy();
    expect(kitLine).not.toContain('mention as @Name');
    expect(kitLine).not.toContain('@AcmeBrand');
    expect(kitLine).not.toContain('@AcmeDS');
    expect(kitLine).toContain('kit-ds');
    expect(kitLine).toContain('AcmeDS');
    expect(kitLine).toContain('design-system');
    expect(kitLine).toContain('colors/fonts');
    expect(kitLine).toContain('kit-brand');
    expect(kitLine).toContain('AcmeBrand');
    expect(kitLine).toContain('brand-kit');
    expect(kitLine).toContain('kit-gone');
    expect(kitLine).toContain('a-missing');
  });
});

describe('Contract 7: studio-view kit docs are hidden in DocumentPicker and DesignerWorkspace', () => {
  it('hides library.view === "studio" docs in DocumentChoices and DocumentPicker', async () => {
    const s = useStore.getState().sessions[useStore.getState().activeSessionId];
    const normal = createDoc('Poster', 1080, 1080, null);
    const studioKit = { ...createDoc('Kit Draft', 1080, 1080, null), library: { subjectId: 'k1', versionId: '', view: 'studio' as const } };
    const designerKit = { ...createDoc('Kit In Designer', 1080, 1080, null), library: { subjectId: 'k2', versionId: 'v1' } };

    await act(async () => root.render(createElement(DocumentChoices, { sessionId: s.id, docs: [normal, studioKit, designerKit], active: normal })));
    const labels = [...host.querySelectorAll('.document-choice span')].map((el) => el.textContent);
    expect(labels).toEqual(['Poster', 'Kit In Designer']);

    localStorage.setItem('ogs:canvas-picker-open', 'true');
    await act(async () => root.render(createElement(DocumentPicker, { sessionId: s.id, docs: [normal, studioKit, designerKit], active: normal })));
    const pickerLabels = [...host.querySelectorAll('.document-choice span')].map((el) => el.textContent);
    expect(pickerLabels).toEqual(['Poster', 'Kit In Designer']);
  });

  it('falls back to the first visible doc in DesignerWorkspace when activeDocId is a studio-view kit doc, or empty state if none visible', async () => {
    const s = useStore.getState().sessions[useStore.getState().activeSessionId];
    const studioKit = { ...createDoc('Hidden Studio Kit', 1080, 1080, null), library: { subjectId: 'k1', versionId: '', view: 'studio' as const } };
    useStore.setState({ sessions: { [s.id]: { ...s, docs: [studioKit], activeDocId: studioKit.id } } });

    await act(async () => root.render(createElement(DesignerWorkspace)));
    expect(host.querySelector('.designer-empty')).toBeTruthy();
    expect(host.textContent).not.toContain('Hidden Studio Kit');

    const visible = createDoc('Visible Poster', 1080, 1080, null);
    useStore.setState({ sessions: { [s.id]: { ...s, docs: [studioKit, visible], activeDocId: studioKit.id } } });
    await act(async () => root.render(createElement(DesignerWorkspace)));
    expect(host.querySelector('.designer-empty')).toBeNull();
    expect(host.querySelector('.document-picker-toggle')?.textContent).toContain('Visible Poster');
    expect(host.textContent).not.toContain('Hidden Studio Kit');
  });
});
