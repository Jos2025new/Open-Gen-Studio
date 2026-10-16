import { setUi, useStore } from '../../store/store';

/**
 * While Home or a Space covers the workspace, the workspace stays mounted (drafts survive) but must not
 * react to the keyboard. Registered once at startup, before any component, so as the first
 * window capture listener it can stop the workspace's own window listeners.
 * Keys aimed at Home itself, a popover, the lightbox or the sketch editor still pass.
 */
export function installHomeKeyGuard(): void {
  const covered = () => { const ui = useStore.getState().ui; return (ui.home || ui.space) && !ui.lightbox && !ui.sketch; };
  const OWN = '.popover, .lightbox, .sketch-editor, .side-panel, [role="dialog"]';
  const target = (e: Event) => (e.target instanceof Element ? e.target : null);
  window.addEventListener('keydown', (e) => {
    if (!covered() || target(e)?.closest(`.home, .space, ${OWN}`)) return;
    e.stopImmediatePropagation();
  }, true);
  // Keys aimed at Home or a Space still bubble to window, where the hidden canvas listens (Ctrl+Z after clicking
  // "More" would undo in the Designer). Registered first, this one cuts them there, except Ctrl+Alt shortcuts (the trace key) and
  // Escape while a side panel is open, which rely on window listeners of their own.
  const bubble = (e: KeyboardEvent) => {
    const t = target(e);
    if (!covered() || !t?.closest('.home, .space') || t.closest(OWN)) return;
    if (((e.ctrlKey || e.metaKey) && e.altKey) || (e.key === 'Escape' && useStore.getState().ui.panel)) return;
    e.stopImmediatePropagation();
  };
  window.addEventListener('keydown', bubble);
  window.addEventListener('keyup', bubble);
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
