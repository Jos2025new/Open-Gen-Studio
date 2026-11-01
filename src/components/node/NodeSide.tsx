import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Panel } from '@xyflow/react';
import { ChevronDown, Info, MessageSquare, X } from 'lucide-react';
import { nodeAttempt, nodeOutputAsset } from '../../engine/flow/graph';
import { useNodeSelection } from '../../engine/flow/selection';
import { useStore } from '../../store/store';
import { FeedList, NoticeView } from '../chat/FeedList';
import { GenerationInfo } from '../assets/GenerationInfo';
import { ReuseButton } from '../assets/ReuseButton';

/** The one node selected on the canvas, when it has a result to describe. */
function useSelectedResult(sessionId: string) {
  const ids = useNodeSelection((s) => s.bySession[sessionId]);
  const node = useStore((s) => (ids?.length === 1 ? s.sessions[sessionId]?.graph.nodes.find((n) => n.id === ids[0]) : undefined));
  const generation = useStore((s) => (node ? nodeAttempt(node, s.generations) : undefined));
  const asset = useStore((s) => (node ? s.assets[nodeOutputAsset(node, s.generations) ?? ''] : undefined));
  return node && asset ? { node, generation: generation?.status === 'done' ? generation : undefined, asset } : null;
}

/**
 * Nodes: the agent's corner, beside the canvas toolbox. It shows the details of the one selected result, or else the
 * Nodes conversation (or, before any, its notices with Undo); with nothing to show it is not drawn. The prompt box stays
 * the floating composer at the bottom. Folded, only its title pill remains.
 */
export function NodeSide({ sessionId }: { sessionId: string }) {
  const feed = useStore((s) => s.sessions[sessionId]?.feed);
  const pending = useStore((s) => Boolean(s.sessions[sessionId]?.agent.pending || s.sessions[sessionId]?.agent.busy));
  const selected = useSelectedResult(sessionId);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const items = feed?.filter((f) => f.workspace === 'node') ?? [];
  const talked = items.some((f) => f.type === 'user' && f.mode === 'agent');
  const notices = items.filter((f) => f.type === 'notice');
  const info = selected && dismissed !== selected.node.id ? selected : null;
  const lastKey = items.length ? `${items[items.length - 1].id}:${items.length}` : '';
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (pending) setOpen(true);
  }, [pending]);
  useLayoutEffect(() => {
    const el = body.current;
    if (!el || info || !open) return;
    el.scrollTop = el.scrollHeight;
    const id = requestAnimationFrame(() => (el.scrollTop = el.scrollHeight));
    return () => cancelAnimationFrame(id);
  }, [info, open, lastKey]);

  if (!info && !talked && !notices.length) return null;
  const Icon = info ? Info : MessageSquare;
  return (
    <Panel position="top-left" className={`node-side nodrag nowheel ${open ? 'is-open' : 'is-folded'}`} aria-label={info ? 'Details' : 'Conversation'}>
      <div className="side-head">
        <button type="button" className="side-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon size={14} />
          <span className="side-title">{info ? info.node.data.title : 'Conversation'}</span>
          {!info && talked ? <span className="num faint">{items.length}</span> : null}
          {pending ? <span className="pulse-dot" /> : null}
          <ChevronDown size={14} className={`side-chevron ${open ? 'rot-180' : ''}`} />
        </button>
        {open && info ? (
          <>
            <ReuseButton g={info.generation} />
            <button type="button" className="side-icon" aria-label="Close details" data-tip="Back to the conversation" onClick={() => setDismissed(info.node.id)}>
              <X size={14} />
            </button>
          </>
        ) : null}
      </div>
      {open ? (
        <div className="side-body" ref={body}>
          {info ? (
            <GenerationInfo generation={info.generation} asset={info.asset} />
          ) : talked ? (
            <FeedList sessionId={sessionId} compact />
          ) : (
            <div className="composer-alerts">{notices.map((item) => item.type === 'notice' && <NoticeView key={item.id} item={item} sessionId={sessionId} />)}</div>
          )}
        </div>
      ) : null}
    </Panel>
  );
}
