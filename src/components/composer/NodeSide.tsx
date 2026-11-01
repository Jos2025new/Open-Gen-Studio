import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import type { ComposerMode } from '../../engine/types';
import { nodeAttempt, nodeOutputAsset } from '../../engine/flow/graph';
import { useNodeSelection } from '../../engine/flow/selection';
import { setComposer, useStore } from '../../store/store';
import { FeedList, NoticeView } from '../chat/FeedList';
import { GenerationInfo } from '../assets/GenerationInfo';
import { ReuseButton } from '../assets/ReuseButton';

// Create returns to the last direct mode used (image until one is picked).
let lastDirect: Exclude<ComposerMode, 'agent'> = 'image';

/** The one node selected on the canvas, when it has a result to describe. */
function useSelectedResult() {
  const sessionId = useStore((s) => s.activeSessionId);
  const ids = useNodeSelection((s) => s.bySession[sessionId]);
  const node = useStore((s) => (ids?.length === 1 ? s.sessions[sessionId]?.graph.nodes.find((n) => n.id === ids[0]) : undefined));
  const generation = useStore((s) => (node ? nodeAttempt(node, s.generations) : undefined));
  const asset = useStore((s) => (node ? s.assets[nodeOutputAsset(node, s.generations) ?? ''] : undefined));
  return node && asset ? { node, generation: generation?.status === 'done' ? generation : undefined, asset } : null;
}

/**
 * Nodes: the composer is a panel at the left, beside the canvas toolbox. Create (direct generation) and Agent (the
 * session conversation, full height) are its tabs; one selected node with a result shows its details above the prompt.
 */
export function NodeSide() {
  const mode = useStore((s) => s.composer.mode);
  const sessionId = useStore((s) => s.activeSessionId);
  const feed = useStore((s) => s.sessions[s.activeSessionId]?.feed);
  const pending = useStore((s) => Boolean(s.sessions[s.activeSessionId]?.agent.pending || s.sessions[s.activeSessionId]?.agent.busy));
  const selected = useSelectedResult();
  const [dismissed, setDismissed] = useState<string | null>(null);
  // Unfolded by default; folding keeps only the tabs and the prompt.
  const [open, setOpen] = useState(true);
  const agent = mode === 'agent';
  const items = feed?.filter((f) => f.workspace === 'node') ?? [];
  const lastKey = items.length ? `${items[items.length - 1].id}:${items.length}` : '';
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mode !== 'agent') lastDirect = mode;
  }, [mode]);
  useEffect(() => {
    if (pending) setOpen(true);
  }, [pending]);
  useLayoutEffect(() => {
    const el = body.current;
    if (!el || !agent || !open) return;
    el.scrollTop = el.scrollHeight;
    const id = requestAnimationFrame(() => (el.scrollTop = el.scrollHeight));
    return () => cancelAnimationFrame(id);
  }, [agent, open, lastKey]);

  const info = selected && dismissed !== selected.node.id ? selected : null;
  const notices = items.filter((f) => f.type === 'notice').slice(-2);
  return (
    <>
      <div className="side-head">
        <div className="side-tabs" role="tablist" aria-label="Composer">
          <button type="button" role="tab" aria-selected={!agent} className={`side-tab ${agent ? '' : 'is-active'}`} onClick={() => setComposer({ mode: lastDirect })}>
            Create
          </button>
          <button type="button" role="tab" aria-selected={agent} className={`side-tab ${agent ? 'is-active' : ''}`} onClick={() => setComposer({ mode: 'agent' })}>
            Agent
            {pending ? <span className="pulse-dot" /> : null}
          </button>
        </div>
        <button type="button" className="side-fold" aria-label={open ? 'Fold panel' : 'Unfold panel'} aria-expanded={open} data-tip={open ? 'Fold' : 'Unfold'} onClick={() => setOpen(!open)}>
          <ChevronDown size={14} className={open ? 'rot-180' : ''} />
        </button>
      </div>
      {open && info ? (
        <section className="side-info" aria-label="Selected result">
          <div className="side-info-head">
            <span className="side-info-title">{info.node.data.title}</span>
            <ReuseButton g={info.generation} />
            <button type="button" className="side-fold" aria-label="Close details" onClick={() => setDismissed(info.node.id)}>
              <X size={14} />
            </button>
          </div>
          <GenerationInfo generation={info.generation} asset={info.asset} />
        </section>
      ) : null}
      {open && agent && !info ? (
        <div className="side-thread" ref={body}>
          {items.length ? <FeedList sessionId={sessionId} compact /> : <p className="faint thread-empty">Ask the agent to build or change the flow.</p>}
        </div>
      ) : null}
      {!agent && notices.length ? <div className="composer-alerts">{notices.map((item) => item.type === 'notice' && <NoticeView key={item.id} item={item} sessionId={sessionId} />)}</div> : null}
    </>
  );
}
