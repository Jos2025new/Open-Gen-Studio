import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Panel } from '@xyflow/react';
import { ChevronDown, LayoutGrid, MessageSquare, Plus, X } from 'lucide-react';
import type { MediaKind } from '../../engine/types';
import { nodeAttempt, nodeOutputAsset } from '../../engine/flow/graph';
import { useNodeSelection } from '../../engine/flow/selection';
import { setComposer, useStore } from '../../store/store';
import { FeedList, NoticeView } from '../chat/FeedList';
import { ResultSummary } from './ResultSummary';
import { AttachStrip, SendDirect } from '../composer/Composer';
import { MediaControls, ModelChip } from '../composer/MediaControls';
import { MODES } from '../composer/ModeMenu';

type View = 'chat' | 'create';

// Create shows the last direct kind used while the composer is in Agent mode.
let lastKind: MediaKind = 'image';

/** The one node selected on the canvas, when it has a result to describe. */
function useSelectedResult(sessionId: string) {
  const ids = useNodeSelection((s) => s.bySession[sessionId]);
  const node = useStore((s) => (ids?.length === 1 ? s.sessions[sessionId]?.graph.nodes.find((n) => n.id === ids[0]) : undefined));
  const generation = useStore((s) => (node ? nodeAttempt(node, s.generations) : undefined));
  const asset = useStore((s) => (node ? s.assets[nodeOutputAsset(node, s.generations) ?? ''] : undefined));
  return node && asset ? { node, generation: generation?.status === 'done' ? generation : undefined, asset } : null;
}

/** Create: the composer's direct controls, stacked. Same store as the prompt box, so both always show the same kind, model, settings, prompt and references. */
function CreateForm() {
  const mode = useStore((s) => s.composer.mode);
  const text = useStore((s) => s.composer.text);
  const attachments = useStore((s) => s.composer.attachments);
  const kind: MediaKind = mode === 'agent' ? lastKind : mode;
  useEffect(() => {
    if (mode !== 'agent') lastKind = mode;
  }, [mode]);
  return (
    <div className="side-create">
      <div className="side-kinds" role="radiogroup" aria-label="Kind">
        {MODES.filter((m) => m.id !== 'agent').map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={m.id === kind} className={`side-kind ${m.id === kind ? 'is-active' : ''}`} data-tip={m.desc} onClick={() => setComposer({ mode: m.id })}>
            <m.icon size={14} /> {m.label}
          </button>
        ))}
      </div>
      <div className="side-row"><ModelChip kind={kind} /></div>
      <textarea className="side-prompt" rows={5} value={text} placeholder="Describe what you want to create…" aria-label="Prompt" onChange={(e) => setComposer({ text: e.target.value })} />
      <AttachStrip ids={attachments} />
      <button type="button" className="side-add" onClick={() => window.dispatchEvent(new Event('ogs:attach'))}>
        <Plus size={14} /> Add references
      </button>
      <div className="side-row side-chips"><MediaControls kind={kind} showModel={false} /></div>
      <div className="side-generate"><SendDirect kind={kind} /></div>
    </div>
  );
}

/**
 * Nodes: the corner beside the canvas toolbox: Conversation and Create (the direct controls, linked to the prompt box),
 * named while open, icons only while folded; the arrow folds and unfolds it. One selected result shows its details there.
 */
export function NodeSide({ sessionId }: { sessionId: string }) {
  const feed = useStore((s) => s.sessions[sessionId]?.feed);
  const pending = useStore((s) => Boolean(s.sessions[sessionId]?.agent.pending || s.sessions[sessionId]?.agent.busy));
  const selected = useSelectedResult(sessionId);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const items = feed?.filter((f) => f.workspace === 'node') ?? [];
  const talked = items.some((f) => f.type === 'user' && f.mode === 'agent');
  const notices = items.filter((f) => f.type === 'notice');
  const [view, setView] = useState<View>(talked ? 'chat' : 'create');
  const [open, setOpen] = useState(talked);
  const info = selected && dismissed !== selected.node.id ? selected : null;
  const lastKey = items.length ? `${items[items.length - 1].id}:${items.length}` : '';
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pending) return;
    setView('chat');
    setOpen(true);
  }, [pending]);
  useLayoutEffect(() => {
    const el = body.current;
    if (!el || info || !open || view !== 'chat') return;
    el.scrollTop = el.scrollHeight;
    const id = requestAnimationFrame(() => (el.scrollTop = el.scrollHeight));
    return () => cancelAnimationFrame(id);
  }, [info, open, view, lastKey]);

  const shown = open && info ? info : null;
  const pick = (v: View) => {
    if (shown) setDismissed(shown.node.id);
    setView(v);
    setOpen(true);
  };
  const active = (v: View) => open && !shown && view === v;
  const named = open && !shown;
  return (
    <Panel position="top-left" className={`node-side nodrag nowheel ${open ? 'is-open' : 'is-folded'}`} aria-label="Conversation and Create">
      <div className="side-head" role="toolbar" aria-label="Corner">
        <button type="button" className={`side-icon ${active('chat') ? 'is-active' : ''}`} aria-label="Conversation" aria-pressed={active('chat')} data-tip={named ? undefined : 'Conversation'} onClick={() => pick('chat')}>
          <MessageSquare size={15} />
          {named ? <span className="side-label">Conversation</span> : null}
          {items.length ? <span className="num side-count">{items.length}</span> : null}
          {pending ? <span className="pulse-dot" /> : null}
        </button>
        <button type="button" className={`side-icon ${active('create') ? 'is-active' : ''}`} aria-label="Create" aria-pressed={active('create')} data-tip={named ? undefined : 'Create'} onClick={() => pick('create')}>
          <LayoutGrid size={15} />
          {named ? <span className="side-label">Create</span> : null}
        </button>
        {shown ? (
          <>
            <span className="side-title">{shown.node.data.title}</span>
            <button type="button" className="side-icon" aria-label="Close details" data-tip="Close" onClick={() => setDismissed(shown.node.id)}>
              <X size={14} />
            </button>
          </>
        ) : null}
        <button type="button" className="side-icon side-fold" aria-label={open ? 'Fold' : 'Unfold'} aria-expanded={open} data-tip={open ? 'Fold' : 'Unfold'} onClick={() => setOpen(!open)}>
          <ChevronDown size={14} className={open ? 'rot-180' : ''} />
        </button>
      </div>
      {open ? (
        <div className="side-body" ref={body}>
          {shown ? (
            <ResultSummary generation={shown.generation} asset={shown.asset} />
          ) : view === 'create' ? (
            <CreateForm />
          ) : talked ? (
            <FeedList sessionId={sessionId} compact />
          ) : notices.length ? (
            <div className="composer-alerts">{notices.map((item) => item.type === 'notice' && <NoticeView key={item.id} item={item} sessionId={sessionId} />)}</div>
          ) : (
            <p className="faint thread-empty">Ask the agent from the prompt box; the conversation shows here.</p>
          )}
        </div>
      ) : null}
    </Panel>
  );
}
