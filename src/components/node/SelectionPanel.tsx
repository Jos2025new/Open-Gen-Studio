import { Panel } from '@xyflow/react';
import { Brush, Download, Paperclip, RectangleHorizontal, type LucideIcon } from 'lucide-react';
import { OPS, OP_IDS } from '../../engine/ops';
import { addConnected, newNodeData } from '../../engine/flow/actions';
import { outputPort } from '../../engine/flow/graph';
import { downloadAsset, useAsReference } from '../../engine/actions';
import type { GraphNode, OpId, ToolNodeData } from '../../engine/types';
import { setUi, useStore } from '../../store/store';
import { MenuItem } from '../ui/primitives';
import { OP_ICONS } from '../assets/AssetActions';
import { OP_GROUP_LABEL, OP_GROUP_ORDER, opGroup, type OpGroupId } from '../assets/opGroups';
import { KIND_ICON, useNodeOutput } from './nodes';

type Item = { key: string; icon: LucideIcon; label: string; tip?: string; detail?: string; onClick: () => void };

/**
 * One node with a result selected: what can be done with that result, by section, at the top right of the canvas.
 * Each op adds a connected tool node (its settings and Run show under that node), as the node bar's tools did.
 */
export function SelectionPanel({ sessionId, node }: { sessionId: string; node: GraphNode }) {
  const { assetId, all } = useNodeOutput(node);
  const asset = useStore((s) => (assetId ? s.assets[assetId] : undefined));
  const out = useStore((s) => outputPort(node.data, s.assets));
  if (!assetId || !out) return null;
  const add = (op: OpId, patch: Partial<ToolNodeData> = {}) => {
    const data = newNodeData('tool', { op }) as ToolNodeData;
    addConnected(sessionId, node.id, { ...data, ...patch, params: { ...data.params, ...patch.params } });
  };
  const sections: Record<OpGroupId, Item[]> = { explore: [], edit: [], reuse: [], finalize: [] };
  for (const id of OP_IDS.filter((op) => !OPS[op].multiInput && OPS[op].input === out)) {
    sections[opGroup(id)].push({ key: id, icon: OP_ICONS[id], label: OPS[id].label, tip: `${OPS[id].description} (adds a connected node)`, onClick: () => add(id) });
    if (id === 'reframe') sections.edit.push({ key: 'panorama', icon: RectangleHorizontal, label: 'Panorama', tip: 'Reframe to 21:9 (adds a connected node)', onClick: () => add('reframe', { title: 'Panorama', params: { aspect: '21:9' } }) });
  }
  if (out === 'image') sections.edit.push({ key: 'sketch', icon: Brush, label: 'Sketch', tip: 'Paint over the image; the edited version is what goes downstream', onClick: () => setUi({ sketch: { assetId, nodeId: node.id } }) });
  sections.reuse.push({ key: 'attach', icon: Paperclip, label: 'Attach to prompt', onClick: () => useAsReference(assetId) });
  sections.finalize.push({ key: 'download', icon: Download, label: 'Download', onClick: () => void downloadAsset(assetId) });
  const Icon = KIND_ICON[asset?.kind ?? out] ?? KIND_ICON.image;
  return (
    <Panel position="top-right" className="selection-panel nodrag nowheel" aria-label="Selection">
      <div className="sp-head">
        <Icon size={14} />
        <span className="sp-title">{node.data.title}</span>
        {asset?.width && asset.height ? <span className="sp-size">{asset.width} × {asset.height}</span> : null}
        {all.length > 1 ? <span className="sp-size">{Math.max(0, all.indexOf(assetId)) + 1}/{all.length}</span> : null}
      </div>
      {OP_GROUP_ORDER.filter((g) => sections[g].length).map((g) => (
        <section key={g} className="sp-group" aria-label={OP_GROUP_LABEL[g]}>
          <div className="menu-sep-label">{OP_GROUP_LABEL[g]}</div>
          <div className="menu">
            {sections[g].map((it) => (
              <MenuItem key={it.key} icon={it.icon} label={it.label} detail={it.detail} tip={it.tip} onClick={it.onClick} />
            ))}
          </div>
        </section>
      ))}
    </Panel>
  );
}

/** The Selection panel shows for exactly one selected node (with a result). */
export function SoloSelection({ sessionId, nodes }: { sessionId: string; nodes: GraphNode[] }) {
  return nodes.length === 1 ? <SelectionPanel key={nodes[0].id} sessionId={sessionId} node={nodes[0]} /> : null;
}
