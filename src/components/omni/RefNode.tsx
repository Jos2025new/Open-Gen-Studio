import type { NodeProps } from '@xyflow/react';
import { isOmniSpace } from '../../engine/nodes/omniSpaces';
import { LinkHandles, SystemNode } from '../node/SystemNode';
import type { FlowNode } from '../node/nodes';
import { ChatNode } from './ChatNode';
import { SpaceNode } from './SpaceNode';

export { LinkHandles };

/** The card of a system part: the chat and the three Spaces have their own look; the rest keep the system card. */
export function RefNode(props: NodeProps<FlowNode>) {
  const d = props.data.node.data;
  if (d.kind === 'ref' && d.type === 'chat') return <ChatNode {...props} />;
  if (d.kind === 'ref' && d.type === 'space' && isOmniSpace(d.ref)) return <SpaceNode {...props} />;
  return <SystemNode {...props} />;
}

/** Wider cards for the chat and the Spaces; everything else keeps the ordinary width. */
export function omniWidth(d: FlowNode['data']['node']['data'], fallback: number): number {
  if (d.kind !== 'ref') return fallback;
  return d.type === 'chat' ? 440 : d.type === 'space' && isOmniSpace(d.ref) ? 320 : fallback;
}
