import { useState } from 'react';
import { ArrowRight, Check, ChevronDown } from 'lucide-react';
import { confirmSettings, selectSettings } from '../../engine/agent/runtime';
import { choiceEstimate, defaultChoice, describeChoice, settingsOptions } from '../../engine/agent/settingsCard';
import { aspectLabel, durationChoices } from '../../engine/params';
import type { SettingsChoice, SettingsFeedItem } from '../../engine/types';
import { formatUsd } from '../../lib/format';
import { useStore } from '../../store/store';
import { Button } from '../ui/primitives';

/**
 * Phase 2: the model and its main values, preselected by the app, confirmed before the agent writes any prompt.
 * Every change is kept on the card (a typed message confirms what it shows) and reported to the agent.
 */
export function SettingsCard({ item, sessionId }: { item: SettingsFeedItem; sessionId: string }) {
  const models = useStore((s) => s.catalog.models);
  const schemas = useStore((s) => s.catalog.schemas);
  const [choice, setChoice] = useState<SettingsChoice>(item.chosen ?? item.recommended);
  const [moreOpen, setMoreOpen] = useState(choice.modelRef !== item.recommended.modelRef);
  const [otherSecs, setOtherSecs] = useState('');
  const name = (ref: string) => models[ref]?.name ?? ref.split('::')[1] ?? ref;
  const provider = (ref: string) => ref.split('::')[0];
  const price = (c: SettingsChoice) => {
    const e = choiceEstimate(c, item.kind, item.count);
    return e.usd == null ? 'price unknown' : formatUsd(e.usd, { approx: e.approximate });
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
  const setOther = (v: string) => {
    setOtherSecs(v);
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0 || !allSecs.length) return;
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

  const chips = <T extends string | number>(values: T[], current: T | undefined, label: (v: T) => string, set: (v: T) => void) =>
    values.map((v) => {
      const on = current === v;
      return (
        <button key={String(v)} type="button" className={`q-opt ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={() => set(v)}>
          {on ? <Check size={12} /> : null}
          {label(v)}
        </button>
      );
    });

  return (
    <article className="q-card set-card">
      <div className="q-kicker">Settings · before the plan is written</div>
      {item.summary ? <p className="q-intro">{item.summary}</p> : null}

      <div className="q-block">
        <div className="q-question">Model</div>
        <div className="set-models">
          {modelRow(item.recommended.modelRef, 'recommended')}
          {item.alternatives.length ? (
            <button type="button" className="set-more" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}>
              Other models ({item.alternatives.length}) <ChevronDown size={12} className={moreOpen ? 'is-flipped' : ''} />
            </button>
          ) : null}
          {moreOpen ? item.alternatives.map((ref) => modelRow(ref)) : null}
        </div>
      </div>

      {opts.resolutions.length ? (
        <div className="q-block">
          <div className="q-question">Resolution</div>
          <div className="q-options">{chips(opts.resolutions, choice.resolution, (v) => v, (v) => update({ ...choice, resolution: v }))}</div>
        </div>
      ) : null}

      {item.kind === 'video' && opts.durations.length ? (
        <div className="q-block">
          <div className="q-question">Duration{item.count > 1 ? ' per clip' : ''}</div>
          <div className="q-options">
            {chips(opts.durations, choice.duration, (v) => `${v} s`, (v) => { setOtherSecs(''); update({ ...choice, duration: v }); })}
            {allSecs.length > opts.durations.length ? (
              <input className="q-custom set-secs" type="number" min={Math.min(...allSecs)} max={Math.max(...allSecs)} placeholder="Other s" value={otherSecs} onChange={(e) => setOther(e.target.value)} />
            ) : null}
          </div>
        </div>
      ) : null}

      {opts.aspects.length ? (
        <div className="q-block">
          <div className="q-question">Aspect ratio</div>
          <div className="q-options">
            {item.recommended.needsImage ? chips<string>(['__image'], choice.aspect ?? '__image', () => 'Like the image', () => update({ ...choice, aspect: undefined })) : null}
            {chips(opts.aspects, choice.aspect, (v) => aspectLabel(v), (v) => update({ ...choice, aspect: v }))}
          </div>
        </div>
      ) : null}

      <footer className="q-foot">
        <span className="faint set-total">
          {item.count > 1 ? `${item.count} ${item.kind === 'video' ? 'clips' : 'images'} · ` : ''}
          {price(choice)}
        </span>
        <Button variant="primary" size="sm" onClick={() => void confirmSettings(sessionId, item.id, choice)}>
          Continue <ArrowRight size={13} />
        </Button>
      </footer>
    </article>
  );
}
