import { afterEach, describe, expect, it } from 'vitest';
import {
  beginStateSave,
  confirmStateSave,
  failSave,
  hasPendingSave,
  markStateDirty,
  rasterPending,
  rasterSaved,
  resetSaveStatus,
  saveStatus,
} from '../src/store/saveStatus';

afterEach(() => resetSaveStatus());

describe('save status', () => {
  it('tracks dirty, saving, and confirmed versions', () => {
    const version = markStateDirty();
    expect(saveStatus.getState()).toMatchObject({ phase: 'unsaved', version, confirmed: 0 });
    expect(hasPendingSave()).toBe(true);

    beginStateSave(version);
    expect(saveStatus.getState()).toMatchObject({ phase: 'saving', version });

    confirmStateSave(version, false);
    expect(saveStatus.getState()).toMatchObject({ phase: 'saved', version, confirmed: version, browserOnly: false });
    expect(hasPendingSave()).toBe(false);
  });

  it('does not mark a newer edit saved when an older save finishes', () => {
    const earlier = markStateDirty();
    beginStateSave(earlier);
    const latest = markStateDirty();
    expect(saveStatus.getState().phase).toBe('unsaved');

    confirmStateSave(earlier, false);
    expect(saveStatus.getState()).toMatchObject({ phase: 'unsaved', version: latest, confirmed: earlier });
    expect(hasPendingSave()).toBe(true);
  });

  it('records browser-only confirmation and save failures', () => {
    const version = markStateDirty();
    beginStateSave(version);
    confirmStateSave(version, true);
    expect(saveStatus.getState()).toMatchObject({ phase: 'saved', confirmed: version, browserOnly: true });

    markStateDirty();
    failSave('disk unavailable');
    expect(saveStatus.getState()).toMatchObject({ phase: 'error', error: 'disk unavailable', conflict: false });
    expect(hasPendingSave()).toBe(true);

    failSave('newer copy exists', true);
    expect(saveStatus.getState()).toMatchObject({ phase: 'error', error: 'newer copy exists', conflict: true });
  });

  it('keeps raster writes pending until each write is confirmed', () => {
    rasterPending('layer-a');
    rasterPending('layer-b');
    expect(hasPendingSave()).toBe(true);

    rasterSaved('layer-a');
    expect(hasPendingSave()).toBe(true);
    rasterSaved('layer-b');
    expect(hasPendingSave()).toBe(false);
  });
});
