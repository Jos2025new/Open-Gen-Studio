import type { NodeProps } from '@xyflow/react';
import { ExternalLink, Layers, MessageSquare, PenTool, Workflow } from '../ui/icons';
import type { LucideIcon } from '../ui/icons';
import { setSpaceParam, setSpaceView, type OmniSpace } from '../../engine/nodes/omni';
import { systemNodePorts } from '../../engine/nodes/spec';
import { useStore } from '../../store/store';
import { AssetMedia } from '../ui/AssetMedia';
import { Segmented } from '../ui/primitives';
import { SPACES, openSpace } from '../shell/navModel';
import { PortDot, useLive } from '../node/SystemNode';
import type { FlowNode } from '../node/nodes';

/* A Studio, Nodes or Designer node (plan "todo es un nodo", step 12): one per session, two looks the user switches.
 * Thumbnail: a snapshot of the Space, given the prominence the ordinary cards give a picture. Node: ports and parameters,
 * as in Blender or ComfyUI. Both read the Space where it lives; nothing is copied. */

const ICON: Record<OmniSpace, LucideIcon> = { studio: MessageSquare, nodes: Workflow, designer: PenTool };
const SPACE_ITEM: Record<OmniSpace, (typeof SPACES)[number]> = { studio: SPACES[0], nodes: SPACES[1], designer: SPACES[2] };

/** The ordinary card's picture frame, with the asset's own proportions. */
function Snapshot({ cover, empty, map }: { cover?: string; empty: string; map?: Array<{ x: number; y: number }> }) {
  const asset = useStore((s) => (cover ? s.assets[cover] : undefined));
  if (cover) {
    return (
      <div className="nc-body" style={{ aspectRatio: asset?.width && asset?.height ? `${asset.width} / ${asset.height}` : '1' }}>
        <div className="nc-media"><AssetMedia assetId={cover} draggable={false} /></div>
      </div>
    );
  }
  return (
    <div className="nc-body omni-snap-empty">
      {map?.length ? (
        <svg className="omni-map" viewBox="-6 -6 112 112" aria-label="Layout of the nodes" role="img">
          {map.map((p, i) => <rect key={i} x={p.x * 88} y={p.y * 88} width="12" height="8" rx="2" />)}
        </svg>
      ) : <span className="nc-hint">{empty}</span>}
    </div>
  );
}

function Param({ space, sessionId, p }: { space: OmniSpace; sessionId: string; p: { id: string; label: string; value: string; options?: Array<{ value: string; label: string }> } }) {
  return (
    <div className="omni-param">
      <span>{p.label}</span>
      {p.options ? (
        <select className="nodrag nowheel" aria-label={p.label} value={p.value} onChange={(e) => setSpaceParam(sessionId, space, p.id, e.target.value)}>
          {p.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : <output>{p.value}</output>}
    </div>
  );
}

export function SpaceNode({ data, selected }: NodeProps<FlowNode>) {
  const { node } = data;
  const sessionId = useStore((s) => s.activeSessionId);
  const live = useLive(sessionId, node);
  const d = node.data;
  if (d.kind !== 'ref') return null;
  const space = d.ref as OmniSpace;
  const view = d.view ?? 'thumb';
  const Icon = ICON[space] ?? Layers;
  const ports = systemNodePorts(d);
  const ins = ports.filter((p) => p.direction === 'in');
  const outs = ports.filter((p) => p.direction === 'out');
  const open = SPACE_ITEM[space];
  return (
    <>
      {ins.map((p, i) => <PortDot key={p.id} port={p} labels={view === 'node'} top={`${((i + 1) / (ins.length + 1)) * 100}%`} />)}
      {outs.map((p, i) => <PortDot key={p.id} port={p} labels={view === 'node'} top={`${((i + 1) / (outs.length + 1)) * 100}%`} />)}
      <div className={`nc k-ref k-sys-space omni-space is-${view} ${selected ? 'is-selected' : ''}`} data-system-type="space" data-space={space} data-view={view}>
        <div className="nc-label">
          <Icon size={12} />
          <span className="nc-title-text">{live?.title ?? d.title}</span>
          {live?.badge ? <span className="nc-sys-badge">{live.badge}</span> : null}
        </div>
        <div className="omni-look nodrag">
          <Segmented size="sm" value={view} options={[{ value: 'thumb', label: 'Thumbnail' }, { value: 'node', label: 'Node' }]} onChange={(v) => setSpaceView(sessionId, node.id, v)} />
          {open ? <button type="button" className="omni-open" aria-label={`Open ${d.title}`} data-tip={`Open ${d.title}`} onClick={() => openSpace(open)}><ExternalLink size={13} /></button> : null}
        </div>
        {view === 'thumb' ? (
          <>
            <Snapshot cover={live?.cover} map={live?.map} empty={space === 'designer' ? (live?.docName ? `${live.docName}: nothing exported yet` : 'No document yet') : space === 'studio' ? 'No results yet' : 'No nodes yet'} />
            <div className="nc-sys-chips omni-chips">{(live?.chips ?? []).map((c, i) => <span key={i}>{c}</span>)}</div>
          </>
        ) : (
          <div className="omni-params" aria-label={`${d.title} parameters`}>
            {(live?.params ?? []).map((p) => <Param key={p.id} space={space} sessionId={sessionId} p={p} />)}
          </div>
        )}
      </div>
    </>
  );
}
