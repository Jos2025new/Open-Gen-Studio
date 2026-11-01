import { useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { create } from 'zustand';
import { Panel } from '@xyflow/react';
import { Info, LayoutGrid, MessageSquare, Plus, X } from 'lucide-react';
import type { MediaKind } from '../../engine/types';
import { nodeAttempt, nodeOutputAsset } from '../../engine/flow/graph';
import { useNodeSelection } from '../../engine/flow/selection';
import { setComposer, useStore } from '../../store/store';
import { FeedList, NoticeView } from '../chat/FeedList';
import { IconButton } from '../ui/primitives';
import { ResultSummary } from './ResultSummary';
import { AttachStrip, DesignerTargetChip, SendDirect } from '../composer/Composer';
import { MediaControls, ModelChip } from '../composer/MediaControls';
import { MODES } from '../composer/ModeMenu';

type View = 'chat' | 'create';
type Space = 'node' | 'designer';

/** Which view of the corner panel is open, if any (Nodes and the Designer's side toolbox share it). The toolbox buttons drive it; not persisted. */
export const useCorner = create<{ view: View; open: boolean }>(() => ({ view: 'create', open: false }));
const openCorner = (view: View) => useCorner.setState({ view, open: true });
/** A toolbox button: opens its view, or closes the panel when that view is already open. */
const toggleCorner = (view: View) => useCorner.setState((s) => (s.open && s.view === view ? { open: false } : { view, open: true }));

// Create shows the last direct kind used while the composer is in Agent mode.
let lastKind: MediaKind = 'image';

function useSpaceFeed(sessionId: string, space: Space) {
  const feed = useStore((s) => s.sessions[sessionId]?.feed);
  const items = feed?.filter((f) => f.workspace === space) ?? [];
  // Nodes shows its thread once the agent was asked there; the Designer, once anything was sent there.
  return { items, talked: items.some((f) => f.type === 'user' && (space !== 'node' || f.mode === 'agent')) };
}

/** The one node selected on the canvas, when it has a result to describe. */
function useSelectedResult(sessionId: string) {
  const ids = useNodeSelection((s) => s.bySession[sessionId]);
  const node = useStore((s) => (ids?.length === 1 ? s.sessions[sessionId]?.graph.nodes.find((n) => n.id === ids[0]) : undefined));
  const generation = useStore((s) => (node ? nodeAttempt(node, s.generations) : undefined));
  const asset = useStore((s) => (node ? s.assets[nodeOutputAsset(node, s.generations) ?? ''] : undefined));
  return node && asset ? { node, generation: generation?.status === 'done' ? generation : undefined, asset } : null;
}

/** Create and Conversation in the canvas toolbox (Nodes, beside Add node; the Designer's side toolbox, under Designs). */
export function CornerButtons({ sessionId, space = 'node' }: { sessionId: string; space?: Space }) {
  const { view, open } = useCorner();
  const { items } = useSpaceFeed(sessionId, space);
  const pending = useStore((s) => Boolean(s.sessions[sessionId]?.agent.pending || s.sessions[sessionId]?.agent.busy));
  return (
    <>
      <IconButton icon={LayoutGrid} label="Create" active={open && view === 'create'} aria-pressed={open && view === 'create'} onClick={() => toggleCorner('create')} />
      <span className="canvas-nav-badged">
        <IconButton icon={MessageSquare} label="Conversation" active={open && view === 'chat'} aria-pressed={open && view === 'chat'} onClick={() => toggleCorner('chat')} />
        {items.length ? <span className="canvas-nav-badge num">{items.length}</span> : null}
        {pending ? <span className="pulse-dot" /> : null}
      </span>
    </>
  );
}

/** Create: the composer's direct controls, stacked. Same store as the prompt box, so both always show the same kind, model, settings, prompt and references. */
function CreateForm({ designer = false }: { designer?: boolean }) {
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
        {MODES.filter((m) => m.id !== 'agent').map((m) => {
          // As in the prompt box: Designer layers hold images, text and shapes.
          const off = designer && m.id !== 'image';
          return <button key={m.id} type="button" role="radio" aria-checked={m.id === kind} disabled={off} className={`side-kind ${m.id === kind ? 'is-active' : ''}`} data-tip={off ? 'Designer layers hold images, text and shapes' : m.desc} onClick={() => setComposer({ mode: m.id })}>
            <m.icon size={14} /> {m.label}
          </button>;
        })}
      </div>
      <div className="side-row"><ModelChip kind={kind} />{designer && kind === 'image' ? <DesignerTargetChip /> : null}</div>
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

type Frame = (p: { result: boolean; label: string; children: ReactNode }) => ReactElement;

/** Header and body of the panel, inside the frame each space gives it; one selected result (Nodes only) shows its details instead. */
function SideContent({ sessionId, space, frame: FrameBox }: { sessionId: string; space: Space; frame: Frame }) {
  const { view, open } = useCorner();
  const { items, talked } = useSpaceFeed(sessionId, space);
  const pending = useStore((s) => Boolean(s.sessions[sessionId]?.agent.pending || s.sessions[sessionId]?.agent.busy));
  const selected = useSelectedResult(sessionId);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const notices = items.filter((f) => f.type === 'notice');
  const lastKey = items.length ? `${items[items.length - 1].id}:${items.length}` : '';
  const body = useRef<HTMLDivElement>(null);
  const shown = space === 'node' && open && selected && dismissed !== selected.node.id ? selected : null;

  // Nodes: a session with a Nodes conversation opens on it. Both: the agent at work brings it up.
  useEffect(() => {
    if (space === 'node' && talked) openCorner('chat');
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (pending) openCorner('chat');
  }, [pending]);
  useLayoutEffect(() => {
    const el = body.current;
    if (!el || shown || !open || view !== 'chat') return;
    el.scrollTop = el.scrollHeight;
    const id = requestAnimationFrame(() => (el.scrollTop = el.scrollHeight));
    return () => cancelAnimationFrame(id);
  }, [shown, open, view, lastKey]);

  if (!open) return null;
  const Icon = shown ? Info : view === 'create' ? LayoutGrid : MessageSquare;
  return <FrameBox result={Boolean(shown)} label={shown ? 'Details' : view === 'create' ? 'Create' : 'Conversation'}>
    <div className="side-head">
      <Icon size={14} />
      <span className="side-title">{shown ? shown.node.data.title : view === 'create' ? 'Create' : 'Conversation'}</span>
      {shown ? (
        <button type="button" className="side-icon" aria-label="Close details" data-tip="Back" onClick={() => setDismissed(shown.node.id)}>
          <X size={14} />
        </button>
      ) : (
        <button type="button" className="side-icon" aria-label="Close panel" data-tip="Close" onClick={() => useCorner.setState({ open: false })}>
          <X size={14} />
        </button>
      )}
    </div>
    <div className="side-body" ref={body}>
      {shown ? (
        <ResultSummary generation={shown.generation} asset={shown.asset} />
      ) : view === 'create' ? (
        <CreateForm designer={space === 'designer'} />
      ) : talked ? (
        <FeedList sessionId={sessionId} compact />
      ) : notices.length ? (
        <div className="composer-alerts">{notices.map((item) => item.type === 'notice' && <NoticeView key={item.id} item={item} sessionId={sessionId} />)}</div>
      ) : (
        <p className="faint thread-empty">Ask the agent from the prompt box; the conversation shows here.</p>
      )}
    </div>
  </FrameBox>;
}

/**
 * Nodes: the panel the toolbox's Create and Conversation buttons open, at the toolbox's right. One selected result shows
 * its details there. It steps aside while another toolbox menu (Add node, zoom, search, history, map) is open.
 */
export function NodeSide({ sessionId }: { sessionId: string }) {
  return <SideContent sessionId={sessionId} space="node" frame={NodeFrame} />;
}
const NodeFrame: Frame = ({ result, label, children }) => (
  <Panel position="top-left" className={`node-side nodrag nowheel ${result ? 'has-result' : ''}`} aria-label={label}>{children}</Panel>
);

/** Designer: the same panel at the right of the side toolbox (inside it, so it lines up with its top); hides while a tool's popups or Designs are open. */
export function DesignerCorner({ sessionId }: { sessionId: string }) {
  return <SideContent sessionId={sessionId} space="designer" frame={DesignerFrame} />;
}
const DesignerFrame: Frame = ({ label, children }) => <section className="node-side designer-corner" aria-label={label}>{children}</section>;
