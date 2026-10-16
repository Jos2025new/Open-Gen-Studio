import { setUi, useStore } from '../../store/store';

/**
 * While Home or a Space covers the workspace, the workspace stays mounted (drafts survive) but must not
 * react to the keyboard. Registered once at startup, before any component, so as the first
 * window capture listener it can stop the workspace's own window listeners.
 * Keys aimed at Home itself, a popover, the lightbox or the sketch editor still pass.
 */
export function installHomeKeyGuard(): void {
  window.addEventListener('keydown', (e) => {
    const ui = useStore.getState().ui;
    if (!(ui.home || ui.space) || ui.lightbox || ui.sketch) return;
    const t = e.target instanceof Element ? e.target : null;
    if (t?.closest('.home, .space, .popover, .lightbox, .sketch-editor, .side-panel, [role="dialog"]')) return;
    e.stopImmediatePropagation();
  }, true);
}

/** Reaching a workspace or a session by any route, or anything asking for the composer, leaves Home. */
export function installHomeAutoClose(): () => void {
  const key = (s: ReturnType<typeof useStore.getState>) => `${s.ui.workspace}|${s.activeSessionId}|${s.ui.focusComposer}`;
  let last = key(useStore.getState());
  let spaceWas = useStore.getState().ui.space;
  return useStore.subscribe((s) => {
    const k = key(s);
    const spaceBefore = spaceWas;
    spaceWas = s.ui.space;
    if (k === last) return;
    last = k;
    if (s.ui.home) setUi({ home: false });
    // A Space opened by the very update that moved to its workspace stays; it closes on any later change.
    if (s.ui.space && spaceBefore === s.ui.space) setUi({ space: undefined });
  });
}
