import { memo, useEffect, useState } from 'react';
import { Handle, NodeToolbar, Position, type Node, type NodeProps } from '@xyflow/react';
import { Box, Brush, ChevronDown, ChevronRight, CircleAlert, Copy, Download, Film, Image as ImageIcon, LoaderCircle, Maximize2, Play, Plus, SlidersHorizontal, Trash, Type, Wand, FileImage, Check, X } from 'lucide-react';
import { OPS, OP_IDS, defaultOpParams } from '../../engine/ops';
import { aspectLabel, coerceSettings, durationChoices, paramByRole, ratioOf } from '../../engine/params';
import { ensureSchema, modelSummary } from '../../engine/catalog';
import { addConnected, addNode, deleteNodes, duplicateNode, newNodeData, patchNodeData, previewRun, runNodes, tryConnect } from '../../engine/flow/actions';
import { inputPorts, NODE_WIDTH, outputPort } from '../../engine/flow/graph';
import { downloadAsset } from '../../engine/actions';
import type { Generation, GenNodeData, GraphNode, GraphNodeData, OpId, PortType, ToolNodeData } from '../../engine/types';
import { setGraph, setUi, useStore } from '../../store/store';
import { AssetMedia } from '../ui/AssetMedia';
import { Popover, PopoverHeader, usePopover } from '../ui/Popover';
import { Button, Chip, costLabel, MenuItem, Segmented, Toggle } from '../ui/primitives';
import { SpendConfirm } from '../ui/SpendConfirm';
import { ModelList } from '../composer/ModelList';
import { AspectGlyph } from '../composer/MediaControls';
import { OP_ICONS } from '../assets/AssetActions';

/** `solo`: this node is the only selected one, so its toolbar and settings panel show. */
export type FlowNodeData = { node: GraphNode; solo: boolean };
export type FlowNode = Node<FlowNodeData>;

const KIND_ICON = { text: Type, image: ImageIcon, video: Film, tool: Wand, asset: FileImage } as const;

function PortHandle({ id, type, side, top, label, portType }: { id: string; type: 'source' | 'target'; side: Position; top: string; label?: string; portType: PortType | null }) {
  return (
    <>
      <Handle id={id} type={type} position={side} className={`port port-${portType ?? 'none'}`} style={{ top }} />
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

/** Node kinds (and tools) to add; with `accepts`, only those that take that port type as input. */
export function AddNodeItems({ accepts, onPick, onAsset }: { accepts?: PortType | null; onPick: (data: GraphNodeData) => void; onAsset?: () => void }) {
  const [tools, setTools] = useState(false);
  const takes = (kind: 'image' | 'video') => !accepts || inputPorts(newNodeData(kind)).some((p) => p.type === accepts);
  const toolIds = OP_IDS.filter((id) => !accepts || OPS[id].input === accepts);
  if (tools) {
    return (
      <div className="menu">
        <button type="button" className="menu-back" onClick={() => setTools(false)}>
          ‹ Tools
        </button>
        {toolIds.map((id) => (
          <MenuItem key={id} icon={OP_ICONS[id]} label={OPS[id].label} detail={`${OPS[id].input} → ${OPS[id].output}`} onClick={() => onPick(newNodeData('tool', { op: id as OpId }))} />
        ))}
      </div>
    );
  }
  return (
    <div className="menu">
      {!accepts ? <MenuItem icon={Type} label="Text" detail="Prompt or copy that feeds other nodes" onClick={() => onPick(newNodeData('text'))} /> : null}
      {takes('image') ? <MenuItem icon={ImageIcon} label="Image" detail={accepts === 'image' ? 'Use it as a reference' : 'Generate images'} onClick={() => onPick(newNodeData('image'))} /> : null}
      {takes('video') ? <MenuItem icon={Film} label="Video" detail={accepts === 'image' ? 'Use it as the first frame' : 'Generate video'} onClick={() => onPick(newNodeData('video'))} /> : null}
      {toolIds.length ? <MenuItem icon={Wand} label="Tool" detail="Relight, angle, upscale, animate…" right={<ChevronRight size={14} />} onClick={() => setTools(true)} /> : null}
      {onAsset ? <MenuItem icon={FileImage} label="Asset" detail="Drag one from the gallery onto the canvas" onClick={onAsset} /> : null}
    </div>
  );
}

/** Run with spend confirmation. `primary` is the panel's big button and shows the estimated cost. */
function RunButton({ node, primary }: { node: GraphNode; primary?: boolean }) {
  const sessionId = useSessionId();
  const pop = usePopover();
  const preview = pop.open || primary ? previewRun(sessionId, [node.id]) : null;
  return (
    <>
      <button ref={pop.ref} type="button" className={`${primary ? 'nt-go' : 'nt-btn nt-run'} nodrag ${pop.open ? 'is-open' : ''}`} aria-label="Run node" onClick={pop.toggle}>
        <Play size={12} fill="currentColor" /> {primary && preview ? costLabel(preview.estimate, { short: true }) : 'Run'}
      </button>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={300} label="Run node">
        {pop.open && preview ? (
          <SpendConfirm
            title={preview.count > 1 ? `Run ${preview.count} nodes` : `Run “${node.data.title}”`}
            lines={preview.count > 1 ? ['Includes upstream nodes without output'] : undefined}
            estimate={preview.estimate}
            blocked={preview.errors[0] ?? null}
            onCancel={pop.close}
            onConfirm={() => {
              pop.close();
              void runNodes(sessionId, [node.id]);
            }}
          />
        ) : null}
      </Popover>
    </>
  );
}

function DeleteButton({ node }: { node: GraphNode }) {
  const sessionId = useSessionId();
  const pop = usePopover();
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
                deleteNodes(sessionId, [node.id]);
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

function StatusPill({ generationId }: { generationId?: string }) {
  const g = useStore((s) => (generationId ? s.generations[generationId] : undefined));
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

/** The asset a node currently shows (and passes downstream), plus its generation. */
function nodeOutput(node: GraphNode, generations: Record<string, Generation>) {
  const d = node.data;
  if (d.kind === 'asset') return { g: undefined, assetId: d.assetId ?? undefined, all: d.assetId ? [d.assetId] : [] };
  const g = (d.kind === 'image' || d.kind === 'video' || d.kind === 'tool') && d.generationId ? generations[d.generationId] : undefined;
  const all = g?.status === 'done' ? g.assetIds : [];
  const index = d.kind === 'text' ? 0 : d.outputIndex;
  return { g, assetId: all[Math.min(index, all.length - 1)] as string | undefined, all };
}

function useNodeOutput(node: GraphNode) {
  const d = node.data;
  const genId = d.kind === 'image' || d.kind === 'video' || d.kind === 'tool' ? d.generationId : undefined;
  const g = useStore((s) => (genId ? s.generations[genId] : undefined));
  return nodeOutput(node, g && genId ? { [genId]: g } : {});
}

/** Card content: the result first. Empty, running and error states keep the same footprint. */
function Preview({ node }: { node: GraphNode }) {
  const sessionId = useSessionId();
  const { g, assetId, all } = useNodeOutput(node);
  const d = node.data;
  const Icon = KIND_ICON[d.kind];
  if (g && (g.status === 'running' || g.status === 'queued')) {
    return (
      <div className="nc-empty is-pending">
        <div className="shimmer" />
        <span className="faint">{g.statusText ?? 'Working'}</span>
      </div>
    );
  }
  if (g?.status === 'error') return <div className="nc-empty nc-error">{g.error}</div>;
  if (!assetId) {
    const hint = d.kind === 'image' || d.kind === 'video' ? d.prompt : d.kind === 'asset' ? 'Drop an asset from the gallery' : d.kind === 'tool' ? OPS[d.op].description : '';
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
      </div>
      {all.length > 1 && d.kind !== 'asset' ? (
        <div className="nc-strip nodrag">
          {all.map((id, i) => (
            <button key={id} type="button" className={id === assetId ? 'is-active' : ''} onClick={() => patchNodeData(sessionId, node.id, { outputIndex: i })} data-tip={`Use output ${i + 1} downstream`}>
              <AssetMedia assetId={id} hoverPlay={false} draggable={false} />
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}

/** "+" next to the output port: add a node that takes this output, already connected. */
function AddNext({ node, out }: { node: GraphNode; out: PortType }) {
  const sessionId = useSessionId();
  const pop = usePopover();
  return (
    <>
      <button ref={pop.ref} type="button" className="nc-next nodrag" aria-label="Add connected node" data-tip="Add a connected node" onClick={pop.toggle}>
        <Plus size={13} />
      </button>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={250} label="Add connected node">
        <AddNodeItems
          accepts={out}
          onPick={(data) => {
            pop.close();
            addConnected(sessionId, node.id, data);
          }}
        />
      </Popover>
    </>
  );
}

/** Floating actions above the selected node: run, quick tools on its result, open, download, duplicate, delete. */
function NodeActions({ node, out }: { node: GraphNode; out: PortType | null }) {
  const sessionId = useSessionId();
  const { assetId, all } = useNodeOutput(node);
  const runnable = node.data.kind === 'image' || node.data.kind === 'video' || node.data.kind === 'tool';
  const quick = assetId && out ? OP_IDS.filter((id) => OPS[id].quick && OPS[id].input === out).slice(0, 4) : [];
  return (
    <div className="nt-bar">
      {runnable ? <RunButton node={node} /> : null}
      {quick.map((id) => {
        const QIcon = OP_ICONS[id];
        return (
          <button key={id} type="button" className="nt-btn nodrag" data-tip={`${OPS[id].description} (adds a connected node)`} onClick={() => addConnected(sessionId, node.id, newNodeData('tool', { op: id as OpId }))}>
            <QIcon size={13} /> {OPS[id].label}
          </button>
        );
      })}
      {runnable || quick.length ? <span className="nt-sep" /> : null}
      {assetId ? (
        <>
          <button type="button" className="nt-btn nt-icon nodrag" aria-label="Open" data-tip="Open" onClick={() => setUi({ lightbox: { assetIds: all, index: Math.max(0, all.indexOf(assetId)) } })}>
            <Maximize2 size={14} />
          </button>
          {out === 'image' ? (
            <button type="button" className="nt-btn nodrag" data-tip="Paint over the image; saves a new copy" onClick={() => setUi({ sketch: { assetId, nodeId: node.id } })}>
              <Brush size={13} /> Sketch
            </button>
          ) : null}
          <button type="button" className="nt-btn nt-icon nodrag" aria-label="Download" data-tip="Download" onClick={() => void downloadAsset(assetId)}>
            <Download size={14} />
          </button>
        </>
      ) : null}
      <button type="button" className="nt-btn nt-icon nodrag" aria-label="Duplicate" data-tip="Duplicate" onClick={() => duplicateNode(sessionId, node)}>
        <Copy size={14} />
      </button>
      <DeleteButton node={node} />
    </div>
  );
}

function ParamSelect({ label, value, options, format, onChange }: { label: string; value: string | number | undefined; options: Array<string | number>; format?: (v: string) => string; onChange: (v: string) => void }) {
  const pop = usePopover();
  const fmt = format ?? ((v: string) => v);
  return (
    <>
      <Chip ref={pop.ref} active={pop.open} onClick={pop.toggle} className="nodrag mini-chip" data-tip={label}>
        {value != null ? fmt(String(value)) : label}
      </Chip>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={220} label={label}>
        <PopoverHeader title={label} />
        <div className="option-list">
          {options.map((o) => (
            <button
              key={String(o)}
              type="button"
              className={`option ${String(o) === String(value) ? 'is-active' : ''}`}
              onClick={() => {
                onChange(String(o));
                pop.close();
              }}
            >
              {fmt(String(o))}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}

/** Image inputs as thumbnails (connected nodes) plus "Ref", which adds a gallery image as a connected asset node. */
function InputRefs({ node }: { node: GraphNode }) {
  const sessionId = useSessionId();
  const graph = useStore((s) => s.sessions[s.activeSessionId].graph);
  const generations = useStore((s) => s.generations);
  const assets = useStore((s) => s.assets);
  const pop = usePopover();
  const ports = inputPorts(node.data).filter((p) => p.type === 'image');
  if (!ports.length) return null;
  const linked = graph.edges
    .filter((e) => e.target === node.id && ports.some((p) => p.id === e.targetHandle))
    .map((e) => {
      const src = graph.nodes.find((n) => n.id === e.source);
      return { edge: e, assetId: src ? nodeOutput(src, generations).assetId : undefined, label: ports.find((p) => p.id === e.targetHandle)?.label };
    });
  const free = ports.find((p) => p.multi || !linked.some((l) => l.edge.targetHandle === p.id));
  const recent = Object.values(assets)
    .filter((a) => a.kind === 'image')
    .sort((x, y) => y.createdAt - x.createdAt)
    .slice(0, 12);
  const add = (assetId: string) => {
    pop.close();
    if (!free) return;
    const id = addNode(sessionId, { kind: 'asset', title: 'Reference', assetId }, { x: node.position.x - NODE_WIDTH - 100, y: node.position.y + linked.length * 70 });
    tryConnect(sessionId, { source: id, target: node.id, targetHandle: free.id });
  };
  return (
    <div className="nt-refs">
      {linked.map((l) => (
        <span key={l.edge.id} className="nt-ref" data-tip={l.assetId ? `${l.label} · click to sketch over it` : l.label}>
          {l.assetId ? (
            <button type="button" className="nt-ref-open" aria-label="Sketch over this reference" onClick={() => setUi({ sketch: { assetId: l.assetId!, edgeId: l.edge.id } })}>
              <AssetMedia assetId={l.assetId} hoverPlay={false} draggable={false} />
            </button>
          ) : (
            <ImageIcon size={14} />
          )}
          <button
            type="button"
            className="nt-ref-x"
            aria-label="Disconnect"
            onClick={() => setGraph(sessionId, (g) => ({ ...g, edges: g.edges.filter((e) => e.id !== l.edge.id) }))}
          >
            <X size={10} />
          </button>
        </span>
      ))}
      {free ? (
        <button ref={pop.ref} type="button" className="nt-ref nt-ref-add" onClick={pop.toggle} data-tip={`Add ${free.label.toLowerCase()} from the gallery`}>
          <Plus size={13} />
          <span>Ref</span>
        </button>
      ) : null}
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={300} label="Add reference">
        <PopoverHeader title={free?.label ?? 'Reference'} sub={recent.length ? 'Pick an image; it is added as a connected node.' : 'Generate or upload an image first.'} />
        <div className="nt-pick">
          {recent.map((a) => (
            <button key={a.id} type="button" onClick={() => add(a.id)}>
              <AssetMedia assetId={a.id} hoverPlay={false} draggable={false} />
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}

/** One popover with every generation setting the model's schema exposes. */
function SettingsChip({ node }: { node: GraphNode & { data: GenNodeData } }) {
  const sessionId = useSessionId();
  const d = node.data;
  const schema = useStore((s) => s.catalog.schemas[d.modelRef]);
  const pop = usePopover();
  const aspect = paramByRole(schema, 'aspect');
  const res = paramByRole(schema, 'resolution');
  const audio = paramByRole(schema, 'audio');
  const durations = durationChoices(schema);
  const set = (patch: Partial<GenNodeData['settings']>) => patchNodeData(sessionId, node.id, { settings: { ...d.settings, ...patch } });
  const summary = [res?.options?.length ? d.settings.resolution : null, d.kind === 'video' && durations.length ? `${d.settings.duration ?? durations[0]}s` : null].filter(Boolean);
  if (!aspect?.options?.length && !res?.options?.length && !durations.length && !audio) return null;
  return (
    <>
      <Chip ref={pop.ref} active={pop.open} onClick={pop.toggle} className="nodrag nt-summary" data-tip="Settings">
        {summary.map((v) => (
          <span key={String(v)}>{v}</span>
        ))}
        {aspect?.options?.length && d.settings.aspect ? (
          <span>
            <AspectGlyph value={d.settings.aspect} /> {aspectLabel(d.settings.aspect)}
          </span>
        ) : null}
        {!summary.length && !d.settings.aspect ? <SlidersHorizontal size={13} /> : null}
      </Chip>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={340} label="Settings">
        <div className="nt-settings">
          {res?.options?.length ? (
            <section>
              <h5>Resolution</h5>
              <Segmented size="sm" value={String(d.settings.resolution ?? res.options[0])} options={res.options.map((o) => ({ value: String(o), label: String(o) }))} onChange={(v) => set({ resolution: v })} />
            </section>
          ) : null}
          {d.kind === 'video' && durations.length ? (
            <section>
              <h5>Length</h5>
              <div className="nt-options">
                {durations.map((n) => (
                  <button key={n} type="button" className={`option ${n === d.settings.duration ? 'is-active' : ''}`} onClick={() => set({ duration: n })}>
                    {n}s
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          {aspect?.options?.length ? (
            <section>
              <h5>Ratio</h5>
              <div className="nt-options">
                {aspect.options.map((o) => {
                  const v = String(o);
                  return (
                    <button key={v} type="button" className={`option ${v === d.settings.aspect ? 'is-active' : ''}`} onClick={() => set({ aspect: v })}>
                      <AspectGlyph value={v} /> {aspectLabel(v)}
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}
          {audio ? (
            <section className="nt-inline">
              <h5>Audio</h5>
              <Toggle checked={Boolean(d.settings.audio)} onChange={(v) => set({ audio: v })} label="Generate audio" />
            </section>
          ) : null}
        </div>
      </Popover>
    </>
  );
}

/** Prompt card under the selected node: inputs, prompt, then model · settings · count · run. */
function GenNodeBody({ node }: { node: GraphNode & { data: GenNodeData } }) {
  const sessionId = useSessionId();
  const d = node.data;
  const hasPromptEdge = useStore((s) => s.sessions[s.activeSessionId]?.graph.edges.some((e) => e.target === node.id && e.targetHandle === 'prompt'));
  const modelPop = usePopover();
  useEffect(() => {
    void ensureSchema(d.modelRef);
  }, [d.modelRef]);
  const name = modelSummary(d.modelRef)?.name ?? (d.modelRef.startsWith('local::') ? (d.kind === 'image' ? 'Local Sketch' : 'Local Motion') : d.modelRef.split('::')[1]);
  return (
    <>
      <InputRefs node={node} />
      <textarea
        className="nt-prompt nodrag nowheel"
        rows={3}
        value={d.prompt}
        placeholder={hasPromptEdge ? 'Extra prompt (added after the connected text)' : d.kind === 'image' ? 'Describe the image…' : 'Describe the shot and motion…'}
        onChange={(e) => patchNodeData(sessionId, node.id, { prompt: e.target.value })}
      />
      <div className="nt-row">
        <Chip ref={modelPop.ref} icon={Box} active={modelPop.open} onClick={modelPop.toggle} className="nodrag nt-model">
          <span className="truncate">{name}</span>
          <ChevronDown size={12} />
        </Chip>
        <Popover open={modelPop.open} anchor={modelPop.ref} onClose={modelPop.close} width={420} label="Model">
          <ModelList
            kind={d.kind}
            value={d.modelRef}
            onSelect={async (ref) => {
              modelPop.close();
              if (!ref) return;
              const sch = await ensureSchema(ref);
              const { settings } = coerceSettings(sch ?? undefined, d.kind, { ...d.settings, advanced: {} });
              patchNodeData(sessionId, node.id, { modelRef: ref, settings });
            }}
          />
        </Popover>
        <SettingsChip node={node} />
        <span className="spacer" />
        {d.kind === 'image' ? (
          <ParamSelect label="Images" value={d.settings.count} options={[1, 2, 3, 4]} format={(v) => `${v}×`} onChange={(v) => patchNodeData(sessionId, node.id, { settings: { ...d.settings, count: Number(v) } })} />
        ) : null}
        <RunButton node={node} primary />
      </div>
    </>
  );
}

function ToolNodeBody({ node }: { node: GraphNode & { data: ToolNodeData } }) {
  const sessionId = useSessionId();
  const d = node.data;
  const def = OPS[d.op];
  const opPop = usePopover();
  const Icon = OP_ICONS[d.op];
  return (
    <>
      <Chip ref={opPop.ref} icon={Icon} active={opPop.open} onClick={opPop.toggle} className="nodrag wide-chip">
        <span className="truncate">{def.label}</span>
        <ChevronDown size={12} />
      </Chip>
      <Popover open={opPop.open} anchor={opPop.ref} onClose={opPop.close} width={260} label="Operation">
        <div className="menu">
          {OP_IDS.map((id) => (
            <MenuItem
              key={id}
              icon={OP_ICONS[id]}
              label={OPS[id].label}
              detail={`${OPS[id].input} → ${OPS[id].output}`}
              active={id === d.op}
              onClick={() => {
                opPop.close();
                patchNodeData(sessionId, node.id, { op: id as OpId, params: defaultOpParams(OPS[id]), title: OPS[id].label, generationId: undefined });
                // Edges into the input may no longer match the new input type.
                useStore.setState((st) => {
                  const s = st.sessions[sessionId];
                  const edges = s.graph.edges.filter((e) => {
                    if (e.target === node.id && e.targetHandle === 'input') {
                      const src = s.graph.nodes.find((n) => n.id === e.source);
                      return src ? outputPort(src.data, st.assets) === OPS[id].input : false;
                    }
                    if (e.source === node.id) {
                      const tgt = s.graph.nodes.find((n) => n.id === e.target);
                      const port = tgt ? inputPorts(tgt.data).find((p) => p.id === e.targetHandle) : undefined;
                      return port?.type === OPS[id].output;
                    }
                    return true;
                  });
                  return { sessions: { ...st.sessions, [sessionId]: { ...s, graph: { ...s.graph, edges } } } };
                });
              }}
            />
          ))}
        </div>
      </Popover>
      {def.fields.map((f) =>
        f.type === 'choice' ? (
          <div key={f.key} className="node-field nodrag">
            <span className="field-label">{f.label}</span>
            {(f.options?.length ?? 0) <= 3 ? (
              <Segmented
                size="sm"
                value={String(d.params[f.key] ?? f.default)}
                options={f.options!.map((o) => ({ value: o.value, label: o.label }))}
                onChange={(v) => patchNodeData(sessionId, node.id, { params: { ...d.params, [f.key]: v } })}
              />
            ) : (
              <ParamSelect
                label={f.label}
                value={String(d.params[f.key] ?? f.default)}
                options={f.options!.map((o) => o.value)}
                format={(v) => f.options!.find((o) => o.value === v)?.label ?? v}
                onChange={(v) => patchNodeData(sessionId, node.id, { params: { ...d.params, [f.key]: v } })}
              />
            )}
          </div>
        ) : (
          <textarea
            key={f.key}
            className="node-textarea nodrag nowheel"
            rows={2}
            value={String(d.params[f.key] ?? '')}
            placeholder={f.placeholder ?? f.label}
            onChange={(e) => patchNodeData(sessionId, node.id, { params: { ...d.params, [f.key]: e.target.value } })}
          />
        ),
      )}
      <div className="nt-row">
        <span className="spacer" />
        <RunButton node={node} primary />
      </div>
    </>
  );
}

/** Aspect of the card preview: the result's, else the requested aspect, clamped to sensible bounds. */
function previewRatio(node: GraphNode, assetId: string | undefined, assets: ReturnType<typeof useStore.getState>['assets']): number {
  const a = assetId ? assets[assetId] : undefined;
  const d = node.data;
  const r = a?.width && a.height ? a.width / a.height : d.kind === 'image' || d.kind === 'video' ? ratioOf(d.settings.aspect) ?? 4 / 3 : 4 / 3;
  return Math.min(2, Math.max(0.6, r));
}

export const StudioNode = memo(function StudioNode({ data, selected }: NodeProps<FlowNode>) {
  const { node, solo } = data;
  const assets = useStore((s) => s.assets);
  const sessionId = useSessionId();
  const inputs = inputPorts(node.data);
  const out = outputPort(node.data, assets);
  const { assetId } = useNodeOutput(node);
  const d = node.data;
  const Icon = KIND_ICON[d.kind];
  const genId = d.kind === 'image' || d.kind === 'video' || d.kind === 'tool' ? d.generationId : undefined;
  const kindClass = d.kind === 'tool' ? `k-tool out-${OPS[(d as ToolNodeData).op].output}` : `k-${d.kind}`;
  const panel = d.kind === 'image' || d.kind === 'video' ? <GenNodeBody node={node as GraphNode & { data: GenNodeData }} /> : d.kind === 'tool' ? <ToolNodeBody node={node as GraphNode & { data: ToolNodeData }} /> : null;
  const showTools = Boolean(selected) && solo;
  return (
    <>
      <NodeToolbar isVisible={showTools} position={Position.Top} offset={34}>
        <NodeActions node={node} out={out} />
      </NodeToolbar>
      {panel ? (
        <NodeToolbar isVisible={showTools} position={Position.Bottom} offset={12}>
          <div className="nt-panel">{panel}</div>
        </NodeToolbar>
      ) : null}
      {inputs.map((p, i) => (
        <PortHandle key={p.id} id={p.id} type="target" side={Position.Left} top={`${((i + 1) / (inputs.length + 1)) * 100}%`} label={p.label} portType={p.type} />
      ))}
      <div className={`nc ${kindClass} ${selected ? 'is-selected' : ''}`}>
        <div className="nc-label">
          <Icon size={12} />
          <input className="nc-title nodrag" value={d.title} onChange={(e) => patchNodeData(sessionId, node.id, { title: e.target.value })} aria-label="Node title" />
          <StatusPill generationId={genId} />
        </div>
        {d.kind === 'text' ? (
          <textarea
            className="nc-text nodrag nowheel"
            value={d.text}
            placeholder="Prompt or copy…"
            onChange={(e) => patchNodeData(sessionId, node.id, { text: e.target.value })}
          />
        ) : (
          <div
            className="nc-body"
            style={{ aspectRatio: previewRatio(node, assetId, assets) }}
            onDoubleClick={() => assetId && setUi({ lightbox: { assetIds: [assetId], index: 0 } })}
          >
            <Preview node={node} />
          </div>
        )}
      </div>
      {out ? <PortHandle id="out" type="source" side={Position.Right} top="50%" portType={out} label={out} /> : null}
      {out ? <AddNext node={node} out={out} /> : null}
    </>
  );
});
