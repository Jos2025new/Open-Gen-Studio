import { useMemo, type RefObject } from 'react';
import type { ReactFlowInstance } from '@xyflow/react';
import { useStore } from '../../store/store';
import { addOmniSpace, type OmniSpace } from '../../engine/nodes/omni';
import { addSystemNode } from '../../engine/nodes/system';
import { NODE_WIDTH } from '../../engine/flow/graph';
import type { GraphNodeData } from '../../engine/types';
import type { OmniEntries } from '../node/AddNodeItems';

/** The omnicanvas library entries (Spaces, system parts), placed at the centre of the view and selected. */
export function useOmniEntries(args: {
  omni: boolean;
  sessionId: string;
  rf: ReactFlowInstance;
  canvasRef: RefObject<HTMLDivElement | null>;
  freePos: (desired: { x: number; y: number }, data: GraphNodeData) => { x: number; y: number };
  selectNodes: (ids: Iterable<string>) => void;
}): OmniEntries | undefined {
  const { omni, sessionId, rf, canvasRef, freePos, selectNodes } = args;
  return useMemo((): OmniEntries | undefined => {
    if (!omni) return undefined;
    const center = () => { const r = canvasRef.current?.getBoundingClientRect(); return r ? rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2.6 }) : { x: 0, y: 0 }; };
    return {
      has: (space: OmniSpace) => useStore.getState().sessions[sessionId]?.graph.nodes.some((n) => n.data.kind === 'ref' && n.data.type === 'space' && n.data.ref === space) ?? false,
      onSpace: (space) => {
        const c = center();
        const pos = freePos({ x: c.x - 160, y: c.y }, { kind: 'ref', type: 'space', ref: space, title: space });
        selectNodes([addOmniSpace(sessionId, space, pos).id]);
      },
      onSystem: (type) => {
        const c = center();
        const pos = freePos({ x: c.x - NODE_WIDTH / 2, y: c.y }, { kind: 'ref', type, ref: type, title: type });
        selectNodes([addSystemNode(sessionId, { type, position: pos })]);
      },
    };
  }, [omni, sessionId, rf, freePos]);
}
