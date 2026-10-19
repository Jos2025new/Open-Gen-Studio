import { useEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../ui/primitives';
import { getWriterState, handOverNow, keepHere, subscribeWriter, takeNow, useHere, waitForThem, type WorkReport } from '../../lib/writerLock';

/*
 * Covers the whole app while this tab is not the one that may write (plan 1.4): waiting for the lock, handed over,
 * stolen, a browser without Web Locks, or the holder while another tab waits for its work to finish. It blocks pointer
 * (the overlay), focus (`inert` on the app) and keys (a window capture listener registered before any other).
 */
const KEYS = ['keydown', 'keyup', 'keypress', 'beforeinput', 'paste', 'cut', 'drop'] as const;
const covered = (): boolean => { const s = getWriterState(); return s.phase !== 'held' || s.requested; };
if (typeof window !== 'undefined') {
  for (const type of KEYS) {
    window.addEventListener(type, (e) => {
      if (!covered() || (e.target instanceof Element && e.target.closest('.writer-lock'))) return;
      e.stopImmediatePropagation();
      e.preventDefault();
    }, true);
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** "1 generation and 1 agent reply" for the work that cannot be handed over. */
export function blockingText(w: WorkReport | null): string {
  if (!w) return '';
  const parts = [w.generations ? plural(w.generations, 'generation', 'generations') : '', w.agent ? plural(w.agent, 'agent reply', 'agent replies') : ''].filter(Boolean);
  return parts.join(' and ');
}

function Content() {
  const s = useSyncExternalStore(subscribeWriter, getWriterState);
  const list = blockingText(s.work);
  if (s.phase === 'unsupported') return (<><h2>This browser cannot save safely</h2><p>Open Gen Studio needs Web Locks to keep a single tab writing. Update your browser to use it.</p></>);
  if (s.phase === 'held') {
    return (<>
      <h2>Another tab is taking over</h2>
      <p>{list ? `Waiting for ${list} to finish before handing over. No new work starts here.` : 'Saving and handing over…'}</p>
      <div className="writer-lock-actions">
        <Button variant="ghost" onClick={keepHere}>Keep using here</Button>
        {list && <Button variant="danger" onClick={handOverNow}>Hand over now</Button>}
      </div>
      {list && <p className="muted">Handing over now loses {list}.</p>}
    </>);
  }
  return (<>
    <h2>Open Gen Studio is open in another tab</h2>
    {s.asking === 'idle' && (<><p>Only one tab works at a time, so nothing is overwritten.</p><div className="writer-lock-actions"><Button variant="primary" onClick={useHere}>Use here</Button></div></>)}
    {s.asking === 'asking' && <p>Asking the other tab to hand over…</p>}
    {s.asking === 'choose' && (<>
      <p>In the other tab there {s.work && s.work.generations + s.work.agent === 1 ? 'is' : 'are'} {list} in progress that cannot be handed over.</p>
      <div className="writer-lock-actions">
        <Button variant="primary" onClick={waitForThem}>Wait for them to finish</Button>
        <Button variant="danger" onClick={takeNow}>Take over now</Button>
      </div>
      <p className="muted">Taking over now loses {list}.</p>
    </>)}
    {s.asking === 'waiting-them' && (<>
      <p>Waiting for the other tab to finish{list ? `: ${list} in progress` : ''}. This tab takes over by itself.</p>
      <div className="writer-lock-actions"><Button variant="danger" onClick={takeNow}>Take over now</Button></div>
    </>)}
    {s.asking === 'silent' && (<>
      <p>The other tab does not answer. It may be frozen.</p>
      <p className="muted">Close or reload that tab: this one takes over by itself once it is gone.</p>
      <div className="writer-lock-actions"><Button variant="ghost" onClick={useHere}>Ask again</Button></div>
    </>)}
  </>);
}

export function WriterLockPanel() {
  const shown = useSyncExternalStore(subscribeWriter, covered);
  useEffect(() => {
    const root = document.getElementById('root');
    root?.toggleAttribute('inert', shown);
    return () => root?.removeAttribute('inert');
  }, [shown]);
  if (!shown) return null;
  return createPortal(
    <div className="writer-lock" role="alertdialog" aria-modal="true" aria-label="Open Gen Studio is open in another tab">
      <div className="writer-lock-card"><Content /></div>
    </div>,
    document.body,
  );
}
