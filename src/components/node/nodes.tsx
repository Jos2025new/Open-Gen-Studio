import { memo, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Handle, NodeToolbar, Position, useConnection, useUpdateNodeInternals, useStore as useFlowStore, type Node, type NodeProps } from '@xyflow/react';
import { X, Brush, Info, ChevronDown, Ellipsis, RectangleHorizontal, RotateCcw, CircleAlert, Copy, Download, GripVertical, LoaderCircle, Maximize2, Trash, Check, Paperclip } from '../ui/icons';
import { OPS, OP_IDS } from '../../engine/ops';
import { ratioOf } from '../../engine/params';
import { addConnected, deleteNodes, duplicateNode, newNodeData, patchNodeData, restoreNodeGeneration, renameNode, setSketch } from '../../engine/flow/actions';
import { nodeAttempt, inputPorts, nodeOutputAsset, outputPort, runsGeneration } from '../../engine/flow/graph';
import { detachOutputs, reattachOutputs } from '../../engine/flow/arrange';
import { extensionForMime } from '../../lib/media';
import { deleteAssets, downloadAsset, addAsReference } from '../../engine/actions';
import type { Asset, Generation, GenNodeData, GraphEdge, GraphGroup, GraphNode, OpId, PortType, ToolNodeData } from '../../engine/types';
import { setUi, toast, useStore } from '../../store/store';
import { AssetMedia } from '../ui/AssetMedia';
import { GenerationProgress } from './GenerationProgress';
import { Popover, PopoverHeader, usePopover } from '../ui/Popover';
import { Button, IconButton, MenuItem } from '../ui/primitives';
import { GenerationInfo } from '../assets/GenerationInfo';
import { OP_ICONS } from '../assets/AssetActions';
import { AddNext, ResultPorts } from './ConnectedNodeMenu';
import { AgentAttachToggle } from '../assets/AgentAttachToggle';
import { KeyTools, PanelToggle } from './NodeBarExtras';
import { LinkHandles, RefNode as SystemNode } from '../omni/RefNode';
import { GenNodeBody, ToolNodeBody } from './NodeSettings';
import { RunButton } from './NodeRunButton';
import { NoticeAnchors } from './CanvasNotices';
import { useDeleteRequestContext } from './LinkBar';
import type { PortNotice } from '../../engine/flow/notices';
export { RunButton } from './NodeRunButton';

/** `solo`: this node is the only selected one, so its toolbar and settings panel show. `panel`: the canvas shows the Selection panel, which holds the result's tools. */
export type FlowNodeData = { node: GraphNode; solo: boolean; panel?: boolean; missing?: PortNotice[]; noticeIn?: boolean; noticeOut?: boolean; spaceProblems?: number; spaceHasErrors?: boolean };
export type FlowNode = Node<FlowNodeData>;

import { KIND_ICON } from './nodeUi';
export { KIND_ICON };

/** `quiet`: a secondary input, shown only while a connection is being dragged (or once something is connected to it). */
function PortHandle({ id, type, side, top, label, portType, quiet, problem }: { id: string; type: 'source' | 'target'; side: Position; top: string; label?: string; portType: PortType | null; quiet?: boolean; problem?: string }) {
  return (
    <>
      <Handle id={id} type={type} position={side} className={`port port-${portType ?? 'none'} ${problem ? 'node-port-missing' : quiet ? 'port-quiet' : ''}`} style={{ top }} data-tip={problem} aria-label={problem} tabIndex={problem ? 0 : undefined}>
        {problem && <X size={8} aria-hidden="true" />}
      </Handle>
      {label ? (
        <span className={`port-label ${side === Position.Left ? 'is-left' : 'is-right'}`} style={{ top }}>
          {label}
        </span>
      ) : null}
    </>
  );
}

function useSessionId() {
  return useStore((s) => s.activeSessionId);
}

function DeleteButton({ node }: { node: GraphNode }) {
  const sessionId = useSessionId();
  const pop = usePopover();
  const requestDelete = useDeleteRequestContext();
  return (
    <>
      <button ref={pop.ref} type="button" className="nt-btn nt-icon nodrag" aria-label="Delete node" data-tip="Delete (Del)" onClick={pop.toggle}>
        <Trash size={14} />
      </button>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={250} label="Delete node">
        <div className="confirm">
          <p>Delete “{node.data.title}”? Its results stay in the gallery.</p>
          <div className="spend-actions">
            <Button variant="ghost" onClick={pop.close}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                pop.close();
                if (requestDelete) requestDelete([node.id]);
                else deleteNodes(sessionId, [node.id]);
              }}
            >
              Delete
            </Button>
          </div>
        </div>
      </Popover>
    </>
  );
}

function StatusPill({ node }: { node: GraphNode }) {
  const g = useStore(s => nodeAttempt(node, s.generations));
  if (!g) return null;
  if (g.status === 'running' || g.status === 'queued')
    return (
      <span className="node-status is-running" data-tip={g.statusText}>
        <LoaderCircle size={11} className="spin" />
      </span>
    );
  if (g.status === 'error')
    return (
      <span className="node-status is-error" data-tip={g.error}>
        <CircleAlert size={11} />
      </span>
    );
  if (g.status === 'done')
    return (
      <span className="node-status is-done">
        <Check size={11} />
      </span>
    );
  return null;
}

function HistoryOutput({ node, generation: g, assetId, index, number, onOpen }: { node: GraphNode; generation: Generation; assetId: string; index: number; number: number; onOpen: () => void }) {
  const sessionId = useSessionId();
  const asset = useStore(s => s.assets[assetId]);
  const info = usePopover();
  return <div className="nc-history-output">
    <div className="nc-history-thumb">
      <button type="button" className="nc-history-preview" style={{ aspectRatio: asset?.width && asset?.height ? `${asset.width} / ${asset.height}` : '1' }} aria-label={`View generation ${number}, output ${index + 1}`} onClick={() => { onOpen(); setUi({ lightbox: { assetIds: g.assetIds, index } }); }}><AssetMedia assetId={assetId} hoverPlay draggable={false} /></button>
      <AgentAttachToggle assetId={assetId} />
    </div>
    <div className="nc-history-actions">
      <IconButton ref={info.ref} icon={Info} size="sm" label={`Details for generation ${number}, output ${index + 1}`} active={info.open} onClick={info.toggle} />
      <IconButton icon={RotateCcw} size="sm" label={`Restore parameters from generation ${number}`} onClick={() => { const error = restoreNodeGeneration(sessionId, node.id, g.id); toast(error ?? 'Parameters restored. Run when ready.', error ? 'error' : 'success'); }} />
    </div>
    <Popover open={info.open} anchor={info.ref} onClose={info.close} width={340} label="Generation details" className="pop-scroll">
      <PopoverHeader title="Generation details" />
      <GenerationInfo generation={g} asset={asset} />
      <div className="nc-history-footer"><Button icon={Trash} size="sm" variant="secondary" onClick={() => { deleteAssets([assetId]); info.close(); }}>Delete asset</Button></div>
    </Popover>
  </div>;
}

const historyByNodeCache = new WeakMap<Record<string, Generation>, { byNode: Map<string, Generation[]>; order: Map<string, number> }>();
const EMPTY_GENERATIONS: Generation[] = [];

export function nodeGenerationHistory(generations: Record<string, Generation>, sessionId: string, nodeId: string, current?: string): Generation[] {
  let cached = historyByNodeCache.get(generations);
  if (!cached) {
    const byNode = new Map<string, Generation[]>();
    const order = new Map<string, number>();
    let i = 0;
    for (const g of Object.values(generations)) {
      order.set(g.id, i++);
      if (g.status === 'done' && !g.assetIds.length && g.text == null) continue;
      const k = `${g.sessionId}\0${g.stepId}`;
      const list = byNode.get(k);
      if (list) list.push(g);
      else byNode.set(k, [g]);
    }
    for (const list of byNode.values()) if (list.length > 1) list.sort((a, b) => a.createdAt - b.createdAt);
    cached = { byNode, order };
    historyByNodeCache.set(generations, cached);
  }
  const bucket = cached.byNode.get(`${sessionId}\0${nodeId}`) ?? EMPTY_GENERATIONS;
  const cur = current ? generations[current] : undefined;
  if (!cur || (cur.status === 'done' && !cur.assetIds.length && cur.text == null) || bucket.some((g) => g.id === cur.id)) {
    return bucket;
  }
  return [...bucket, cur].sort((a, b) => (a.createdAt - b.createdAt) || ((cached!.order.get(a.id) ?? 0) - (cached!.order.get(b.id) ?? 0)));
}

const detachedGroupCache = new WeakMap<GraphGroup[], Map<string, GraphGroup>>();

function detachedOutputGroupFor(groups: GraphGroup[] | undefined, nodeId: string): GraphGroup | undefined {
  if (!groups?.length) return undefined;
  let byNode = detachedGroupCache.get(groups);
  if (!byNode) {
    byNode = new Map();
    for (const g of groups) if ('detachedOutputs' in g) for (const id of g.nodeIds) byNode.set(id, g);
    detachedGroupCache.set(groups, byNode);
  }
  return byNode.get(nodeId);
}

const targetHandlesCache = new WeakMap<GraphEdge[], Map<string, string>>();

function wiredTargetHandles(edges: GraphEdge[] | undefined, nodeId: string): string {
  if (!edges?.length) return '';
  let byTarget = targetHandlesCache.get(edges);
  if (!byTarget) {
    const lists = new Map<string, string[]>();
    for (const e of edges) {
      const list = lists.get(e.target);
      const handle = e.targetHandle ?? '';
      if (list) list.push(handle);
      else lists.set(e.target, [handle]);
    }
    byTarget = new Map();
    for (const [id, list] of lists) byTarget.set(id, list.join('|'));
    targetHandlesCache.set(edges, byTarget);
  }
  return byTarget.get(nodeId) ?? '';
}

function NodeHistory({ node }: { node: GraphNode }) {
  const sessionId = useSessionId();
  const pop = usePopover();
  const current = runsGeneration(node.data) ? node.data.generationId : undefined;
  const history = useStore(useShallow((s) => nodeGenerationHistory(s.generations, sessionId, node.id, current)));
  if (history.length < 2) return null;
  const index = history.findIndex(g => g.id === current);
  return <>
    <button ref={pop.ref} type="button" className="nc-history-count nodrag" aria-label={`Generation history: ${history.length} generations`} aria-expanded={pop.open} onClick={pop.toggle}>
      {index >= 0 ? index + 1 : history.length}/{history.length} <ChevronDown size={11} />
    </button>
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={240} label="Generation history">
      <PopoverHeader title="Generation history" />
      <div className="nc-history-list">
        {history.map((g, i) => <div key={g.id} className={`nc-history-entry ${g.id === current ? 'is-current' : ''}`}>
          <div className="nc-history-heading"><span>Generation {i + 1}{g.id === current ? ' · Current' : ''}</span><span>{g.status === 'running' || g.status === 'queued' ? 'Generating…' : g.status === 'done' ? '' : g.status}</span></div>
          {g.assetIds.length ? <div className="nc-history-outputs">{g.assetIds.map((id, outputIndex) => <HistoryOutput key={id} node={node} generation={g} assetId={id} index={outputIndex} number={i + 1} onOpen={pop.close} />)}</div> : <p>{g.text ?? g.error ?? g.statusText ?? 'No output yet'}</p>}
        </div>)}
      </div>
    </Popover>
  </>;
}

/** The asset a node currently shows (and passes downstream), plus its generation. */
function nodeOutput(node: GraphNode, generations: Record<string, Generation>) {
  const d = node.data;
  // A sketch replaces the result: it is what the card shows and what goes downstream.
  const sketch = 'sketchAssetId' in d ? d.sketchAssetId : undefined;
  if (d.kind === 'asset') return { g: undefined, assetId: sketch ?? d.assetId ?? undefined, all: d.assetId ? [d.assetId] : [], sketch };
  const g = runsGeneration(d) && d.generationId ? generations[d.generationId] : undefined;
  const all = g?.status === 'done' ? g.assetIds : [];
  const index = 'outputIndex' in d ? d.outputIndex : 0;
  return { g, assetId: sketch ?? (all[Math.min(index, all.length - 1)] as string | undefined), all, sketch };
}

export function useNodeOutput(node: GraphNode) {
  const d = node.data;
  const genId = runsGeneration(d) ? d.generationId : undefined;
  const g = useStore((s) => (genId ? s.generations[genId] : undefined));
  const detached = useStore((s) => Boolean(detachedOutputGroupFor(s.sessions[s.activeSessionId]?.graph.groups, node.id)));
  const output = nodeOutput(node, g && genId ? { [genId]: g } : {});
  return detached ? { ...output, all: output.assetId ? [output.assetId] : [] } : output;
}

/** Card content: the result first. Empty, running and error states keep the same footprint. */
function Preview({ node }: { node: GraphNode }) {
  const sessionId = useSessionId();
  const { g, assetId, all, sketch } = useNodeOutput(node);
  const d = node.data;
  const Icon = KIND_ICON[d.kind];
  if (g && (g.status === 'running' || g.status === 'queued')) {
    // Results arrive one request at a time (×3 = three requests): show each as soon as it is saved.
    if (g.assetIds.length) {
      return (
        <>
          <div className="nc-media">
            <AssetMedia assetId={g.assetIds[g.assetIds.length - 1]} draggable={false} />
            <AgentAttachToggle assetId={g.assetIds[g.assetIds.length - 1]} />
          </div>
          <span className="nc-badge"><LoaderCircle size={10} className="spin" /> {g.assetIds.length}/{Math.max(g.settings.count, g.assetIds.length)}</span>
        </>
      );
    }
    return (
      <div className="nc-empty is-pending">
        <div className="shimmer" />
        <span className="faint">{g.statusText ?? 'Working'}</span>
      </div>
    );
  }
  if (g?.status === 'error') return <div className="nc-empty nc-error">{g.error}</div>;
  // Transcribe: the text is the output (it can feed a Prompt port).
  if (g?.status === 'done' && g.kind === 'text') return <div className="nc-text">{g.text || <span className="faint">No speech was found.</span>}</div>;
  if (!assetId) {
    const hint = d.kind === 'image' || d.kind === 'video' || d.kind === 'audio' || d.kind === 'model3d' ? d.prompt : d.kind === 'asset' ? 'Drop an asset from the gallery' : d.kind === 'tool' ? OPS[d.op].description : '';
    return (
      <div className="nc-empty">
        <Icon size={18} />
        <span className="nc-hint">{hint || 'No output yet'}</span>
      </div>
    );
  }
  return (
    <>
      <div className="nc-media">
        <AssetMedia assetId={assetId} draggable={false} />
        <AgentAttachToggle assetId={assetId} />
      </div>
      {sketch ? (
        <span className="nc-badge" data-tip="Sketched · Reset image restores the original">
          <Brush size={10} /> Edited
        </span>
      ) : null}
      {all.length > 1 && d.kind !== 'asset' && !sketch ? (
        <div className="nc-strip nodrag">
          {all.map((id, i) => (
            <button key={id} type="button" className={id === assetId ? 'is-active' : ''} onClick={() => patchNodeData(sessionId, node.id, { outputIndex: i })} data-tip={`Use output ${i + 1} downstream`}>
              <AssetMedia assetId={id} hoverPlay draggable={false} />
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}

/** The tools that do not fit in the bar, plus Panorama (Reframe at 21:9). Each adds a connected tool node. */
function MoreTools({ node, out, skip }: { node: GraphNode; out: PortType; skip: OpId[] }) {
  const sessionId = useSessionId();
  const pop = usePopover();
  const add = (op: OpId, patch: Partial<ToolNodeData> = {}) => {
    pop.close();
    const data = newNodeData('tool', { op }) as ToolNodeData;
    addConnected(sessionId, node.id, { ...data, ...patch, params: { ...data.params, ...patch.params } });
  };
  const rest = OP_IDS.filter((id) => !OPS[id].multiInput && OPS[id].input === out && !skip.includes(id));
  return (
    <>
      <button ref={pop.ref} type="button" className={`nt-btn nt-icon nodrag ${pop.open ? 'is-open' : ''}`} aria-label="More tools" data-tip="More tools" onClick={pop.toggle}>
        <Ellipsis size={14} />
      </button>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={260} label="More tools">
        <div className="menu">
          {out === 'image' ? <MenuItem icon={RectangleHorizontal} label="Panorama" detail="Reframe to 21:9" onClick={() => add('reframe', { title: 'Panorama', params: { aspect: '21:9' } })} /> : null}
          {rest.map((id) => (
            <MenuItem key={id} icon={OP_ICONS[id]} label={OPS[id].label} tip={OPS[id].description} onClick={() => add(id)} />
          ))}
        </div>
      </Popover>
    </>
  );
}

/** Floating actions above the selected node: key tools, run, open, download, duplicate, delete and "…" (the Selection panel). Studio's board has no panel: quick tools, sketch and attach stay here instead. */
function NodeActions({ node, out, panel }: { node: GraphNode; out: PortType | null; panel?: boolean }) {
  const sessionId = useSessionId();
  const { assetId, all, sketch } = useNodeOutput(node);
  const runnable = runsGeneration(node.data);
  const detached = useStore((s) => detachedOutputGroupFor(s.sessions[sessionId]?.graph.groups, node.id));
  const quick = assetId && out && !panel ? OP_IDS.filter((id) => OPS[id].quick && OPS[id].input === out).slice(0, 4) : [];
  return (
    <div className="nt-bar">
      {panel && assetId && out ? <KeyTools sessionId={sessionId} node={node} out={out} /> : null}
      {runnable ? <RunButton node={node} /> : null}
      {detached ? <button type="button" className="nt-btn nodrag" onClick={() => reattachOutputs(sessionId, detached.id)}>Reattach outputs</button>
        : runnable && all.length > 1 && !sketch ? <button type="button" className="nt-btn nodrag" onClick={() => detachOutputs(sessionId, node.id)}>Detach outputs</button> : null}
      {quick.map((id) => {
        const QIcon = OP_ICONS[id];
        return (
          <button key={id} type="button" className="nt-btn nodrag" data-tip={`${OPS[id].description} (adds a connected node)`} onClick={() => addConnected(sessionId, node.id, newNodeData('tool', { op: id as OpId }))}>
            <QIcon size={13} /> {OPS[id].label}
          </button>
        );
      })}
      {assetId && out && !panel ? <MoreTools node={node} out={out} skip={quick} /> : null}
      {runnable || quick.length ? <span className="nt-sep" /> : null}
      {assetId ? (
        <>
          <button type="button" className="nt-btn nt-icon nodrag" aria-label="Open" data-tip="Open" onClick={() => setUi({ lightbox: { assetIds: all, index: Math.max(0, all.indexOf(assetId)) } })}>
            <Maximize2 size={14} />
          </button>
          {out === 'image' && !panel ? (
            <button type="button" className="nt-btn nodrag" data-tip="Paint over the image; the edited version is what goes downstream" onClick={() => setUi({ sketch: { assetId, nodeId: node.id } })}>
              <Brush size={13} /> Sketch
            </button>
          ) : null}
          {sketch ? (
            <button type="button" className="nt-btn nodrag" data-tip="Discard the sketch and use the original again" onClick={() => setSketch(sessionId, node.id, undefined)}>
              <RotateCcw size={13} /> Reset image
            </button>
          ) : null}
          {panel ? null : (
            <button type="button" className="nt-btn nt-icon nodrag" aria-label="Attach to prompt" data-tip="Attach to prompt" onClick={() => addAsReference(assetId)}>
              <Paperclip size={14} />
            </button>
          )}
          <button type="button" className="nt-btn nt-icon nodrag" aria-label="Download" data-tip="Download" onClick={() => void downloadAsset(assetId)}>
            <Download size={14} />
          </button>
        </>
      ) : null}
      <button type="button" className="nt-btn nt-icon nodrag" aria-label="Duplicate" data-tip="Duplicate" onClick={() => duplicateNode(sessionId, node)}>
        <Copy size={14} />
      </button>
      <DeleteButton node={node} />
      {panel && assetId ? <><span className="nt-sep" /><PanelToggle /></> : null}
    </div>
  );
}

/** Aspect of the card preview: the result's, else the requested aspect, clamped to sensible bounds. */
function previewRatio(node: GraphNode, a: Asset | undefined): number {
  const d = node.data;
  const r = a?.width && a.height ? a.width / a.height : d.kind === 'audio' ? 2 : d.kind === 'image' || d.kind === 'video' ? ratioOf(d.settings.aspect) ?? 4 / 3 : 4 / 3;
  return Math.min(2, Math.max(0.6, r));
}

/**
 * The node's name: plain text with its result's extension ("rosalinda_frente.png"); double-click to rename. Only
 * the name is edited — the extension is shown apart and always comes from the file, so it can never change.
 */
function NodeTitle({ sessionId, node }: { sessionId: string; node: GraphNode }) {
  const ext = useStore((s) => {
    const id = nodeOutputAsset(node, s.generations);
    const a = id ? s.assets[id] : undefined;
    return a ? extensionForMime(a.mime) : '';
  });
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft != null) renameNode(sessionId, node.id, draft);
    setDraft(null);
  };
  if (draft != null)
    return (
      <span className="nc-title-edit nodrag">
        <input
          autoFocus
          className="nc-title"
          value={draft}
          aria-label="Name"
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setDraft(null);
            e.stopPropagation();
          }}
        />
        {ext ? <span className="nc-ext">.{ext}</span> : null}
      </span>
    );
  return (
    <span className="nc-title nc-title-text" title="Double-click to rename" onDoubleClick={(e) => { e.stopPropagation(); setDraft(node.data.title); }}>
      {node.data.title}
      {ext ? <span className="nc-ext">.{ext}</span> : null}
    </span>
  );
}

/** Height of the floating title plus its gap above the card, in px at zoom 1. */
const TITLE_RISE = 21;

function CreativeNode({ data, selected }: NodeProps<FlowNode>) {
  const { node, solo, panel: inPanel } = data;
  const sessionId = useSessionId();
  const inputs = inputPorts(node.data);
  const out = useStore((s) => outputPort(node.data, s.assets));
  // Inputs already in use, and whether the model takes reference clips (only then the Video clip input exists).
  const wiredKey = useStore((s) => wiredTargetHandles(s.sessions[s.activeSessionId]?.graph.edges, node.id));
  const wired = useMemo(() => new Set(wiredKey ? wiredKey.split('|') : []), [wiredKey]);
  // While a connection is dragged every input shows, with its name.
  const connecting = useConnection((c) => c.inProgress);
  const clipModel = useStore((s) => ('modelRef' in node.data ? Boolean(s.catalog.schemas[node.data.modelRef]?.slots.clips) : false));
  const { assetId } = useNodeOutput(node);
  const previewAsset = useStore((s) => (assetId ? s.assets[assetId] : undefined));
  const d = node.data;
  const Icon = KIND_ICON[d.kind];
  const kindClass = d.kind === 'tool' ? `k-tool out-${OPS[(d as ToolNodeData).op].output}` : `k-${d.kind}`;
  const hasPanel = d.kind === 'image' || d.kind === 'video' || d.kind === 'audio' || d.kind === 'model3d' || d.kind === 'tool';
  const showTools = Boolean(selected) && solo;
  // The title floats above the card and scales with the zoom, the toolbar does not: clear the title, then a small fixed gap.
  // Only the selected node with a toolbar reads the zoom: the others do not re-render on every zoom tick.
  const toolbarOffset = useFlowStore((st) => (showTools ? Math.round(7 + TITLE_RISE * st.transform[2]) : 0));
  return (
    <>
      {showTools ? (
        <>
          <NodeToolbar isVisible position={Position.Top} offset={toolbarOffset}>
            <NodeActions node={node} out={out} panel={inPanel} />
          </NodeToolbar>
          {hasPanel ? (
            <NodeToolbar isVisible position={Position.Bottom} offset={12}>
              <div className="nt-panel">
                {d.kind === 'tool' ? <ToolNodeBody node={node as GraphNode & { data: ToolNodeData }} /> : <GenNodeBody node={node as GraphNode & { data: GenNodeData }} />}
              </div>
            </NodeToolbar>
          ) : null}
        </>
      ) : null}
      {inputs.filter((p) => p.id !== 'clip' || wired.has('clip') || clipModel).map((p, i, shown) => (
        // The prompt box already holds the prompt: its port shows only when connected or while connecting.
        <PortHandle key={p.id} id={p.id} type="target" side={Position.Left} top={`${((i + 1) / (shown.length + 1)) * 100}%`} label={connecting ? p.label : undefined} portType={p.type} quiet={p.id === 'prompt' && !wired.has('prompt') && !connecting} problem={data.missing?.find(n => n.port === p.id)?.message} />
      ))}
      {connecting ? <LinkHandles /> : null}
      <div className={`nc ${kindClass} ${selected ? 'is-selected' : ''}`}>
        <div className={`nc-label ${d.kind === 'text' ? 'nc-text-grip' : ''}`}>
          {d.kind === 'text' ? <GripVertical size={14} aria-hidden="true" /> : null}
          <Icon size={12} />
          <NodeTitle sessionId={sessionId} node={node} />
          <NodeHistory node={node} />
          <StatusPill node={node} />
        </div>
        {d.kind === 'text' ? (
          <textarea
            className="nc-text nodrag nowheel"
            value={d.text}
            placeholder="Prompt or copy…"
            onChange={(e) => patchNodeData(sessionId, node.id, { text: e.target.value })}
          />
        ) : d.kind === 'part' ? (
          <div className="nc-text">
            {d.partKind === 'color' ? <span className="nt-row"><span className="group-swatch" style={{ background: d.color }} />{d.color}</span>
              : d.partKind === 'style' ? (Object.entries(d.values ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n') || d.title) : d.title}
          </div>
        ) : (
          <div
            className="nc-body"
            style={{ aspectRatio: previewRatio(node, previewAsset) }}
            onDoubleClick={() => assetId && setUi({ lightbox: { assetIds: [assetId], index: 0 } })}
          >
            <Preview node={node} />
            <GenerationProgress node={node} />
          </div>
        )}
      </div>
      {out ? <><AddNext node={node} out={out} /><ResultPorts node={node} out={out} /></> : null}
    </>
  );
}

/** Creative and system nodes share this entry. */
export const StudioNode = memo(function StudioNode(props: NodeProps<FlowNode>) {
  const { noticeIn, noticeOut, node, missing } = props.data;
  const update = useUpdateNodeInternals();
  const geometry = missing?.map(n => n.port).join(',');
  useEffect(() => update(props.id), [update, props.id, noticeIn, noticeOut, geometry, node.data.kind]);
  return <>
    {node.data.kind === 'ref' ? <SystemNode {...props} /> : <CreativeNode {...props} />}
    <NoticeAnchors input={noticeIn} output={noticeOut} />
  </>;
});
