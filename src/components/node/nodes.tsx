import { memo, useEffect } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Box, ChevronDown, CircleAlert, Copy, Ellipsis, Film, Image as ImageIcon, LoaderCircle, Play, Trash, Type, Wand, FileImage, Check } from 'lucide-react';
import { OPS, OP_IDS, defaultOpParams } from '../../engine/ops';
import { aspectLabel, coerceSettings, durationChoices, paramByRole } from '../../engine/params';
import { ensureSchema, modelSummary } from '../../engine/catalog';
import { deleteNodes, patchNodeData, previewRun, runNodes, addNode } from '../../engine/flow/actions';
import { inputPorts, outputPort } from '../../engine/flow/graph';
import type { GenNodeData, GraphNode, GraphNodeData, OpId, PortType, ToolNodeData } from '../../engine/types';
import { setUi, useStore } from '../../store/store';
import { AssetMedia } from '../ui/AssetMedia';
import { Popover, PopoverHeader, usePopover } from '../ui/Popover';
import { Chip, MenuItem, Segmented } from '../ui/primitives';
import { SpendConfirm } from '../ui/SpendConfirm';
import { ModelList } from '../composer/ModelList';
import { OP_ICONS } from '../assets/AssetActions';

export type FlowNodeData = { node: GraphNode };
export type FlowNode = Node<FlowNodeData>;

const KIND_ICON = { text: Type, image: ImageIcon, video: Film, tool: Wand, asset: FileImage } as const;

function PortHandle({ id, type, side, top, label, portType }: { id: string; type: 'source' | 'target'; side: Position; top: number; label?: string; portType: PortType | null }) {
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

function NodeMenu({ node }: { node: GraphNode }) {
  const sessionId = useSessionId();
  const pop = usePopover();
  return (
    <>
      <button ref={pop.ref} type="button" className="node-icon-btn nodrag" aria-label="Node menu" onClick={pop.toggle}>
        <Ellipsis size={14} />
      </button>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={200} label="Node menu">
        <div className="menu">
          <MenuItem
            icon={Copy}
            label="Duplicate"
            onClick={() => {
              const data = { ...node.data } as GraphNodeData;
              if (data.kind === 'image' || data.kind === 'video' || data.kind === 'tool') delete (data as GenNodeData).generationId;
              addNode(sessionId, data, { x: node.position.x + 40, y: node.position.y + 40 });
              pop.close();
            }}
          />
          <MenuItem
            icon={Trash}
            label="Delete"
            danger
            onClick={() => {
              pop.close();
              deleteNodes(sessionId, [node.id]);
            }}
          />
        </div>
      </Popover>
    </>
  );
}

function RunButton({ node }: { node: GraphNode }) {
  const sessionId = useSessionId();
  const pop = usePopover();
  const preview = pop.open ? previewRun(sessionId, [node.id]) : null;
  return (
    <>
      <button ref={pop.ref} type="button" className={`node-run nodrag ${pop.open ? 'is-open' : ''}`} aria-label="Run node" data-tip="Run this node" onClick={pop.toggle}>
        <Play size={12} fill="currentColor" />
      </button>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={300} label="Run node">
        {preview ? (
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

function StatusPill({ generationId }: { generationId?: string }) {
  const g = useStore((s) => (generationId ? s.generations[generationId] : undefined));
  if (!g) return null;
  if (g.status === 'running' || g.status === 'queued')
    return (
      <span className="node-status is-running" data-tip={g.statusText}>
        <LoaderCircle size={12} className="spin" />
      </span>
    );
  if (g.status === 'error')
    return (
      <span className="node-status is-error" data-tip={g.error}>
        <CircleAlert size={12} />
      </span>
    );
  if (g.status === 'done')
    return (
      <span className="node-status is-done">
        <Check size={12} />
      </span>
    );
  return null;
}

function NodeFrame({ node, selected, children, run }: { node: GraphNode; selected: boolean; children: React.ReactNode; run?: boolean }) {
  const sessionId = useSessionId();
  const Icon = KIND_ICON[node.data.kind];
  const kindClass = node.data.kind === 'tool' ? `k-tool out-${OPS[(node.data as ToolNodeData).op].output}` : `k-${node.data.kind}`;
  const genId = node.data.kind === 'image' || node.data.kind === 'video' || node.data.kind === 'tool' ? node.data.generationId : undefined;
  return (
    <div className={`node-card ${kindClass} ${selected ? 'is-selected' : ''}`}>
      <div className="node-head">
        <span className="node-kind">
          <Icon size={13} />
        </span>
        <input className="node-title nodrag" value={node.data.title} onChange={(e) => patchNodeData(sessionId, node.id, { title: e.target.value })} aria-label="Node title" />
        <StatusPill generationId={genId} />
        {run ? <RunButton node={node} /> : null}
        <NodeMenu node={node} />
      </div>
      <div className="node-body">{children}</div>
    </div>
  );
}

function Outputs({ generationId, outputIndex, onPick }: { generationId?: string; outputIndex: number; onPick: (i: number) => void }) {
  const g = useStore((s) => (generationId ? s.generations[generationId] : undefined));
  if (!g) return <div className="node-empty-out faint">No output yet</div>;
  if (g.status === 'running' || g.status === 'queued') {
    return (
      <div className="node-out is-pending">
        <div className="shimmer" />
        <span className="faint">{g.statusText ?? 'Working'}</span>
      </div>
    );
  }
  if (g.status === 'error') return <div className="node-out-error">{g.error}</div>;
  if (!g.assetIds.length) return <div className="node-empty-out faint">No output</div>;
  const main = g.assetIds[Math.min(outputIndex, g.assetIds.length - 1)];
  return (
    <div className="node-out">
      <button type="button" className="node-out-main nodrag" onClick={() => setUi({ lightbox: { assetIds: g.assetIds, index: g.assetIds.indexOf(main) } })} aria-label="Open output">
        <AssetMedia assetId={main} />
      </button>
      {g.assetIds.length > 1 ? (
        <div className="node-out-strip nodrag">
          {g.assetIds.map((id, i) => (
            <button key={id} type="button" className={i === outputIndex ? 'is-active' : ''} onClick={() => onPick(i)} data-tip={`Use output ${i + 1} downstream`}>
              <AssetMedia assetId={id} hoverPlay={false} draggable={false} />
            </button>
          ))}
        </div>
      ) : null}
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

function GenNodeBody({ node }: { node: GraphNode & { data: GenNodeData } }) {
  const sessionId = useSessionId();
  const d = node.data;
  const schema = useStore((s) => s.catalog.schemas[d.modelRef]);
  const hasPromptEdge = useStore((s) => s.sessions[s.activeSessionId]?.graph.edges.some((e) => e.target === node.id && e.targetHandle === 'prompt'));
  const modelPop = usePopover();
  useEffect(() => {
    void ensureSchema(d.modelRef);
  }, [d.modelRef]);
  const name = modelSummary(d.modelRef)?.name ?? (d.modelRef.startsWith('local::') ? (d.kind === 'image' ? 'Local Sketch' : 'Local Motion') : d.modelRef.split('::')[1]);
  const aspect = paramByRole(schema, 'aspect');
  const res = paramByRole(schema, 'resolution');
  const durations = durationChoices(schema);
  const setSettings = (patch: Partial<GenNodeData['settings']>) => patchNodeData(sessionId, node.id, { settings: { ...d.settings, ...patch } });
  return (
    <>
      <Chip ref={modelPop.ref} icon={Box} active={modelPop.open} onClick={modelPop.toggle} className="nodrag model-chip wide-chip">
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
      <textarea
        className="node-textarea nodrag nowheel"
        rows={3}
        value={d.prompt}
        placeholder={hasPromptEdge ? 'Extra prompt (added after the connected text)' : d.kind === 'image' ? 'Describe the image…' : 'Describe the shot and motion…'}
        onChange={(e) => patchNodeData(sessionId, node.id, { prompt: e.target.value })}
      />
      <div className="node-params">
        {aspect?.options?.length ? <ParamSelect label="Aspect" value={d.settings.aspect} options={aspect.options} format={aspectLabel} onChange={(v) => setSettings({ aspect: v })} /> : null}
        {res?.options?.length ? <ParamSelect label="Resolution" value={d.settings.resolution} options={res.options} onChange={(v) => setSettings({ resolution: v })} /> : null}
        {d.kind === 'image' ? <ParamSelect label="Images" value={d.settings.count} options={[1, 2, 3, 4]} onChange={(v) => setSettings({ count: Number(v) })} /> : null}
        {d.kind === 'video' && durations.length ? <ParamSelect label="Duration" value={d.settings.duration} options={durations} format={(v) => `${v}s`} onChange={(v) => setSettings({ duration: Number(v) })} /> : null}
      </div>
      <Outputs generationId={d.generationId} outputIndex={d.outputIndex} onPick={(i) => patchNodeData(sessionId, node.id, { outputIndex: i })} />
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
      <Outputs generationId={d.generationId} outputIndex={d.outputIndex} onPick={(i) => patchNodeData(sessionId, node.id, { outputIndex: i })} />
    </>
  );
}

const HEAD = 46;
const PORT_GAP = 26;

function ports(node: GraphNode, assets: ReturnType<typeof useStore.getState>['assets']) {
  const inputs = inputPorts(node.data);
  const out = outputPort(node.data, assets);
  return { inputs, out };
}

export const StudioNode = memo(function StudioNode({ data, selected }: NodeProps<FlowNode>) {
  const node = data.node;
  const assets = useStore((s) => s.assets);
  const sessionId = useSessionId();
  const { inputs, out } = ports(node, assets);
  const d = node.data;
  let body: React.ReactNode = null;
  if (d.kind === 'text') {
    body = (
      <textarea
        className="node-textarea nodrag nowheel"
        rows={5}
        value={d.text}
        placeholder="Prompt or copy…"
        onChange={(e) => patchNodeData(sessionId, node.id, { text: e.target.value })}
      />
    );
  } else if (d.kind === 'asset') {
    body = d.assetId ? (
      <button type="button" className="node-out-main nodrag" onClick={() => setUi({ lightbox: { assetIds: [d.assetId!], index: 0 } })} aria-label="Open asset">
        <AssetMedia assetId={d.assetId} />
      </button>
    ) : (
      <div className="node-empty-out faint">Drop an asset from the gallery</div>
    );
  } else if (d.kind === 'tool') {
    body = <ToolNodeBody node={node as GraphNode & { data: ToolNodeData }} />;
  } else {
    body = <GenNodeBody node={node as GraphNode & { data: GenNodeData }} />;
  }
  return (
    <>
      {inputs.map((p, i) => (
        <PortHandle key={p.id} id={p.id} type="target" side={Position.Left} top={HEAD + i * PORT_GAP} label={p.label} portType={p.type} />
      ))}
      <NodeFrame node={node} selected={Boolean(selected)} run={d.kind === 'image' || d.kind === 'video' || d.kind === 'tool'}>
        {body}
      </NodeFrame>
      {out ? <PortHandle id="out" type="source" side={Position.Right} top={HEAD} portType={out} label={out} /> : null}
    </>
  );
});
