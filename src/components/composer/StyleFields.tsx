import { useState } from 'react';
import { Plus } from 'lucide-react';
import { normalizeStructured, type PaletteValue } from '../../engine/params';
import type { MediaKind, ParamDef, SavedStyle } from '../../engine/types';
import { createRecraftStyle } from '../../engine/actions';
import { setComposerMedia, useStore } from '../../store/store';
import { SpendConfirm } from '../ui/SpendConfirm';
import { Button } from '../ui/primitives';
import { InlineColor } from '../designer/InlineControls';

export function setExtra(kind: MediaKind, p: ParamDef, value: unknown) {
  const cur = useStore.getState().composer[kind].settings;
  const extras = { ...cur.extras };
  const v = normalizeStructured(p, value);
  if (v === undefined) delete extras[p.key];
  else extras[p.key] = v;
  setComposerMedia(kind, { settings: { ...cur, extras: Object.keys(extras).length ? extras : undefined } });
}

/** Colors, palettes, style codes and ids (Recraft, Ideogram). */
export function StyleField({ kind, p }: { kind: MediaKind; p: ParamDef }) {
  const value = useStore((s) => s.composer[kind].settings.extras?.[p.key]);
  const [draft, setDraft] = useState('');
  const label = (
    <span className="field-label" data-tip={p.description}>
      {p.label}
    </span>
  );
  if (p.type === 'color') {
    return (
      <div className="adv-row">
        {label}
        <div className="color-field">
          <InlineColor label={p.label} value={typeof value === 'string' ? value : '#ffffff'} onChange={(color) => setExtra(kind, p, color)} />
          {value ? (
            <button type="button" className="link-btn" onClick={() => setExtra(kind, p, undefined)}>
              Clear
            </button>
          ) : (
            <span className="faint">Default</span>
          )}
        </div>
      </div>
    );
  }
  if (p.type === 'colors' || p.type === 'palette') {
    const pal = (p.type === 'palette' ? value : { colors: (value as string[] | undefined)?.map((hex) => ({ hex })) }) as PaletteValue | undefined;
    const colors = pal?.colors ?? [];
    const max = p.type === 'colors' ? p.max ?? 5 : 8;
    const save = (next: Array<{ hex: string; weight?: number }>) => setExtra(kind, p, p.type === 'colors' ? next.map((c) => c.hex) : { colors: next });
    return (
      <div className="adv-row col">
        {label}
        {p.type === 'palette' ? (
          <select className="select" value={pal?.preset ?? ''} onChange={(e) => setExtra(kind, p, e.target.value ? { preset: e.target.value } : undefined)} aria-label={`${p.label} preset`}>
            <option value="">{colors.length ? 'Custom colors' : 'None'}</option>
            {(p.options ?? []).map((o) => (
              <option key={String(o)} value={String(o)}>
                {String(o)}
              </option>
            ))}
          </select>
        ) : null}
        {!pal?.preset ? (
          <div className="swatch-list">
            {colors.map((c, i) => (
              <span key={i} className="swatch-edit">
                <InlineColor label={`Color ${i + 1}`} value={c.hex} onChange={(hex) => save(colors.map((x, j) => (j === i ? { ...x, hex } : x)))} />
                {p.type === 'palette' ? (
                  <input
                    type="number"
                    className="num-input num"
                    min={0.05}
                    max={1}
                    step={0.05}
                    value={c.weight ?? 0.5}
                    onChange={(e) => save(colors.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)))}
                    aria-label={`Weight ${i + 1}`}
                  />
                ) : null}
                <button type="button" aria-label={`Remove color ${i + 1}`} onClick={() => save(colors.filter((_, j) => j !== i))}>
                  ×
                </button>
              </span>
            ))}
            {colors.length < max ? (
              <button type="button" className="option" onClick={() => save([...colors, { hex: '#808080' }])}>
                + Color
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }
  // text / textList: typed, validated on the way in (style codes are 8 hex characters).
  const shown = Array.isArray(value) ? value.join(', ') : typeof value === 'string' ? value : '';
  const invalid = draft !== '' && normalizeStructured(p, draft) === undefined;
  return (
    <div className="adv-row col">
      {label}
      <input
        className="text-input"
        placeholder={p.type === 'textList' ? 'e.g. 1A2B3C4D, 5E6F7A8B' : p.key === 'style_id' ? 'Style ID (uuid)' : p.key === 'model_id' ? 'ID' : p.label}
        value={draft || shown}
        onChange={(e) => {
          setDraft(e.target.value);
          setExtra(kind, p, e.target.value);
        }}
        onBlur={() => setDraft('')}
        aria-label={p.label}
      />
      {invalid ? <span className="field-error">{p.type === 'textList' ? 'Codes are 8 hexadecimal characters, separated by commas.' : 'Not a valid value.'}</span> : null}
      {p.key === 'style_id' ? <SavedStyles kind={kind} p={p} /> : null}
    </div>
  );
}

const NO_STYLES: SavedStyle[] = [];

/** Recraft styles saved in the session: pick one, or create a V4 style from the attached images (paid, confirmed). */
function SavedStyles({ kind, p }: { kind: MediaKind; p: ParamDef }) {
  const ref = useStore((s) => s.composer[kind].modelRef);
  const sessionId = useStore((s) => s.activeSessionId);
  const styles = useStore((s) => s.sessions[s.activeSessionId]?.styles) ?? NO_STYLES;
  const images = useStore((s) => s.composer.attachments.filter((id) => s.assets[id]?.kind === 'image').length);
  const [name, setName] = useState('');
  const [confirming, setConfirming] = useState(false);
  // V4 styles only work with the V4 models; V3 styles need a ZIP upload and are pasted as an ID instead.
  const v4 = /recraft/.test(ref) && /v4/.test(ref);
  if (!v4) return <p className="faint">Paste a style ID created in Recraft (V3 styles are made from a ZIP of images outside the app).</p>;
  return (
    <div className="saved-styles">
      {styles.map((st) => (
        <button key={st.id} type="button" className="option" onClick={() => setExtra(kind, p, st.styleId)} data-tip={st.styleId}>
          {st.name}
        </button>
      ))}
      <div className="subject-new">
        <input placeholder="New style name" value={name} onChange={(e) => setName(e.target.value)} aria-label="New style name" />
        <Button size="sm" icon={Plus} disabled={!images || images > 10} onClick={() => setConfirming(true)}>
          From {images || 'attached'} image{images === 1 ? '' : 's'}
        </Button>
      </div>
      {confirming ? (
        <SpendConfirm
          title="Create a Recraft V4 style"
          lines={[`fal.ai learns the style from ${images} attached image${images === 1 ? '' : 's'} (1–10).`]}
          estimate={{ usd: null, approximate: true, note: 'fal bills the style when it is created' }}
          confirmLabel="Create style"
          onConfirm={() => {
            setConfirming(false);
            void createRecraftStyle(sessionId, name || 'Style');
            setName('');
          }}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </div>
  );
}

