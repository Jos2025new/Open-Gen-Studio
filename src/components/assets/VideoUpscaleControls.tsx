import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { ensureSchema, opModelFor, videoOpFits } from '../../engine/catalog';
import type { AdvancedValue } from '../../engine/types';
import { useStore } from '../../store/store';
import { AdvancedField } from '../composer/MediaControls';
import { ModelList } from '../composer/ModelList';
import { Chip } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';

/** One upscale-only control, shared by the node and asset/chat operation forms. */
export function VideoUpscaleControls({ params, onChange, engine = 'video_upscale' }: { params: Record<string, AdvancedValue>; onChange: (params: Record<string, AdvancedValue>) => void; engine?: 'video_upscale' | 'video_edit' | 'video_extend' | 'video' }) {
  const catalog = useStore(s => s.catalog);
  useStore(s => s.settings.ops);
  const ref = typeof params._modelRef === 'string' ? params._modelRef : opModelFor(engine).ref;
  const model = catalog.models[ref], schema = catalog.schemas[ref];
  const pop = usePopover();
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    setError('');
    if (ref) void ensureSchema(ref).catch(e => { if (alive) setError(String(e.message ?? e)); });
    return () => { alive = false; };
  }, [ref]);
  const fields = schema?.params.filter(p => !['count', ...(engine === 'video' ? [] : ['duration']), 'aspect', 'audio', 'negative'].includes(p.role)) ?? [];
  return <div className="op-form nodrag nowheel">
    <Chip ref={pop.ref} onClick={pop.toggle} className="wide-chip"><span className="truncate">{model ? `${model.name} · ${model.provider}` : 'Choose model'}</span><ChevronDown size={12} /></Chip>
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={380} label="Model"><ModelList kind="video" value={ref} filter={m => videoOpFits(engine, m)} onSelect={value => { onChange(value ? { ...params, _modelRef: value } : {}); pop.close(); }} /></Popover>
    {error ? <p className="faint">{error}</p> : ref && !schema ? <p className="faint">Loading model parameters…</p> : null}
    {fields.map(p => ['string', 'text'].includes(p.type) ? <label key={p.key} className="op-field"><span className="field-label" data-tip={p.description}>{p.label}</span><input className="input" value={String(params[p.key] ?? p.default ?? '')} onChange={e => onChange({ ...params, _modelRef: ref, [p.key]: e.target.value })} /></label> : <AdvancedField key={p.key} p={p} value={params[p.key]} onChange={value => { const next: Record<string, AdvancedValue> = { ...params, _modelRef: ref }; if (value === undefined) delete next[p.key]; else next[p.key] = value; onChange(next); }} />)}
    {schema && !fields.length ? <p className="faint">{schema.source === 'derived' ? 'Provider parameter schema unavailable.' : 'This model exposes no adjustable parameters.'}</p> : null}
  </div>;
}
