import { useState } from 'react';
import { ChevronDown, Copy, Layers } from 'lucide-react';
import { aspectLabel, durationLabel } from '../../engine/params';
import { PROVIDER_LABELS } from '../../engine/providers/types';
import { copyText } from '../../engine/actions';
import type { Asset, Generation } from '../../engine/types';
import { AssetMedia } from '../ui/AssetMedia';
import { Button } from '../ui/primitives';
import { GenerationInfo, generationInputs, generationTitle, openInputs } from '../assets/GenerationInfo';
import { ReuseButton } from '../assets/ReuseButton';
import { KIND_ICON } from './nodes';

const KIND_LABEL = { image: 'Image', video: 'Video', audio: 'Audio', model3d: '3D model' } as const;

/**
 * The selected result in the corner: what it is, which model, the prompt, its inputs and settings, then Reusar and
 * Copy. The full record (seed, cost, timing, request) stays folded under "All details".
 */
export function ResultSummary({ generation: g, asset }: { generation?: Generation; asset: Asset }) {
  const [more, setMore] = useState(false);
  const KindIcon = KIND_ICON[asset.kind as keyof typeof KIND_ICON] ?? KIND_ICON.image;
  const text = g ? generationTitle(g) : '';
  const inputs = g ? generationInputs(g) : [];
  const s = g?.settings;
  const chips = [
    s?.aspect ? aspectLabel(s.aspect) : null,
    s?.resolution ?? null,
    g?.kind === 'video' && s?.duration ? durationLabel(s.duration) : null,
    asset.kind !== 'audio' && asset.width ? `${asset.width}×${asset.height}` : null,
  ].filter((c): c is string => Boolean(c));
  return (
    <div className="result-summary">
      <div className="rs-line"><KindIcon size={14} /> {KIND_LABEL[asset.kind as keyof typeof KIND_LABEL] ?? asset.kind}</div>
      {g ? <div className="rs-line"><Layers size={14} /> {g.modelName}{g.provider !== 'local' ? <span className="faint"> · {PROVIDER_LABELS[g.provider]}</span> : null}</div> : null}
      {text ? <p className="rs-prompt">{text}</p> : <p className="rs-prompt faint">{asset.origin === 'upload' ? 'Uploaded file' : 'No prompt'}</p>}
      {inputs.length ? (
        <div className="rs-inputs">
          {inputs.map((id, i) => (
            <button key={id} type="button" className="info-thumb" aria-label={`Open input ${i + 1}`} onClick={() => openInputs(inputs, i)}>
              <AssetMedia assetId={id} hoverPlay={false} draggable={false} />
            </button>
          ))}
        </div>
      ) : null}
      {chips.length ? <div className="rs-chips">{chips.map((c) => <span key={c} className="cc-mini num">{c}</span>)}</div> : null}
      <div className="rs-actions">
        <ReuseButton g={g} />
        {g?.prompt && !g.op ? <Button size="sm" variant="secondary" icon={Copy} onClick={() => void copyText(g.prompt)}>Copy</Button> : null}
      </div>
      <button type="button" className="rs-more" aria-expanded={more} onClick={() => setMore(!more)}>
        All details <ChevronDown size={13} className={more ? 'rot-180' : ''} />
      </button>
      {more ? <GenerationInfo generation={g} asset={asset} /> : null}
    </div>
  );
}
