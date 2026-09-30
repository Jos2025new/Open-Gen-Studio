import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft } from 'lucide-react';
import { opFollowsSource } from '../../engine/catalog';
import { OPS, defaultOpParams } from '../../engine/ops';
import { opEstimate, layerOpEstimate, runAssetOp, runLayerOp } from '../../engine/actions';
import type { AdvancedValue, Estimate, OpId } from '../../engine/types';
import { useStore } from '../../store/store';
import { Segmented } from '../ui/primitives';
import { SpendConfirm } from '../ui/SpendConfirm';
import { Popover, usePopover } from '../ui/Popover';
import { VideoUpscaleControls } from './VideoUpscaleControls';
import { ModelList } from '../composer/ModelList';

export type OpTarget = { kind: 'asset'; assetId: string; parentId?: string } | { kind: 'layer'; sessionId: string; docId: string; layerId: string };

/** Parameters + cost check for one operation. Lives inside a popover. */
export function OpForm({ op, target: targetProp, onClose, onBack }: { op: OpId; target: OpTarget; onClose: () => void; onBack?: () => void }) {
  const def = OPS[op];
  // Callers pass a fresh object each render; key the estimate on its value.
  const targetKey = JSON.stringify(targetProp);
  const target = useMemo(() => targetProp, [targetKey]);
  const [params, setParams] = useState<Record<string, AdvancedValue>>(() => defaultOpParams(def));
  const [estimate, setEstimate] = useState<Estimate>({ usd: null, approximate: true, note: 'Calculating…' });
  const [via, setVia] = useState<string>('');
  // Model for this run only; null = the model that made the source (or the Settings default).
  const [picked, setPicked] = useState<string | null>(null);
  const pickable = target.kind === 'asset' && opFollowsSource(def.engine);
  const modelPop = usePopover();
  const opsSettings = useStore((s) => s.settings.ops);
  const videoSettings = useStore((s) => s.composer.video.settings);

  useEffect(() => {
    let alive = true;
    if (op === 'video_upscale') setVia('');
    const t = window.setTimeout(async () => {
      if (target.kind === 'asset') {
        let r;
        try { r = await opEstimate(target.assetId, op, params, picked ?? undefined); }
        catch (e) { if (alive && op === 'video_upscale') { setEstimate({ usd: null, approximate: true, note: String((e as Error).message) }); setVia(''); } return; }
        if (!alive) return;
        setEstimate(r.estimate);
        setVia(r.modelName);
      } else {
        const e = await layerOpEstimate(target.sessionId, target.docId, target.layerId, op, params);
        if (alive) setEstimate(e);
      }
    }, 120);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [op, params, target, opsSettings, videoSettings, picked]);

  const missing = def.fields.find((f) => f.required && !String(params[f.key] ?? '').trim());

  const run = () => {
    onClose();
    if (target.kind === 'asset') void runAssetOp(target.assetId, op, params, target.parentId, picked ?? undefined);
    else void runLayerOp(target.sessionId, target.docId, target.layerId, op, params);
  };

  return (
    <div className="op-form">
      <div className="op-head">
        {onBack ? (
          <button type="button" className="back-btn" onClick={onBack} aria-label="Back">
            <ChevronLeft size={15} />
          </button>
        ) : null}
        <div>
          <div className="pop-title">{def.label}</div>
          <div className="pop-sub">{def.description}</div>
        </div>
      </div>
      {op === 'video_upscale' || op === 'video_edit' || op === 'video_extend' ? <VideoUpscaleControls engine={op} params={params} onChange={setParams} /> : null}
      {def.fields.map((f) =>
        f.type === 'choice' ? (
          <div key={f.key} className="op-field">
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
          <label key={f.key} className="op-field">
            <span className="field-label">{f.label}</span>
            <textarea
              rows={2}
              className="text-area"
              value={String(params[f.key] ?? '')}
              placeholder={f.placeholder}
              onChange={(e) => setParams((p) => ({ ...p, [f.key]: e.target.value }))}
              autoFocus={f.required}
            />
          </label>
        ),
      )}
      <SpendConfirm
        title={
          pickable && via ? (
            <button ref={modelPop.ref} type="button" className={`via-pick ${modelPop.open ? 'is-open' : ''}`} onClick={modelPop.toggle} data-tip="Model for this run">
              <span className="truncate">via {via}</span>
              <ChevronDown size={13} />
            </button>
          ) : via ? (
            `via ${via}`
          ) : (
            'Cost'
          )
        }
        estimate={estimate}
        confirmLabel={def.engine === 'local' ? 'Run (free)' : 'Apply'}
        onConfirm={run}
        onCancel={onClose}
        blocked={op === 'video_upscale' && !via ? estimate.note ?? 'Choose an available video upscaler.' : missing ? `Fill in “${missing.label}”.` : null}
      />
      {pickable ? (
        <Popover open={modelPop.open} anchor={modelPop.ref} onClose={modelPop.close} width={380} label="Model">
          <ModelList
            kind={def.output === 'video' ? 'video' : 'image'}
            value={picked}
            filter={(m) => m.acceptsImage && !m.needsVideo && (def.output === 'video' || !m.tags.length)}
            autoOption={`Same model that made the ${def.input}, else the Settings default`}
            onSelect={(ref) => {
              setPicked(ref);
              modelPop.close();
            }}
          />
        </Popover>
      ) : null}
    </div>
  );
}
