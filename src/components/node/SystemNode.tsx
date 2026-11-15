import { useMemo } from 'react';
import { Handle, MarkerType, Position, type NodeProps } from '@xyflow/react';
import { Bot, Cpu, Database, FileText, Layers, MessageSquare, Sparkles, Wand } from '../ui/icons';
import type { LucideIcon } from '../ui/icons';
import { resolveSystemNodeLive, systemNodePorts, type LiveSystemSummary } from '../../engine/nodes/spec';
import type { GraphEdge, PortSpec, PortType, SystemNodeType } from '../../engine/types';
import { useStore } from '../../store/store';
import type { FlowNode } from './nodes';

/* System parts as cards (docs/propuesta-todo-es-un-nodo-plan.md, step 8). Same card as the other nodes (.nc):
 * the body only reads the data where it already lives; nothing is copied. */

const ICONS: Record<SystemNodeType, LucideIcon> = {
  chat: MessageSquare,
  agent: Bot,
  model: Sparkles,
  provider: Cpu,
  session: MessageSquare,
  space: Layers,
  'designer.doc': FileText,
  library: Database,
  toolset: Wand,
};

/** One handle per port. The link class shows in the shape (data: dot, ref: ring, control: diamond), not only in the colour. */
export function PortDot({ port, top, labels = true }: { port: PortSpec; top: string; labels?: boolean }) {
  const side = port.direction === 'in' ? Position.Left : Position.Right;
  return (
    <>
      <Handle id={port.id} type={port.direction === 'in' ? 'target' : 'source'} position={side} className={`port port-link-${port.kind} port-${port.type}`} style={{ top }} />
      {labels ? <span className={`port-label ${side === Position.Left ? 'is-left' : 'is-right'}`} style={{ top }}>{port.label ?? port.id}</span> : null}
    </>
  );
}

/** Reference and control ports on creative nodes: they appear only while a connection is dragged, like their other secondary inputs. */
export function LinkHandles() {
  const ports: PortSpec[] = [
    { id: 'sys_ref', direction: 'in', kind: 'ref', type: 'any', label: 'References' },
    { id: 'model', direction: 'in', kind: 'control', type: 'model', label: 'Model' },
    { id: 'control', direction: 'in', kind: 'control', type: 'control', label: 'Control' },
    { id: 'out_ref', direction: 'out', kind: 'ref', type: 'any', label: 'Reference' },
    { id: 'out_control', direction: 'out', kind: 'control', type: 'control', label: 'Control' },
  ];
  const ins = ports.filter((p) => p.direction === 'in');
  const outs = ports.filter((p) => p.direction === 'out');
  return (
    <>
      {ins.map((p, i) => <PortDot key={p.id} port={p} top={`${88 - (ins.length - 1 - i) * 7}%`} />)}
      {outs.map((p, i) => <PortDot key={p.id} port={p} top={`${88 - (outs.length - 1 - i) * 7}%`} />)}
    </>
  );
}

export function useLive(sessionId: string, node: FlowNode['data']['node']): LiveSystemSummary | null {
  // A primitive key keeps the selector stable: the summary is rebuilt only when what the card shows changes.
  const key = useStore((_s) => {
    const live = resolveSystemNodeLive(sessionId, node);
    return live ? JSON.stringify({ ...live, doc: undefined }) : '';
  });
  return useMemo(() => (key ? (JSON.parse(key) as LiveSystemSummary) : null), [key]);
}

export function SystemNode({ data, selected }: NodeProps<FlowNode>) {
  const { node } = data;
  const sessionId = useStore((s) => s.activeSessionId);
  const d = node.data;
  const live = useLive(sessionId, node);
  if (d.kind !== 'ref') return null;
  const Icon = ICONS[d.type];
  const ports = systemNodePorts(d);
  const ins = ports.filter((p) => p.direction === 'in');
  const outs = ports.filter((p) => p.direction === 'out');
  return (
    <>
      {ins.map((p, i) => <PortDot key={p.id} port={p} top={`${((i + 1) / (ins.length + 1)) * 100}%`} />)}
      {outs.map((p, i) => <PortDot key={p.id} port={p} top={`${((i + 1) / (outs.length + 1)) * 100}%`} />)}
      <div className={`nc k-ref k-sys-${d.type.replace('.', '-')} ${selected ? 'is-selected' : ''}`} data-system-type={d.type} style={{ minHeight: `${(Math.max(ins.length, outs.length) + 1) * 1.5}rem` }}>
        <div className="nc-label">
          <Icon size={12} />
          <span className="nc-title-text">{live?.title ?? d.title}</span>
          {live?.badge ? <span className="nc-sys-badge">{live.badge}</span> : null}
        </div>
        <div className="nc-sys-body">
          <p className="nc-sys-sub">{live?.subtitle ?? ''}</p>
          {live?.attachedModels?.length ? (
            <ul className="nc-sys-models" aria-label="Attached models">
              {live.attachedModels.map((m) => <li key={`${m.nodeId}:${m.ref}:${m.mode}`}>{m.title}<small>{m.mode}</small></li>)}
            </ul>
          ) : null}
          <div className="nc-sys-chips">{(live?.chips ?? []).map((c, i) => <span key={i}>{c}</span>)}</div>
          {live?.details.map((t, i) => <p key={i} className="nc-sys-detail">{t}</p>)}
        </div>
      </div>
    </>
  );
}

/** Edge class and arrowheads for a link: data keeps its typed colour; ref and control are drawn by stroke and point the way (both ends when bidirectional). */
export function linkClassProps(e: GraphEdge, dataType: PortType | null) {
  const link = e.kind ?? 'data';
  if (link === 'data') return { className: `edge-${dataType ?? 'none'}` };
  const arrow = { type: MarkerType.ArrowClosed, width: 14, height: 14 };
  return { className: `edge-link-${link}${e.both ? ' edge-both' : ''}`, markerEnd: arrow, ...(e.both ? { markerStart: arrow } : {}) };
}
