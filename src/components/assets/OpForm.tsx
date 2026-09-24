import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { OPS, defaultOpParams } from '../../engine/ops';
import { opEstimate, layerOpEstimate, runAssetOp, runLayerOp } from '../../engine/actions';
import type { AdvancedValue, Estimate, OpId } from '../../engine/types';
import { useStore } from '../../store/store';
import { Segmented } from '../ui/primitives';
import { SpendConfirm } from '../ui/SpendConfirm';

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
  const opsSettings = useStore((s) => s.settings.ops);
  const videoSettings = useStore((s) => s.composer.video.settings);

  useEffect(() => {
    let alive = true;
    const t = window.setTimeout(async () => {
      if (target.kind === 'asset') {
        const r = await opEstimate(target.assetId, op, params);
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
  }, [op, params, target, opsSettings, videoSettings]);

  const missing = def.fields.find((f) => f.required && !String(params[f.key] ?? '').trim());

  const run = () => {
    onClose();
    if (target.kind === 'asset') void runAssetOp(target.assetId, op, params, target.parentId);
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
        title={via ? `via ${via}` : 'Cost'}
        estimate={estimate}
        confirmLabel={def.engine === 'local' ? 'Run (free)' : 'Apply'}
        onConfirm={run}
        onCancel={onClose}
        blocked={missing ? `Fill in “${missing.label}”.` : null}
      />
    </div>
  );
}
