import { setUi, useStore } from '../../store/store';

/**
 * While Home covers the workspace, the workspace stays mounted (drafts survive) but must not
 * react to the keyboard. Registered once at startup, before any component, so as the first
 * window capture listener it can stop the workspace's own window listeners.
 * Keys aimed at Home itself, a popover, the lightbox or the sketch editor still pass.
 */
export function installHomeKeyGuard(): void {
  window.addEventListener('keydown', (e) => {
    const ui = useStore.getState().ui;
    if (!ui.home || ui.lightbox || ui.sketch) return;
    const t = e.target instanceof Element ? e.target : null;
    if (t?.closest('.home, .popover, .lightbox, .sketch-editor, .side-panel, [role="dialog"]')) return;
    e.stopImmediatePropagation();
  }, true);
}

/** Reaching a workspace or a session by any route, or anything asking for the composer, leaves Home. */
export function installHomeAutoClose(): () => void {
  const key = (s: ReturnType<typeof useStore.getState>) => `${s.ui.workspace}|${s.activeSessionId}|${s.ui.focusComposer}`;
  let last = key(useStore.getState());
  return useStore.subscribe((s) => {
    const k = key(s);
    if (k === last) return;
    last = k;
    if (s.ui.home) setUi({ home: false });
  });
}
