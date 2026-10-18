import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, MessageSquarePlus } from 'lucide-react';
import { sendAgentMessage } from '../../engine/agent/runtime';
import { AssetMedia } from '../ui/AssetMedia';
import { Button } from '../ui/primitives';

/**
 * A prompt (or a variation of one) clamped to two lines with a chevron that opens the whole text. The chevron shows only
 * when the text is really cut; with `head` (a variation's title) the title itself is the toggle and always shows.
 * `preview` replaces the children only while collapsed; the expanded text is always the children.
 */
export function Collapsible({ head, name, children, preview }: { head?: ReactNode; name: string; children: ReactNode; preview?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !open) setCut(el.scrollHeight > el.clientHeight + 1);
  });
  const Chev = open ? ChevronDown : ChevronRight;
  const toggle = (
    <button type="button" className="cc-chev" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${name}`} onClick={() => setOpen((o) => !o)}>
      <Chev size={14} />
    </button>
  );
  return (
    <div className={`cc-coll${open ? ' is-open' : ''}`}>
      {head ? (
        <button type="button" className="cc-coll-head" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${name}`} onClick={() => setOpen((o) => !o)}>
          <Chev size={14} />{head}
        </button>
      ) : null}
      <div className={head ? 'cc-coll-body' : 'cc-coll-row'}>
        <div ref={ref} className={`cc-ctext${open ? '' : ' is-clamped'}`}>{open ? children : (preview ?? children)}</div>
        {!head && (cut || open) ? toggle : null}
      </div>
    </div>
  );
}

/**
 * A line the user can ask to change: "Edit" shows on hover or focus and opens a short field. What is written goes to the
 * agent as a comment on the waiting plan (the existing revision path), prefixed with the line it is about.
 */
export function EditLine({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const send = () => {
    const t = text.trim();
    if (!t) return;
    void sendAgentMessage(`${label}: ${t}`, { attachments: [] });
    setOpen(false);
    setText('');
  };
  return (
    <div className="cc-edit">
      {children}
      <button type="button" className="cc-edit-btn" aria-label={`Edit ${label}`} onClick={() => { setOpen((o) => !o); setText(''); }}>Edit</button>
      {open ? (
        <input
          autoFocus
          className="q-custom cc-edit-input"
          placeholder="What should change here?"
          aria-label={`What should change in ${label}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); if (e.key === 'Escape') setOpen(false); }}
        />
      ) : null}
    </div>
  );
}

/** "Suggest changes": a quiet footer button; its field and note sit above the footer (see SuggestBox). */
export function SuggestButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`cc-suggest${open ? ' is-on' : ''}`} aria-expanded={open} onClick={onClick}>
      <MessageSquarePlus size={15} />Suggest changes
    </button>
  );
}

/** The agent revises the waiting plan with this comment (the same path as typing in the chat); nothing is spent. */
export function SuggestBox({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState('');
  const send = () => {
    const t = text.trim();
    if (!t) return;
    void sendAgentMessage(t, { attachments: [] });
    onDone();
  };
  return (
    <div className="cc-sb">
      <label className="cc-sb-q" htmlFor="cc-sb-text">What should change?</label>
      <textarea id="cc-sb-text" autoFocus className="cc-sb-ta" rows={2} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') onDone(); }} />
      <div className="cc-sb-row">
        <small>The agent revises the plan; nothing is spent</small>
        <Button size="sm" variant="secondary" disabled={!text.trim()} onClick={send}>Send</Button>
      </div>
    </div>
  );
}

/** A reference image the step uses, with a small REF badge. */
export function RefThumb({ assetId }: { assetId: string }) {
  return (
    <span className="cc-ref-thumb" data-ref-thumb={assetId}>
      <AssetMedia assetId={assetId} hoverPlay={false} autoPlay={false} draggable={false} />
      <b className="cc-ref-badge">REF</b>
    </span>
  );
}
