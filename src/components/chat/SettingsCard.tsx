import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, Check, Lock, LockOpen } from 'lucide-react';
import { confirmSettings, selectSettings } from '../../engine/agent/runtime';
import { selectDraft, unlockDraft } from '../../engine/agent/draftActions';
import { IMAGE_COUNTS, sectionsOf, choiceEstimate, settingsOptions } from '../../engine/agent/settingsCard';
import { aspectLabel, durationChoices } from '../../engine/params';
import type { SettingsChoice, SettingsFeedItem, SettingsSection } from '../../engine/types';
import { formatUsd } from '../../lib/format';
import { useStore } from '../../store/store';
import { Button, Range } from '../ui/primitives';
import { DRAFT, HQ, lowestResolution, type DraftMode } from '../../engine/agent/draftFirst';
import { ensureSchema } from '../../engine/catalog';
import { variantRoute } from '../../engine/variants';
import { modelChange } from '../../engine/modelNamed';
import { PROVIDER_LABELS } from '../../engine/providers/types';
import { EditAnswerButton } from './EditAnswerButton';
import { AspectPicker, AspectShape } from './aspectShape';
import { CardIcon, CountIcon, DurationIcon, ResolutionIcon } from './cardIcons';
import { ChipPop } from './ChipPop';
import { ModelField } from './ModelField';
import { ClampedText } from './ClampedText';

/**
 * Phase 2: the model and its main values, preselected by the app, confirmed before the agent writes any prompt.
 * Only the kinds of the plan that comes now, images first. Every change is kept on the card (the explicit confirmation button
 * accepts what it shows) and reported to the agent.
 */
export function SettingsCard({ item, sessionId }: { item: SettingsFeedItem; sessionId: string }) {
  const models = useStore((s) => s.catalog.models);
  const name = (ref: string) => models[ref]?.name ?? ref.split('::')[1] ?? ref;
  const sections = sectionsOf(item);
  const titled = sections.length > 1;
  // Two parts of one kind compare models (A/B): each title names its model.
  const sameKind = (i: number) => sections.filter((y) => y.kind === sections[i].kind).length > 1;
  if (item.status !== 'pending') {
    return (
      <article className="q-card is-done cc-w cc-set-done">
        <Check size={16} className="cc-ok" aria-hidden />
        <b className="cc-set-name">{item.status === 'confirmed' ? 'Settings' : 'Settings skipped'}</b>
        {item.status === 'confirmed' ? (
          <span className="cc-set-chips">
            {sections.flatMap((x, i) => {
              const c = x.chosen ?? x.recommended;
              const chips: ReactNode[] = [
                <span key={`${i}m`} className="cc-mini">{titled ? <span className="faint">{x.kind === 'image' ? 'Images' : 'Video'} </span> : null}{name(c.modelRef)}</span>,
              ];
              if (c.count && c.count > 1) chips.push(<span key={`${i}n`} className="cc-mini">×{c.count}</span>);
              if (c.resolution) chips.push(<span key={`${i}r`} className="cc-mini">{c.resolution}</span>);
              if (c.duration) chips.push(<span key={`${i}d`} className="cc-mini">{c.duration} s</span>);
              if (c.aspect) chips.push(<span key={`${i}a`} className="cc-mini"><AspectShape value={c.aspect} max={11} />{aspectLabel(c.aspect)}</span>);
              else if (c.needsImage) chips.push(<span key={`${i}a`} className="cc-mini">shape of the image</span>);
              return chips;
            })}
          </span>
        ) : null}
        <EditAnswerButton sessionId={sessionId} itemId={item.id} />
      </article>
    );
  }
  if (item.switchFrom && item.followUp) return <FollowUpCard item={item} sessionId={sessionId} name={name} />;
  if (item.switchFrom) return <SwitchModelCard item={item} sessionId={sessionId} name={name} />;
  return (
    <article className="q-card set-card cc-card cc-w" data-pop-bound>
      <header className="cc-head"><CardIcon /><h4 className="cc-title">Confirm settings</h4></header>
      {item.summary ? <ClampedText text={item.summary} /> : null}
      {item.draft ? <DraftChoice draft={item.draft} onSelect={(kind, text) => selectDraft(sessionId, item.id, kind, text)} /> : null}
      {sections.map((x, i) => (
        <div key={`${x.kind}-${i}`} className={titled ? 'set-section' : undefined}>
          {titled ? <div className="set-section-title">{x.kind === 'image' ? `Images${x.count > 1 ? ` · ${x.count}` : ''}` : `Video${x.count > 1 ? ` · ${x.count} clips` : ''}`}{sameKind(i) ? ` · ${name(x.recommended.modelRef)}` : ''}</div> : null}
          <SettingsSectionBlock section={x} index={i} itemId={item.id} sessionId={sessionId} draft={item.draft} />
        </div>
      ))}
      <footer className="q-foot">
        <span className="set-total faint">The exact cost is shown with the plan, once the prompts are written.</span>
        <Button variant="primary" size="sm" disabled={item.draft?.kind === 'other' && !item.draft.text?.trim()} onClick={() => void confirmSettings(sessionId, item.id, sections.map((x) => x.chosen ?? x.recommended))}>
          Continue <ArrowRight size={13} />
        </Button>
      </footer>
    </article>
  );
}

/** Borrador / Alta calidad / Otra cosa…, mandatory on every video card (and on Auto's plan card): the draft locks the resolution below. */
export function DraftChoice({ draft: d, onSelect, compact }: { draft: DraftMode; onSelect: (kind: DraftMode['kind'], text?: string) => void; compact?: boolean }) {
  // On the plan card: a small two-way switch in the chips row (the question and the free text belong to the settings card).
  if (compact) {
    return (
      <span className="cc-seg" role="group" aria-label="Borrador o alta calidad">
        {(['draft', 'hq'] as const).map((k) => <button key={k} type="button" className={d.kind === k ? 'is-on' : ''} aria-pressed={d.kind === k} onClick={() => onSelect(k)}>{k === 'draft' ? DRAFT : HQ}</button>)}
      </span>
    );
  }
  const opt = (kind: 'draft' | 'hq', label: string) => (
    <button type="button" className={`q-opt ${d.kind === kind ? 'is-on' : ''}`} aria-pressed={d.kind === kind} onClick={() => onSelect(kind)}>
      {d.kind === kind ? <Check size={12} /> : null}
      {label}
    </button>
  );
  return (
    <div className="q-block">
      <div className="q-question">Video: ¿borrador para elegir estilo y sensación, o alta calidad?</div>
      <div className="q-options">{opt('draft', DRAFT)}{opt('hq', HQ)}</div>
      <input
        className="q-custom"
        type="text"
        placeholder="Otra cosa…"
        aria-label="Otra cosa…"
        value={d.kind === 'other' ? d.text ?? '' : ''}
        onChange={(e) => onSelect('other', e.target.value)}
      />
    </div>
  );
}

/** One kind's model and values. Auto's plan card passes onPick / onUnlock: its changes go to the plan's steps. */
export function SettingsSectionBlock({ section: item, index, itemId, sessionId, draft, onPick, onUnlock, extra }: { section: SettingsSection; index: number; itemId: string; sessionId: string; draft?: DraftMode; onPick?: (c: SettingsChoice) => void; onUnlock?: () => void; extra?: ReactNode }) {
  const models = useStore((s) => s.catalog.models);
  const schemas = useStore((s) => s.catalog.schemas);
  const [choice, setChoice] = useState<SettingsChoice>(item.chosen ?? item.recommended);
  // After a reload the models' schemas are not in memory yet: load them, the options come from there.
  useEffect(() => {
    for (const ref of [item.recommended.modelRef, ...item.alternatives, item.chosen?.modelRef]) if (ref) void ensureSchema(ref);
  }, [item]);
  // The draft choice (selectDraft) changes the stored selection from outside: follow it.
  useEffect(() => { if (item.chosen && item.chosen.resolution !== choice.resolution) setChoice(item.chosen); }, [item.chosen?.resolution]); // eslint-disable-line react-hooks/exhaustive-deps

  const locked = item.kind === 'video' && Boolean(draft?.locked);
  // Locked or unlocked, the lock keeps its place so the chip does not move when it opens.
  const lockable = item.kind === 'video' && Boolean(draft?.locked || draft?.unlocked);
  const update = (next: SettingsChoice) => {
    setChoice(next);
    if (onPick) onPick(next);
    else selectSettings(sessionId, itemId, index, next);
  };
  const opts = settingsOptions(schemas[choice.modelRef], item.kind);
  // A locked draft keeps the lowest resolution of whichever model is picked (the schema may arrive late).
  const lockedRes = locked ? lowestResolution(opts.resolutions) : undefined;
  useEffect(() => {
    if (lockedRes && choice.resolution !== lockedRes) update({ ...choice, resolution: lockedRes });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedRes, choice.resolution]);
  // Exact pixel sizes (Seedream): size tier + ratio, as the composer and the nodes show them (params.pixelSizes).
  const px = opts.px;
  const pxNow = px && choice.aspect ? px.of(choice.aspect) : undefined;
  const allSecs = item.kind === 'video' ? durationChoices(schemas[choice.modelRef]).filter((d) => d > 0) : [];

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

  const aspectValues = px ? px.ratios : opts.aspects;
  const aspectNow = px ? pxNow?.ratio : choice.aspect;
  const pickAspect = (v: string) => update({ ...choice, aspect: px ? px.pick(pxNow?.tier, v) : v });
  const resNow = opts.resolutions.length ? choice.resolution : pxNow?.tier;
  const resShown = opts.resolutions.length > 0 || Boolean(px && px.tiers.length > 1);
  const count = choice.count ?? 1;
  const first = item.recommended.modelRef;

  return (
    <>
    <div className="cc-chips">
      <ModelField
        kind={item.kind}
        base={choice}
        startImage={item.recommended.needsImage}
        current={choice.modelRef}
        leading={[{ ref: first, tag: [item.recommended.needsImage && models[first] && ['edit', 'image', 'reference'].includes(variantRoute(models[first])) ? variantRoute(models[first]) : '', 'recommended'].filter(Boolean).join(' · ') }]}
        alternatives={item.alternatives}
        initiallyOpen={choice.modelRef !== item.recommended.modelRef}
        onPick={update}
      />

      {opts.aspects.length || px ? (
        <ChipPop icon={aspectNow ? <AspectShape value={aspectNow} /> : null} label={aspectNow ? aspectLabel(aspectNow) : item.recommended.needsImage ? 'Like the image' : 'Auto'} tip="Aspect ratio" width={360}>
          <AspectPicker
            values={aspectValues}
            value={aspectNow}
            onPick={pickAspect}
            extra={item.recommended.needsImage ? (
              <button type="button" className={`q-opt cc-like ${choice.aspect == null ? 'is-on' : ''}`} aria-pressed={choice.aspect == null} onClick={() => update({ ...choice, aspect: undefined })}>Like the image</button>
            ) : null}
          />
        </ChipPop>
      ) : null}

      {resShown ? (
        <ChipPop icon={<ResolutionIcon />} label={<>{resNow ?? 'Auto'}{lockable ? <span className="cc-lock">{locked ? <Lock size={11} aria-label="Locked by the draft" /> : <LockOpen size={11} aria-label="Unlocked" />}</span> : null}</>} tip="Resolution">
          <div className="q-question">Resolution
            {locked ? <button type="button" className="set-lock" title="Bloqueada por el borrador: pulsa para cambiarla" aria-label="Desbloquear la resolución" onClick={() => (onUnlock ? onUnlock() : unlockDraft(sessionId, itemId))}><Lock size={12} /></button>
              : lockable ? <span className="set-lock faint"><LockOpen size={12} aria-label="Resolución desbloqueada" /></span> : null}
          </div>
          <div className="q-options">
            {opts.resolutions.length
              ? chips(opts.resolutions, choice.resolution, (v) => v, (v) => { if (!locked) update({ ...choice, resolution: v }); })
              : chips(px!.tiers, pxNow?.tier, (v) => v, (t) => update({ ...choice, aspect: px!.pick(t, pxNow?.ratio) }))}
          </div>
        </ChipPop>
      ) : null}

      {item.kind === 'image' ? (
        <ChipPop icon={<CountIcon />} label={`${count} image${count === 1 ? '' : 's'}`} tip="Images per step">
          <div className="q-question">Images per step</div>
          <StepSlider values={IMAGE_COUNTS} value={count} label="Images per step" onChange={(n) => update({ ...choice, count: n })} />
        </ChipPop>
      ) : null}

      {item.kind === 'video' && allSecs.length ? (
        <ChipPop icon={<DurationIcon />} label={`${choice.duration ?? allSecs[0]}s`} tip={`Duration${item.count > 1 ? ' per clip' : ''}`}>
          <div className="q-question">Duration{item.count > 1 ? ' per clip' : ''}</div>
          <StepSlider values={allSecs} value={choice.duration ?? allSecs[0]} unit="s" label="Duration" onChange={(n) => update({ ...choice, duration: n })} />
        </ChipPop>
      ) : null}
      {extra}
    </div>
    </>
  );
}

/**
 * A slider over the values a setting takes (lengths the model accepts, images to generate) with a number field beside
 * it: arrows step to the next valid value, a half-typed number applies on blur or Enter, snapped to the nearest one.
 */
function StepSlider({ values, value, unit, label, onChange }: { values: number[]; value: number; unit?: string; label: string; onChange: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const snap = (n: number) => { if (Number.isFinite(n)) onChange(values.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a))); };
  const i = Math.max(0, values.indexOf(value));
  return (
    <div className="set-duration">
      <Range
        className="set-slider"
        min={0}
        max={values.length - 1}
        step={1}
        value={i}
        onChange={(e) => onChange(values[Number(e.target.value)])}
        aria-label={label}
      />
      <label className="set-secs">
        <input
          type="number"
          min={Math.min(...values)}
          max={Math.max(...values)}
          value={draft ?? value}
          onChange={(e) => {
            const n = Number(e.target.value);
            // An arrow step (±1) moves to the next valid value, even when values skip (4, 6, 8).
            const stepped = draft == null && Math.abs(n - value) === 1 ? values[Math.min(values.length - 1, Math.max(0, i + Math.sign(n - value)))] : undefined;
            if (stepped != null) { setDraft(null); onChange(stepped); }
            else if (values.includes(n)) { setDraft(null); onChange(n); }
            else setDraft(e.target.value);
          }}
          onBlur={() => { if (draft != null) snap(Number(draft)); setDraft(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          aria-label={label}
        />
        {unit ? <span className="faint">{unit}</span> : null}
      </label>
    </div>
  );
}

/** Another model or only another provider of the same model (ADR 0025 D). */
function changeOf(models: Record<string, { provider: keyof typeof PROVIDER_LABELS } & Parameters<typeof modelChange>[0]>, now: string, was: string) {
  return models[now] && models[was] ? modelChange(models[now], models[was]) : undefined;
}

/** The user asked for another model, or another provider of the same one: one short line with the model as a pill, "Keep" and "Change". */
function SwitchModelCard({ item, sessionId, name }: { item: SettingsFeedItem; sessionId: string; name: (ref: string) => string }) {
  const section = sectionsOf(item)[0];
  const next = section.recommended;
  const keep = item.switchFrom!;
  const e = choiceEstimate(next, section.kind, 1);
  const models = useStore((s) => s.catalog.models);
  const where = changeOf(models, next.modelRef, keep.modelRef) === 'provider' ? PROVIDER_LABELS[models[next.modelRef].provider] : undefined;
  return (
    <article className="q-card set-card cc-card cc-w cc-narrow cc-switch">
      <p className="cc-switch-line">{where ? null : 'Found model '}<span className="cc-mini" title={next.modelRef}>{name(next.modelRef)}{where ? ` is also on ${where}` : null}{e.usd == null ? null : <span className="faint"> · from {formatUsd(e.usd)}</span>}</span></p>
      <footer className="q-foot">
        <Button variant="ghost" size="sm" title={`Keep ${name(keep.modelRef)}`} onClick={() => void confirmSettings(sessionId, item.id, [{ ...keep, needsImage: next.needsImage }])}>Keep</Button>
        <Button variant="primary" size="sm" title={`Change to ${name(next.modelRef)}${where ? ` on ${where}` : ''}`} onClick={() => void confirmSettings(sessionId, item.id, [next])}>Change</Button>
      </footer>
    </article>
  );
}

/** The request after a switch: a tiny card; each option is a checkbox (grey and empty, green and checked once picked); one click answers. */
function FollowUpCard({ item, sessionId, name }: { item: SettingsFeedItem; sessionId: string; name: (ref: string) => string }) {
  const [picked, setPicked] = useState<string>();
  const section = sectionsOf(item)[0];
  const switched = section.recommended;
  const kept = item.switchFrom!;
  const models = useStore((s) => s.catalog.models);
  // The same model at another provider has the same name: the row says where.
  const shown = (ref: string) => (changeOf(models, switched.modelRef, kept.modelRef) === 'provider' ? `${name(ref)} · ${PROVIDER_LABELS[models[ref].provider]}` : name(ref));
  const answer = (c: SettingsChoice) => { setPicked(c.modelRef); void confirmSettings(sessionId, item.id, [c]); };
  const row = (ref: string, label: string, onClick: () => void) => (
    <button key={ref} type="button" role="checkbox" aria-checked={picked === ref} className={`cc-pick ${picked === ref ? 'is-on' : ''}`} onClick={onClick}>
      <span className="cc-box" aria-hidden>{picked === ref ? <Check size={12} strokeWidth={3} /> : null}</span>
      <span>{label}</span>
      <span className="cc-mini" title={ref}>{shown(ref)}</span>
    </button>
  );
  return (
    <article className="q-card set-card cc-card cc-w cc-narrow cc-follow">
      <p className="cc-switch-line">Next {section.kind}:</p>
      <div className="cc-picks">
        {row(switched.modelRef, 'Continue', () => answer(switched))}
        {row(kept.modelRef, 'Back', () => answer({ ...kept, needsImage: switched.needsImage }))}
      </div>
      <div className="cc-chips">
        <ModelField
          kind={section.kind}
          base={switched}
          startImage={switched.needsImage}
          current={picked}
          placeholder="Another model"
          leading={[{ ref: switched.modelRef, tag: 'switched' }, { ref: kept.modelRef, tag: 'confirmed' }]}
          alternatives={section.alternatives}
          onPick={(c) => answer(c.modelRef === kept.modelRef ? { ...kept, needsImage: switched.needsImage } : c.modelRef === switched.modelRef ? switched : c)}
        />
      </div>
    </article>
  );
}
