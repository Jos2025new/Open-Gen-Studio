import { setUi, useStore } from '../../store/store';
import { isTraceKey } from './TraceControl';

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
  // Keys aimed at Home or a Space still bubble on, where the hidden canvas listens: ReactFlow on document (Delete would
  // remove selected nodes), the others on window (Ctrl+Z after clicking "More" would undo in the Designer). Registered
  // first on document, this one cuts both, even inside Home's embedded Sessions and Library. Only the trace key and
  // Escape while a side panel is open go on: their window listeners are meant to work from here too.
  const bubble = (e: KeyboardEvent) => {
    if (!covered() || !target(e)?.closest('.home, .space')) return;
    if (isTraceKey(e) || (e.key === 'Escape' && useStore.getState().ui.panel)) return;
    e.stopImmediatePropagation();
  };
  document.addEventListener('keydown', bubble);
  document.addEventListener('keyup', bubble);
}

/** Reaching a workspace or a session by any route, or anything asking for the composer, leaves Home. */
export function installHomeAutoClose(): () => void {
  const key = (s: ReturnType<typeof useStore.getState>) => `${s.ui.workspace}|${s.activeSessionId}|${s.ui.focusComposer}`;
  let last = key(useStore.getState());
  let spaceWas = useStore.getState().ui.space;
  let hydrated = false;
  return useStore.subscribe((s) => {
    const k = key(s);
    // Hydration replaces the session and would close what was restored: take the restored state as the reference.
    if (!s.hydrated || !hydrated) {
      hydrated = s.hydrated;
      last = k;
      spaceWas = s.ui.space;
      return;
    }
    const spaceBefore = spaceWas;
    spaceWas = s.ui.space;
    if (k === last) return;
    last = k;
    if (s.ui.home) setUi({ home: false });
    // A Space opened by the very update that moved to its workspace stays; it closes on any later change.
    if (s.ui.space && spaceBefore === s.ui.space) setUi({ space: undefined });
  });
}
