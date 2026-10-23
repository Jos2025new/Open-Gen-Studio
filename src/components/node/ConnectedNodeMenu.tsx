import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { getBezierPath, Handle, Position, useInternalNode, useReactFlow, useViewport } from '@xyflow/react';
import { Plus } from 'lucide-react';
import { addConnected } from '../../engine/flow/actions';
import { resultHandle, runsGeneration } from '../../engine/flow/graph';
import type { GraphNode, PortType } from '../../engine/types';
import { useStore } from '../../store/store';
import { Popover, usePopover } from '../ui/Popover';
import { AddNodeItems } from './AddNodeItems';

/** The + is the real output handle: dragging it uses ReactFlow, clicking it opens the same compatible choices. */
export function AddNext({ node, out }: { node: GraphNode; out: PortType }) {
  const sessionId = useStore((s) => s.activeSessionId);
  const pop = usePopover<HTMLDivElement>();
  const menu = useRef<HTMLDivElement>(null);
  const press = useRef<{ x: number; y: number } | null>(null);
  return <>
    <Handle
      ref={pop.ref} id="out" type="source" position={Position.Right}
      className={`nc-next nodrag port-${out}`} role="button" tabIndex={0}
      aria-label="Add connected node" aria-haspopup="dialog" aria-expanded={pop.open}
      data-tip="Drag to connect, or click to add a connected node"
      onPointerDown={(e) => { press.current = { x: e.clientX, y: e.clientY }; }}
      onClick={(e) => {
        if (press.current && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 5) return;
        pop.toggle();
      }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); pop.toggle(); } }}
    ><Plus size={13} /></Handle>
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} placement="right-start" width={260} label="Add connected node">
      <div ref={menu}><AddNodeItems searchable accepts={out} onPick={(data) => {
        if (addConnected(sessionId, node.id, data)) pop.close();
      }} /></div>
    </Popover>
    {pop.open ? <ConnectionPreview from={node.id} menu={menu} /> : null}
  </>;
}

/**
 * A node with several results gets one numbered output per result (Houdini/Nuke convention): a link from «2» always
 * uses the second result; a link from + follows the result chosen on the node. Shown on hover, or while linked.
 */
export function ResultPorts({ node, out }: { node: GraphNode; out: PortType }) {
  const d = node.data;
  const made = useStore((s) => (runsGeneration(d) && d.generationId ? s.generations[d.generationId]?.assetIds.length ?? 0 : 0));
  const used = useStore((s) => s.sessions[s.activeSessionId]?.graph.edges.filter((e) => e.source === node.id && e.outputIndex != null).map((e) => e.outputIndex!).join(',') ?? '');
  const linked = new Set(used ? used.split(',').map(Number) : []);
  const count = Math.max('settings' in d ? d.settings.count ?? 1 : 1, made, ...[...linked].map((i) => i + 1));
  if (count < 2) return null;
  return <>{Array.from({ length: count }, (_, i) => (
    <Handle key={i} id={resultHandle(i)} type="source" position={Position.Right}
      className={`nc-result nodrag port-${out} ${linked.has(i) ? 'is-linked' : ''}`}
      style={{ top: `calc(50% + ${22 + i * 18}px)` }}
      data-tip={`Result ${i + 1}: links from here always use it`}
    >{i + 1}</Handle>
  ))}</>;
}

/** Keep the curve while the picker is open. End at its measured position, including Popover's viewport clamping. */
export function ConnectionPreview({ from, menu }: { from: string; menu: RefObject<HTMLDivElement | null> }) {
  const source = useInternalNode(from);
  const rf = useReactFlow();
  const viewport = useViewport();
  const [target, setTarget] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const el = menu.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const next = { x: r.left, y: r.top + Math.min(r.height / 2, 28) };
      setTarget((old) => old?.x === next.x && old.y === next.y ? old : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    // Popover places itself in a layout effect; measure again after its fixed position is applied.
    const frame = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [menu, viewport]);
  const handle = source?.internals.handleBounds?.source?.find((h) => h.id === 'out');
  if (!source || !handle || !target) return null;
  const start = rf.flowToScreenPosition({ x: source.internals.positionAbsolute.x + handle.x + handle.width / 2, y: source.internals.positionAbsolute.y + handle.y + handle.height / 2 });
  const [path] = getBezierPath({ sourceX: start.x, sourceY: start.y, sourcePosition: Position.Right, targetX: target.x, targetY: target.y, targetPosition: Position.Left });
  return createPortal(<svg className="node-connection-preview" aria-hidden><path d={path} /></svg>, document.body);
}
