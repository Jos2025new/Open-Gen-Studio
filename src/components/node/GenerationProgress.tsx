import { LoaderCircle } from 'lucide-react';
import { nodeAttempt } from '../../engine/flow/graph';
import type { GraphNode } from '../../engine/types';
import { useStore } from '../../store/store';
import { useEta } from '../ui/useEta';

/** A node's running state: queued or generating, the provider's percentage if it reports one, else the typical duration. */
export function GenerationProgress({ node }: { node: GraphNode }) {
  const attempt = useStore(s => nodeAttempt(node, s.generations));
  const eta = useEta(attempt);
  if (!attempt || !['queued', 'running'].includes(attempt.status)) return null;
  return <div className="nc-generating" role="status" aria-live="polite">
    <div className="nc-generating-label"><LoaderCircle size={12} className="spin" />{attempt.status === 'queued' ? 'Queued' : 'Generating'}{attempt.progress != null ? ` · ${Math.round(attempt.progress * 100)}%` : ''}</div>
    {eta ? <span className="nc-generating-detail">{eta}</span> : null}
    {attempt.statusText && !/^generating/i.test(attempt.statusText) ? <span className="nc-generating-detail">{attempt.statusText}</span> : null}
    {attempt.progress != null ? <progress max={1} value={attempt.progress} aria-label="Generation progress" /> : <span className="nc-generating-sweep" aria-hidden />}
  </div>;
}
