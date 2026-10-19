import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { opFollowsSource } from '../../engine/catalog';
import { OPS, defaultOpParams } from '../../engine/ops';
import { layerOpEstimate, opEstimate, runAssetOp, runLayerOp } from '../../engine/actions';
import type { AdvancedValue, Estimate, OpId } from '../../engine/types';
import type { ToolSeed } from '../../store/spaceUi';
import { useStore } from '../../store/store';
import { ModelList } from '../composer/ModelList';
import { Popover, usePopover } from '../ui/Popover';
import { Segmented } from '../ui/primitives';
import { VideoUpscaleControls } from './VideoUpscaleControls';

export type OpTarget = { kind: 'asset'; assetId: string; parentId?: string } | { kind: 'layer'; sessionId: string; docId: string; layerId: string };

const CALCULATING: Estimate = { usd: null, approximate: true, note: 'Calculating…' };

/** The state of one operation run: its fields, the cost check and the launch. Shared by the op popover and the Tools space. */
export function useOpRun(op: OpId, targetProp: OpTarget | null, seed?: ToolSeed) {
  const def = OPS[op];
  // Callers pass a fresh object each render; key the estimate on its value.
  const targetKey = JSON.stringify(targetProp);
  const target = useMemo(() => targetProp, [targetKey]);
  const [params, setParams] = useState<Record<string, AdvancedValue>>(() => defaultOpParams(def));
  // Model for this run only; null = the model that made the source (or the Settings default).
  const [picked, setPicked] = useState<string | null>(null);
  const applied = useRef<ToolSeed | undefined>(undefined);
  useEffect(() => {
    if (!seed || seed === applied.current || seed.op !== op) return;
    applied.current = seed;
    setParams({ ...defaultOpParams(def), ...seed.params });
    setPicked(seed.modelRef ?? null);
  }, [seed, op]);
  const opsSettings = useStore((s) => s.settings.ops);
  const videoSettings = useStore((s) => s.composer.video.settings);
  const [estimate, setEstimate] = useState<Estimate>(CALCULATING);
  // The inputs the shown estimate was calculated for: any other state of the inputs has a cost still pending.
  const sig = JSON.stringify([op, targetKey, params, picked, opsSettings, videoSettings]);
  const [settled, setSettled] = useState('');
  const pending = Boolean(target) && settled !== sig;
  const [via, setVia] = useState<string>('');
  const pickable = target?.kind === 'asset' && opFollowsSource(def.engine);

  useEffect(() => {
    let alive = true;
    if (!target) return;
    if (op === 'video_upscale') setVia('');
    const t = window.setTimeout(async () => {
      if (target.kind === 'asset') {
        let r;
        try { r = await opEstimate(target.assetId, op, params, picked ?? undefined); }
        catch (e) { if (alive) { setEstimate({ usd: null, approximate: true, note: String((e as Error).message) }); if (op === 'video_upscale') setVia(''); setSettled(sig); } return; }
        if (!alive) return;
        setEstimate(r.estimate);
        setVia(r.modelName);
      } else {
        let e: Estimate;
        try { e = await layerOpEstimate(target.sessionId, target.docId, target.layerId, op, params); }
        catch (err) { e = { usd: null, approximate: true, note: String((err as Error).message) }; }
        if (alive) setEstimate(e);
      }
      if (alive) setSettled(sig);
    }, 120);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [sig]);

  const missing = def.fields.find((f) => f.required && !String(params[f.key] ?? '').trim());
  const blocked = pending ? 'Calculating the cost…' : op === 'video_upscale' && !via ? estimate.note ?? 'Choose an available video upscaler.' : missing ? `Fill in “${missing.label}”.` : null;

  /** The one launch: the same calls the op popover makes after its cost confirmation. */
  const run = () => {
    if (!target || pending) return;
    if (target.kind === 'asset') void runAssetOp(target.assetId, op, params, target.parentId, picked ?? undefined);
    else void runLayerOp(target.sessionId, target.docId, target.layerId, op, params);
  };
  return { params, setParams, estimate: pending ? CALCULATING : estimate, via, picked, setPicked, pickable, missing, blocked, run };
}
export type OpRun = ReturnType<typeof useOpRun>;

/** The fields of an operation (and the video model control where it applies). */
export function OpFields({ op, state, className }: { op: OpId; state: OpRun; className?: string }) {
  const def = OPS[op];
  const { params, setParams } = state;
  return <>
    {op === 'video_upscale' || op === 'video_edit' || op === 'video_extend' || op === 'continue' ? <VideoUpscaleControls engine={op === 'continue' ? 'video' : op} params={params} onChange={setParams} /> : null}
    {def.fields.map((f) =>
      f.type === 'choice' ? (
        <div key={f.key} className={`op-field ${className ?? ''}`}>
          <span className="field-label">{f.label}</span>
          {(f.options?.length ?? 0) <= 4 ? (
            <Segmented value={String(params[f.key])} options={f.options!.map((o) => ({ value: o.value, label: o.label }))} onChange={(v) => setParams((p) => ({ ...p, [f.key]: v }))} size="sm" />
          ) : (
            <div className="option-grid">
              {f.options!.map((o) => (
                <button key={o.value} type="button" className={`option ${String(params[f.key]) === o.value ? 'is-active' : ''}`} onClick={() => setParams((p) => ({ ...p, [f.key]: o.value }))}>
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <label key={f.key} className={`op-field ${className ?? ''}`}>
          <span className="field-label">{f.label}</span>
          <textarea rows={2} className="text-area" value={String(params[f.key] ?? '')} placeholder={f.placeholder} onChange={(e) => setParams((p) => ({ ...p, [f.key]: e.target.value }))} autoFocus={f.required} />
        </label>
      ),
    )}
  </>;
}

/** "via <model>": the model of this run, changeable where the operation follows its source. Renders nothing before the cost is known. */
export function ViaPick({ op, state }: { op: OpId; state: OpRun }) {
  const def = OPS[op];
  const pop = usePopover();
  const { via, pickable, picked, setPicked } = state;
  if (!via) return null;
  if (!pickable) return <>{`via ${via}`}</>;
  return <>
    <button ref={pop.ref} type="button" className={`via-pick ${pop.open ? 'is-open' : ''}`} onClick={pop.toggle} data-tip="Model for this run">
      <span className="truncate">via {via}</span>
      <ChevronDown size={13} />
    </button>
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={380} label="Model">
      <ModelList
        kind={def.output === 'video' ? 'video' : 'image'}
        value={picked}
        filter={(m) => m.acceptsImage && !m.needsVideo && (def.output === 'video' || !m.tags.length)}
        autoOption={`Same model that made the ${def.input}, else the Settings default`}
        onSelect={(ref) => { setPicked(ref); pop.close(); }}
      />
    </Popover>
  </>;
}
