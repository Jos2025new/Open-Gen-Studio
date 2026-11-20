import { useEffect } from 'react';
import { Box, ChevronDown, Image as ImageIcon, Plus, SlidersHorizontal, X } from '../ui/icons';
import { OPS, OP_IDS } from '../../engine/ops';
import { aspectLabel, coerceSettings, durationChoices, durationLabel, lyricsParam, normalizeStructured, paramByRole, pixelSizes } from '../../engine/params';
import { ensureSchema, modelSummary } from '../../engine/catalog';
import { addNode, disconnectEdges, setNodeOp, patchNodeData, setNodeModel, tryConnect } from '../../engine/flow/actions';
import { cablePortProblem, inputPorts, NODE_WIDTH, nodeOutputAsset } from '../../engine/flow/graph';
import type { Asset, GenNodeData, Graph, GraphNode, OpId, ToolNodeData } from '../../engine/types';
import { setUi, useStore } from '../../store/store';
import { AssetMedia } from '../ui/AssetMedia';
import { Popover, PopoverHeader, usePopover } from '../ui/Popover';
import { Chip, MenuItem, Segmented, Toggle } from '../ui/primitives';
import { ModelList } from '../composer/ModelList';
import { AspectGlyph } from '../composer/MediaControls';
import { VideoUpscaleControls } from '../assets/VideoUpscaleControls';
import { OP_ICONS } from '../assets/AssetActions';
import { RunButton } from './NodeRunButton';

function useSessionId() {
  return useStore(s => s.activeSessionId);
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
  const linked = incomingDataCables(graph, node, assets)
    .filter((e) => ports.some((p) => p.id === e.targetHandle))
    .map((e) => {
      const src = graph.nodes.find((n) => n.id === e.source);
      const edited = !!src && 'sketchAssetId' in src.data && !!src.data.sketchAssetId;
      // The thumbnail shows what the link delivers: its own result (edge.outputIndex), as graphToSteps sends it.
      const assetId = src ? nodeOutputAsset(src, generations, e.outputIndex) ?? undefined : undefined;
      return { edge: e, assetId, edited, is3d: assetId ? assets[assetId]?.kind === 'model3d' : false, label: ports.find((p) => p.id === e.targetHandle)?.label };
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
        <span key={l.edge.id} className={`nt-ref ${l.edited ? 'is-edited' : ''}`} data-tip={l.assetId ? (l.is3d ? `${l.label} · 3D view image · click to open the model` : `${l.label}${l.edited ? ' · edited' : ''} · click to sketch over it`) : l.label}>
          {l.assetId ? (
            // A 3D source sends its view image; it opens in the 3D viewer (change the view there), not in Sketch.
            <button type="button" className="nt-ref-open" aria-label={l.is3d ? 'Open the 3D model' : 'Sketch over this reference'} onClick={() => setUi(l.is3d ? { lightbox: { assetIds: [l.assetId!], index: 0 } } : { sketch: { assetId: l.assetId!, nodeId: l.edge.source } })}>
              <AssetMedia assetId={l.assetId} hoverPlay draggable={false} />
            </button>
          ) : (
            <ImageIcon size={14} />
          )}
          <button
            type="button"
            className="nt-ref-x"
            aria-label="Disconnect"
            onClick={() => disconnectEdges(sessionId, [l.edge.id])}
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
              <AssetMedia assetId={a.id} hoverPlay draggable={false} />
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
  // Sizes given as exact pixels (Seedream): shown as a size tier plus a ratio, like other models.
  const px = pixelSizes(aspect?.options);
  const pxNow = px?.of(d.settings.aspect);
  // Audio models: their switches and choices (instrumental, write lyrics, mode, format).
  const options = d.kind === 'audio' ? (schema?.params ?? []).filter((p) => p.role === 'other' && (p.type === 'boolean' || (p.type === 'enum' && p.options?.length))) : [];
  const set = (patch: Partial<GenNodeData['settings']>) => patchNodeData(sessionId, node.id, { settings: { ...d.settings, ...patch } });
  const setOption = (key: string, v: string | boolean, def: unknown) => {
    const advanced = { ...d.settings.advanced };
    if (v === def) delete advanced[key];
    else advanced[key] = v;
    set({ advanced });
  };
  const summary = [res?.options?.length ? d.settings.resolution : null, d.kind === 'video' && durations.length ? durationLabel(d.settings.duration ?? durations[0]) : null].filter(Boolean);
  if (!aspect?.options?.length && !res?.options?.length && !durations.length && !audio && !options.length) return null;
  return (
    <>
      <Chip ref={pop.ref} active={pop.open} onClick={pop.toggle} className="nodrag nt-summary" data-tip="Settings">
        {summary.map((v) => (
          <span key={String(v)}>{v}</span>
        ))}
        {px && pxNow?.ratio ? (
          <span>
            {pxNow.tier} <AspectGlyph value={pxNow.ratio} /> {pxNow.ratio}
          </span>
        ) : aspect?.options?.length && d.settings.aspect ? (
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
                    {durationLabel(n)}
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          {px ? (
            <>
              {px.tiers.length > 1 ? (
                <section>
                  <h5>Resolution</h5>
                  <Segmented size="sm" value={pxNow?.tier ?? px.tiers[0]} options={px.tiers.map((t) => ({ value: t, label: t }))} onChange={(t) => set({ aspect: px.pick(t, pxNow?.ratio) })} />
                </section>
              ) : null}
              <section>
                <h5>Ratio</h5>
                <div className="nt-options">
                  {px.ratios.map((r) => (
                    <button key={r} type="button" className={`option ${r === pxNow?.ratio ? 'is-active' : ''}`} onClick={() => set({ aspect: px.pick(pxNow?.tier, r) })}>
                      <AspectGlyph value={r} /> {r}
                    </button>
                  ))}
                </div>
              </section>
            </>
          ) : aspect?.options?.length ? (
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
          {options.map((p) =>
            p.type === 'boolean' ? (
              <section key={p.key} className="nt-inline">
                <h5 data-tip={p.description}>{p.label}</h5>
                <Toggle checked={Boolean(d.settings.advanced[p.key] ?? p.default)} onChange={(v) => setOption(p.key, v, p.default ?? false)} label={p.label} />
              </section>
            ) : (
              <section key={p.key}>
                <h5 data-tip={p.description}>{p.label}</h5>
                <div className="nt-options">
                  {p.options!.map((o) => (
                    <button key={String(o)} type="button" className={`option ${String(o) === String(d.settings.advanced[p.key] ?? p.default) ? 'is-active' : ''}`} onClick={() => setOption(p.key, String(o), String(p.default))}>
                      {String(o).replace(/_/g, ' ')}
                    </button>
                  ))}
                </div>
              </section>
            ),
          )}
        </div>
      </Popover>
    </>
  );
}

function incomingDataCables(graph: Graph | undefined, node: GraphNode, assets: Record<string, Asset>) {
  return graph?.edges.filter(e => {
    if (e.target !== node.id || (e.kind ?? 'data') !== 'data') return false;
    const source = graph.nodes.find(n => n.id === e.source);
    return source && !cablePortProblem(source, node, assets, e);
  }) ?? [];
}

/** Prompt card under the selected node: inputs, prompt, then model · settings · count · run. */
export function GenNodeBody({ node }: { node: GraphNode & { data: GenNodeData } }) {
  const sessionId = useSessionId();
  const d = node.data;
  const linkedPorts = useStore(s => incomingDataCables(s.sessions[sessionId]?.graph, node, s.assets).map(e => e.targetHandle).join('|'));
  const hasPromptEdge = linkedPorts.split('|').includes('prompt');
  const hasLyricsEdge = linkedPorts.split('|').includes('lyrics');
  const lyrics = lyricsParam(useStore((s) => s.catalog.schemas[d.modelRef]));
  const modelPop = usePopover();
  useEffect(() => {
    if (d.modelRef) void ensureSchema(d.modelRef);
  }, [d.modelRef]);
  const name = !d.modelRef ? 'No audio model' : modelSummary(d.modelRef)?.name ?? (d.modelRef.startsWith('local::') ? (d.kind === 'image' ? 'Local Sketch' : 'Local Motion') : d.modelRef.split('::')[1]);
  const setLyrics = (text: string) => {
    if (!lyrics) return;
    const extras = { ...d.settings.extras };
    const v = normalizeStructured(lyrics, text);
    if (v === undefined) delete extras[lyrics.key];
    else extras[lyrics.key] = v;
    patchNodeData(sessionId, node.id, { settings: { ...d.settings, extras: Object.keys(extras).length ? extras : undefined } });
  };
  return (
    <>
      <InputRefs node={node} />
      <textarea
        className="nt-prompt nodrag nowheel"
        rows={3}
        value={d.prompt}
        placeholder={
          hasPromptEdge ? 'Extra prompt (added after the connected text)' : d.kind === 'image' ? 'Describe the image…' : d.kind === 'model3d' ? 'Describe the model…' : d.kind === 'audio' ? 'Describe the music (or the song theme)…' : 'Describe the shot and motion…'
        }
        onChange={(e) => patchNodeData(sessionId, node.id, { prompt: e.target.value })}
      />
      {lyrics && !hasLyricsEdge ? (
        <textarea
          className="nt-prompt nt-lyrics nodrag nowheel"
          rows={4}
          value={typeof d.settings.extras?.[lyrics.key] === 'string' ? (d.settings.extras[lyrics.key] as string) : ''}
          placeholder={'Lyrics (or connect a text or lyrics node)\n[Verse]\n…'}
          onChange={(e) => setLyrics(e.target.value)}
          aria-label="Lyrics"
        />
      ) : null}
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
              const { settings } = coerceSettings(sch ?? undefined, d.kind, { ...d.settings, audio: undefined, advanced: {} });
              setNodeModel(sessionId, node.id, { modelRef: ref, settings });
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

export function ToolNodeBody({ node }: { node: GraphNode & { data: ToolNodeData } }) {
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
          {OP_IDS.filter((id) => !OPS[id].multiInput).map((id) => (
            <MenuItem
              key={id}
              icon={OP_ICONS[id]}
              label={OPS[id].label}
              detail={`${OPS[id].input} → ${OPS[id].output}`}
              active={id === d.op}
              onClick={() => {
                opPop.close();
                setNodeOp(sessionId, node.id, id as OpId);
              }}
            />
          ))}
        </div>
      </Popover>
      {d.op === 'video_upscale' || d.op === 'video_edit' || d.op === 'video_extend' || d.op === 'continue' ? <VideoUpscaleControls engine={d.op === 'continue' ? 'video' : d.op} params={d.params} onChange={params => patchNodeData(sessionId, node.id, { params })} /> : null}
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

