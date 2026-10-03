import { useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowRight, Check, ChevronDown } from 'lucide-react';
import { confirmSettings, selectSettings } from '../../engine/agent/runtime';
import { choiceEstimate, defaultChoice, describeChoice, settingsOptions } from '../../engine/agent/settingsCard';
import { aspectLabel, durationChoices } from '../../engine/params';
import type { SettingsChoice, SettingsFeedItem } from '../../engine/types';
import { formatUsd } from '../../lib/format';
import { useStore } from '../../store/store';
import { Button } from '../ui/primitives';
import { AspectGlyph } from '../composer/MediaControls';

/**
 * Phase 2: the model and its main values, preselected by the app, confirmed before the agent writes any prompt.
 * Every change is kept on the card (a typed message confirms what it shows) and reported to the agent.
 */
export function SettingsCard({ item, sessionId }: { item: SettingsFeedItem; sessionId: string }) {
  const models = useStore((s) => s.catalog.models);
  const schemas = useStore((s) => s.catalog.schemas);
  const [choice, setChoice] = useState<SettingsChoice>(item.chosen ?? item.recommended);
  const [secsDraft, setSecsDraft] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(choice.modelRef !== item.recommended.modelRef);
  const name = (ref: string) => models[ref]?.name ?? ref.split('::')[1] ?? ref;
  const provider = (ref: string) => ref.split('::')[0];
  // Indicative: one clip or image with the values above. The exact cost comes on the plan card, once the prompts exist.
  const price = (c: SettingsChoice) => {
    const e = choiceEstimate(c, item.kind, 1);
    return e.usd == null ? 'price unknown' : `from ${formatUsd(e.usd)}`;
  };

  if (item.status !== 'pending') {
    const c = item.chosen ?? item.recommended;
    return (
      <article className="q-card is-done">
        <div className="q-kicker">Settings · {item.status === 'confirmed' ? 'confirmed' : 'skipped'}</div>
        {item.status === 'confirmed' ? <p className="q-summary">{describeChoice(name(c.modelRef), c)}</p> : null}
      </article>
    );
  }

  const update = (next: SettingsChoice) => {
    setChoice(next);
    selectSettings(sessionId, item.id, next);
  };
  // Another model keeps the values the user picked when it has them, else its own medium ones.
  const pickModel = (ref: string) => update({ ...defaultChoice(ref, schemas[ref], { kind: item.kind, startImage: item.recommended.needsImage, duration: choice.duration, aspect: choice.aspect }, choice), needsImage: item.recommended.needsImage });
  const opts = settingsOptions(schemas[choice.modelRef], item.kind);
  const allSecs = item.kind === 'video' ? durationChoices(schemas[choice.modelRef]).filter((d) => d > 0) : [];
  // Any length the model takes, snapped to the nearest one.
  const setSecs = (n: number) => {
    if (!Number.isFinite(n) || !allSecs.length) return;
    update({ ...choice, duration: allSecs.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a)) });
  };

  const modelRow = (ref: string, tag?: string) => {
    const on = choice.modelRef === ref;
    return (
      <button key={ref} type="button" className={`q-opt set-model ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={() => pickModel(ref)}>
        {on ? <Check size={12} /> : null}
        <span className="set-model-name">{name(ref)}</span>
        <span className="faint">{provider(ref)}{tag ? ` · ${tag}` : ''}</span>
        <span className="set-model-price num">{price({ ...defaultChoice(ref, schemas[ref], { kind: item.kind, startImage: item.recommended.needsImage, duration: choice.duration, aspect: choice.aspect }, choice), needsImage: item.recommended.needsImage })}</span>
      </button>
    );
  };

  const chips = <T extends string | number>(values: T[], current: T | undefined, label: (v: T) => string, set: (v: T) => void, icon?: (v: T) => ReactNode) =>
    values.map((v) => {
      const on = current === v;
      return (
        <button key={String(v)} type="button" className={`q-opt ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={() => set(v)}>
          {on ? <Check size={12} /> : null}
          {icon?.(v)}
          {label(v)}
        </button>
      );
    });

  return (
    <article className="q-card set-card">
      <div className="q-kicker">Settings · before the plan is written</div>
      {item.summary ? <p className="q-intro">{item.summary}</p> : null}

      {item.kind === 'video' && allSecs.length ? (
        <div className="q-block">
          <div className="q-question">Duration{item.count > 1 ? ' per clip' : ''}</div>
          <div className="set-duration">
            <input
              type="range"
              className="set-slider"
              min={0}
              max={allSecs.length - 1}
              step={1}
              value={Math.max(0, allSecs.indexOf(choice.duration ?? allSecs[0]))}
              style={{ '--fill': `${allSecs.length > 1 ? (Math.max(0, allSecs.indexOf(choice.duration ?? allSecs[0])) / (allSecs.length - 1)) * 100 : 0}%` } as CSSProperties}
              onChange={(e) => setSecs(allSecs[Number(e.target.value)])}
              aria-label="Duration"
            />
            <label className="set-secs">
              <input
                type="number"
                min={Math.min(...allSecs)}
                max={Math.max(...allSecs)}
                value={secsDraft ?? choice.duration ?? ''}
                onChange={(e) => {
                  // Arrows and valid lengths apply at once; a half-typed number waits for blur or Enter.
                  const n = Number(e.target.value);
                  const cur = choice.duration ?? allSecs[0];
                  const i = allSecs.indexOf(cur);
                  // An arrow step (±1) moves to the next length the model takes, even when it skips values (4, 6, 8).
                  const stepped = secsDraft == null && Math.abs(n - cur) === 1 && i >= 0 ? allSecs[Math.min(allSecs.length - 1, Math.max(0, i + Math.sign(n - cur)))] : undefined;
                  if (stepped != null) { setSecsDraft(null); setSecs(stepped); }
                  else if (allSecs.includes(n)) { setSecsDraft(null); setSecs(n); }
                  else setSecsDraft(e.target.value);
                }}
                onBlur={() => { if (secsDraft != null) setSecs(Number(secsDraft)); setSecsDraft(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                aria-label="Seconds"
              />
              <span className="faint">s</span>
            </label>
          </div>
        </div>
      ) : null}

      {opts.resolutions.length ? (
        <div className="q-block">
          <div className="q-question">Resolution</div>
          <div className="q-options">{chips(opts.resolutions, choice.resolution, (v) => v, (v) => update({ ...choice, resolution: v }))}</div>
        </div>
      ) : null}

      {opts.aspects.length ? (
        <div className="q-block">
          <div className="q-question">Aspect ratio</div>
          <div className="q-options">
            {item.recommended.needsImage ? chips<string>(['__image'], choice.aspect ?? '__image', () => 'Like the image', () => update({ ...choice, aspect: undefined })) : null}
            {chips(opts.aspects, choice.aspect, (v) => aspectLabel(v), (v) => update({ ...choice, aspect: v }), (v) => <AspectGlyph value={v} />)}
          </div>
        </div>
      ) : null}

      <div className="q-block">
        <div className="q-question">Model</div>
        <div className="set-models">
          {modelRow(item.recommended.modelRef, 'recommended')}
          {item.alternatives.length ? (
            <button type="button" className="set-more" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}>
              {moreOpen ? 'Hide other models' : `Show ${item.alternatives.length} other model${item.alternatives.length === 1 ? '' : 's'}`} <ChevronDown size={13} className={moreOpen ? 'is-flipped' : ''} />
            </button>
          ) : null}
          {moreOpen ? item.alternatives.map((ref) => modelRow(ref)) : null}
        </div>
      </div>

      <footer className="q-foot">
        <span className="set-total faint">The exact cost is shown with the plan, once the prompts are written.</span>
        <Button variant="primary" size="sm" onClick={() => void confirmSettings(sessionId, item.id, choice)}>
          Continue <ArrowRight size={13} />
        </Button>
      </footer>
    </article>
  );
}
