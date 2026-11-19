import type { NodeProps } from '@xyflow/react';
import { MessageSquare } from '../ui/icons';
import { setChatUndocked } from '../../engine/nodes/omni';
import { systemNodePorts } from '../../engine/nodes/spec';
import { useStore } from '../../store/store';
import { Segmented } from '../ui/primitives';
import { FeedList } from '../chat/FeedList';
import { Composer } from '../composer/Composer';
import { PortDot, useLive } from '../node/SystemNode';
import type { FlowNode } from '../node/nodes';
import { ChatRecipientSelect } from '../node/AgentNodeControls';

/* The chat as a node (plan "todo es un nodo", steps 10 and 12): the Studio chat itself (its feed and its composer),
 * not a copy. Docked it looks like Studio's chat; undocked it also shows the agent and models connected to it. */

export function ChatNode({ data, selected }: NodeProps<FlowNode>) {
  const { node } = data;
  const sessionId = useStore((s) => s.activeSessionId);
  const live = useLive(sessionId, node);
  const d = node.data;
  const empty = useStore((s) => !s.sessions[s.activeSessionId]?.feed.length);
  if (d.kind !== 'ref') return null;
  const undocked = d.undocked === true;
  const ports = systemNodePorts(d);
  const ins = ports.filter((p) => p.direction === 'in');
  const outs = ports.filter((p) => p.direction === 'out');
  return (
    <>
      {ins.map((p, i) => <PortDot key={p.id} port={p} labels={undocked} top={`${((i + 1) / (ins.length + 1)) * 100}%`} />)}
      {outs.map((p, i) => <PortDot key={p.id} port={p} labels={undocked} top={`${((i + 1) / (outs.length + 1)) * 100}%`} />)}
      <div className={`nc k-ref k-sys-chat omni-chat is-${undocked ? 'undocked' : 'docked'} ${selected ? 'is-selected' : ''}`} data-system-type="chat" data-docked={!undocked}>
        <div className="nc-label">
          <MessageSquare size={12} />
          <span className="nc-title-text">{live?.title ?? d.title}</span>
          {live?.badge ? <span className="nc-sys-badge">{live.badge}</span> : null}
        </div>
        <div className="omni-look nodrag">
          <Segmented size="sm" value={undocked ? 'undocked' : 'docked'} options={[{ value: 'docked', label: 'Chat', tip: 'Looks like the Studio chat' }, { value: 'undocked', label: 'Connections', tip: 'Shows its agent and models' }]} onChange={(v) => setChatUndocked(sessionId, node.id, v === 'undocked')} />
        </div>
        <ChatRecipientSelect sessionId={sessionId} nodeId={node.id} recipient={d.recipient} />
        <div className="omni-chat-feed nodrag nowheel">
          <div className="chat"><div className="chat-column">
            {empty ? <p className="faint">Nothing yet. Say what you want to make.</p> : <FeedList sessionId={sessionId} studio />}
          </div></div>
        </div>
        <div className="omni-chat-composer nodrag nowheel"><Composer chatNodeId={node.id} /></div>
        {undocked ? (
          <ul className="nc-sys-models omni-connections" aria-label="Connected agent and models">
            {(live?.connections ?? []).map((c) => <li key={c.nodeId} data-kind={c.kind}><span>{c.kind === 'agent' ? 'Agent · ' : ''}{c.title}</span><small>{c.detail}</small></li>)}
            {live?.connections?.length ? null : <li><span>No agent or model connected</span></li>}
          </ul>
        ) : null}
      </div>
    </>
  );
}
