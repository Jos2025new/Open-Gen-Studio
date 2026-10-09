import { useEffect, useState, useSyncExternalStore } from 'react';
import { Activity, Flag, Square } from 'lucide-react';
import { mark, onTraceChange, startTrace, stopTrace, traceFromUrl, traceStatus } from '../../lib/trace';
import { toast } from '../../store/store';

/*
 * Performance trace control (ADR 0012). Off until asked: Ctrl+Alt+P (or ?trace=<label> in the address) starts a
 * session; while it records, a chip shows it, takes markers ("now I add 50 blur layers") and stops it. Agents in
 * the sandbox use window.__OGS_TRACE__ with the same functions. It only writes logs/trace-<id>.jsonl.
 */

/** The trace key: Ctrl+Alt+P (⌘+Alt+P on a Mac). Listed in Settings → Shortcuts. */
export const isTraceKey = (e: KeyboardEvent) => (e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && e.code === 'KeyP';

const subscribe = (fn: () => void) => onTraceChange(fn);
let tick = 0;
const snapshot = () => (traceStatus() ? `${traceStatus()!.id}:${tick}` : '');

const api = {
  start: (label = 'session', opts: { domains?: string[]; deep?: boolean } = {}) => startTrace({ label, ...opts }),
  stop: () => stopTrace(),
  mark: (text: string) => mark(text),
  status: () => traceStatus(),
};

export function TraceControl() {
  const status = useSyncExternalStore(subscribe, snapshot) ? traceStatus() : null;
  const [asking, setAsking] = useState(false);
  const [label, setLabel] = useState('');
  const [marker, setMarker] = useState('');
  const [marking, setMarking] = useState(false);
  const [, setNow] = useState(0);

  useEffect(() => {
    traceFromUrl(window.location.search);
    Object.assign(window, { __OGS_TRACE__: api });
    const onKey = (e: KeyboardEvent) => {
      if (!isTraceKey(e)) return;
      e.preventDefault();
      if (traceStatus()) {
        const id = stopTrace();
        toast(`Trace saved: logs/trace-${id}.jsonl`, 'info', 8000);
      } else setAsking(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // The chip's clock.
  useEffect(() => {
    if (!status) return;
    const id = setInterval(() => { tick++; setNow((n) => n + 1); }, 1000);
    return () => clearInterval(id);
  }, [status]);

  if (asking && !status) {
    return <form className="trace-chip" onSubmit={(e) => { e.preventDefault(); startTrace({ label: label.trim() || 'session' }); setAsking(false); setLabel(''); }}>
      <Activity size={14} />
      <input autoFocus value={label} placeholder="What will you test?" aria-label="Trace label" onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setAsking(false); e.stopPropagation(); }} />
      <button type="submit">Record</button>
      <button type="button" onClick={() => setAsking(false)}>Cancel</button>
    </form>;
  }
  if (!status) return null;
  const mm = String(Math.floor(status.seconds / 60)).padStart(2, '0'), ss = String(status.seconds % 60).padStart(2, '0');
  return <form className="trace-chip is-recording" aria-label="Performance trace recording" onSubmit={(e) => { e.preventDefault(); if (marker.trim()) { mark(marker.trim()); toast(`Marker: ${marker.trim()}`, 'info', 2500); } setMarker(''); setMarking(false); }}>
    <span className="trace-dot" aria-hidden="true" />
    <span className="trace-label" title={`logs/trace-${status.id}.jsonl${status.domains.length ? ` · ${status.domains.join(', ')}` : ''}${status.deep ? ' · deep' : ''}`}>{status.label} <span className="num">{mm}:{ss}</span></span>
    {marking
      ? <input autoFocus value={marker} placeholder="What you do now · Enter" aria-label="Trace marker" onChange={(e) => setMarker(e.target.value)} onBlur={() => { if (!marker.trim()) setMarking(false); }} onKeyDown={(e) => { if (e.key === 'Escape') { setMarker(''); setMarking(false); } e.stopPropagation(); }} />
      : <button type="button" aria-label="Add a marker" title="Add a marker: what you are about to do" onClick={() => setMarking(true)}><Flag size={12} /></button>}
    <button type="button" aria-label="Stop trace" title="Stop (Ctrl+Alt+P)" onClick={() => { const id = stopTrace(); toast(`Trace saved: logs/trace-${id}.jsonl`, 'info', 8000); }}><Square size={12} /></button>
  </form>;
}
