import { BaseEdge, EdgeLabelRenderer, getBezierPath, Panel, Position, Handle, type Edge, type EdgeProps } from '@xyflow/react';
import { memo } from 'react';
import { CircleAlert, X } from '../ui/icons';
import { type CableNotice, type GraphNotice, adoptCableRevision, summarizeNotices } from '../../engine/flow/notices';

export const NOTICE_OUT = 'notice-out';
export const NOTICE_IN = 'notice-in';

export function NoticeAnchors({ input, output }: { input?: boolean; output?: boolean }) {
  return <>
    {input && <Handle id={NOTICE_IN} type="target" position={Position.Left} isConnectable={false} className="node-notice-anchor" />}
    {output && <Handle id={NOTICE_OUT} type="source" position={Position.Right} isConnectable={false} className="node-notice-anchor" />}
  </>;
}

export function ProblemBadge({ count, hasErrors }: { count: number; hasErrors?: boolean }) {
  return count > 0 ? <span className={badgeClass(hasErrors)} role="img" aria-label={problemLabel(count)} data-tip={problemLabel(count)}>
    <CircleAlert size={12} aria-hidden="true" />{count}
  </span> : null;
}

const badgeClass = (hasErrors?: boolean) => `node-problem-badge${hasErrors ? ' is-error' : ''}`;
const problemLabel = (count: number) => `${count} problem${count === 1 ? '' : 's'}`;

export function ProblemList({ notices, onJump }: { notices: GraphNotice[]; onJump: (nodeId: string) => void }) {
  if (!notices.length) return null;
  const { count, hasErrors } = summarizeNotices(notices);
  const label = problemLabel(count);
  return (
    <div className="node-problem-list">
      <button type="button" className={badgeClass(hasErrors)} aria-label={label}>
        <CircleAlert size={13} aria-hidden="true" />{count}
      </button>
      <ul aria-label={label} className="node-notice-details nowheel">
        <li className="node-notice-heading" aria-hidden="true">{label}</li>
        {notices.map(n => <li key={n.kind === 'port' ? `${n.nodeId}:${n.port}` : n.edgeId}>
          <button type="button" onClick={() => onJump(n.nodeId)}><strong>{n.title}</strong><span>{n.message}</span></button>
        </li>)}
      </ul>
    </div>
  );
}

export const CanvasProblems = memo(function CanvasProblems(props: Parameters<typeof ProblemList>[0]) {
  return props.notices.length ? <Panel position="bottom-center" className="node-problems"><ProblemList {...props} /></Panel> : null;
});

export type NoticeEdge = Edge<{ notice: CableNotice; sessionId: string }, 'notice'>;

export function CableMarker({ notice, sessionId }: { notice: CableNotice; sessionId: string }) {
  const oldValue = 'The old value is unavailable. The pin stays on this cable until you update or remove it.';
  return (
    <div className="node-cable-notice">
      {notice.kind === 'pin' ? <>
        <button type="button" className="node-cable-marker" aria-label={notice.message}>
          <CircleAlert size={12} aria-hidden="true" />
        </button>
        <div className="node-notice-details node-pin-actions">
          <button type="button" disabled={!notice.next} onClick={() => {
            if (notice.next) adoptCableRevision(sessionId, notice.edgeId, notice.pin, notice.next);
          }}>Use new value</button>
          <span aria-hidden="true">·</span>
          <span data-tip={oldValue}><button type="button" disabled aria-description={oldValue}>Keep pinned</button></span>
        </div>
      </> : <span className="node-cable-marker is-invalid" tabIndex={0} data-tip={notice.message} aria-label={notice.message}>
        <X size={12} aria-hidden="true" />
      </span>}
    </div>
  );
}

function CableWithNotice({ data, markerEnd, markerStart, interactionWidth, ...position }: EdgeProps<NoticeEdge>) {
  const [path, x, y] = getBezierPath(position);
  const reason = data?.notice.kind === 'cable' ? data.notice.message : undefined;
  const hitWidth = interactionWidth ?? 20;
  return <>
    <BaseEdge path={path} markerEnd={markerEnd} markerStart={markerStart} data-tip={reason}
      interactionWidth={reason ? 0 : interactionWidth} />
    {reason && hitWidth > 0 && <path d={path} fill="none" strokeOpacity={0} strokeWidth={hitWidth}
      className="react-flow__edge-interaction" data-tip={reason} />}
    {data && <EdgeLabelRenderer>
      <div className="node-cable-label nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}>
        <CableMarker key={data.notice.kind === 'pin' ? `${data.notice.pin}:${data.notice.next}` : 'invalid'} {...data} />
      </div>
    </EdgeLabelRenderer>}
  </>;
}

export const noticeEdgeTypes = { notice: CableWithNotice };
