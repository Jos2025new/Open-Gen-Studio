import { useEffect, useRef, useState } from 'react';
import { Box, ChevronDown, Clapperboard, Dices, FileText, Layers, Plus, SlidersHorizontal, Trash, Users, Volume2, VolumeX } from 'lucide-react';
import { ensureSchema, modelSummary, pickComposerModel } from '../../engine/catalog';
import { aspectLabel, durationChoices, durationLabel, lyricsParam, paramByRole, pixelSizes, ratioOf, maxCountPerRequest, STRUCTURED_TYPES } from '../../engine/params';
import { randomSeed } from '../../lib/rng';
import type { AdvancedValue, MediaKind, ParamDef } from '../../engine/types';
import { createSubjectVoice, deleteSubject, saveSubject, subjectFromAttachments } from '../../engine/actions';
import { SpendConfirm } from '../ui/SpendConfirm';
import { setComposer, setComposerMedia, useStore } from '../../store/store';
import { AssetMedia } from '../ui/AssetMedia';
import { Popover, PopoverHeader, usePopover } from '../ui/Popover';
import { Button, Chip, IconButton, Segmented, Toggle } from '../ui/primitives';
import { StyleField, setExtra } from './StyleFields';
import { ModelList, priceHint } from './ModelList';

export function AspectGlyph({ value, size = 14 }: { value: string; size?: number }) {
  const r = ratioOf(value);
  if (r == null) return <span className="aspect-glyph is-auto" />;
  const w = r >= 1 ? size : Math.max(5, size * r);
  const h = r >= 1 ? Math.max(5, size / r) : size;
  return <span className="aspect-glyph" style={{ width: w, height: h }} />;
}

function ModelChip({ kind }: { kind: MediaKind }) {
  const ref = useStore((s) => s.composer[kind].modelRef);
  const model = useStore((s) => s.catalog.models[ref]);
  const loading = useStore((s) => !s.catalog.schemas[ref]);
  const pop = usePopover();
  const name = !ref ? (kind === 'model3d' ? 'No 3D model' : 'No audio model') : model?.name ?? (ref.startsWith('local::') ? (kind === 'image' ? 'Local Sketch' : 'Local Motion') : ref.split('::')[1]);
  return (
    <>
      <Chip ref={pop.ref} icon={Box} active={pop.open} onClick={pop.toggle} data-tip={loading ? 'Loading model parameters…' : `Model${model ? ` · ${priceHint(model)}` : ''}`} className="model-chip">
        <span className="truncate">{name}</span>
        <ChevronDown size={12} />
      </Chip>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={480} label={`${kind} model`}>
        <ModelList
          kind={kind}
          value={ref}
          onSelect={(r) => {
            if (r) void pickComposerModel(kind, r);
            pop.close();
          }}
        />
      </Popover>
    </>
  );
}

/** One pill button in a format section; the active one is raised. */
function FmtOption({ active, onClick, children, tip }: { active: boolean; onClick: () => void; children: React.ReactNode; tip?: string }) {
  return (
    <button type="button" className={`fmt-opt ${active ? 'is-active' : ''}`} onClick={onClick} data-tip={tip}>
      {children}
    </button>
  );
}

/**
 * Format of the result in one chip ("▢ 1:1 · 1k · 1"): aspect ratio, resolution and, for images, how many, or for
 * video, how long. The panel shows only the sections the model has and stays open while choosing.
 */
function FormatChip({ kind }: { kind: MediaKind }) {
  const ref = useStore((s) => s.composer[kind].modelRef);
  const schema = useStore((s) => s.catalog.schemas[ref]);
  const settings = useStore((s) => s.composer[kind].settings);
  const pop = usePopover();
  const aspect = paramByRole(schema, 'aspect');
  const resolution = paramByRole(schema, 'resolution');
  const durations = kind === 'video' ? durationChoices(schema) : [];
  const counts = kind === 'image' ? [1, 2, 3, 4] : [];
  // Sizes given as exact pixels (Seedream): a size tier plus a ratio, like other models.
  const px = pixelSizes(aspect?.options);
  const pxNow = px?.of(settings.aspect);
  const perRequest = maxCountPerRequest(schema);
  if (!aspect?.options?.length && !resolution?.options?.length && !durations.length && !counts.length) return null;
  const set = (patch: Partial<typeof settings>) => setComposerMedia(kind, { settings: { ...useStore.getState().composer[kind].settings, ...patch } });
  const summary = [
    px && pxNow?.ratio ? `${pxNow.ratio} · ${pxNow.tier}` : aspect?.options?.length && settings.aspect ? aspectLabel(settings.aspect) : null,
    resolution?.options?.length ? settings.resolution : null,
    kind === 'image' ? String(settings.count) : null,
    durations.length ? durationLabel(settings.duration ?? durations[0]) : null,
  ].filter(Boolean);
  return (
    <>
      <Chip ref={pop.ref} active={pop.open} onClick={pop.toggle} data-tip="Format" className="fmt-chip">
        {aspect?.options?.length ? <AspectGlyph value={pxNow?.ratio ?? settings.aspect ?? ''} /> : <Layers size={14} strokeWidth={1.8} />}
        <span>{summary.join(' · ')}</span>
        <ChevronDown size={12} />
      </Chip>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={430} label="Format">
        <div className="fmt-pop">
          {px ? (
            <>
              <section className="fmt-sect">
                <div className="fmt-label">Aspect ratio</div>
                <div className="fmt-row fmt-aspects">
                  {px.ratios.map((r) => (
                    <FmtOption key={r} active={r === pxNow?.ratio} onClick={() => set({ aspect: px.pick(pxNow?.tier, r) })}>
                      <AspectGlyph value={r} />
                      <span>{r}</span>
                    </FmtOption>
                  ))}
                </div>
              </section>
              {px.tiers.length > 1 ? (
                <section className="fmt-sect">
                  <div className="fmt-label">Resolution</div>
                  <div className="fmt-row">
                    {px.tiers.map((t) => (
                      <FmtOption key={t} active={t === pxNow?.tier} onClick={() => set({ aspect: px.pick(t, pxNow?.ratio) })}>
                        {t}
                      </FmtOption>
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          ) : aspect?.options?.length ? (
            <section className="fmt-sect">
              <div className="fmt-label">{aspect.label || 'Aspect ratio'}</div>
              <div className="fmt-row fmt-aspects">
                {aspect.options.map((o) => {
                  const v = String(o);
                  return (
                    <FmtOption key={v} active={v === settings.aspect} onClick={() => set({ aspect: v })}>
                      <AspectGlyph value={v} />
                      <span>{aspectLabel(v)}</span>
                    </FmtOption>
                  );
                })}
              </div>
            </section>
          ) : null}
          {resolution?.options?.length ? (
            <section className="fmt-sect">
              <div className="fmt-label">{resolution.label || 'Resolution'}</div>
              <div className="fmt-row">
                {resolution.options.map((o) => (
                  <FmtOption key={String(o)} active={String(o) === settings.resolution} onClick={() => set({ resolution: String(o) })}>
                    {String(o)}
                  </FmtOption>
                ))}
              </div>
            </section>
          ) : null}
          {counts.length ? (
            <section className="fmt-sect">
              <div className="fmt-label">Images to generate</div>
              <div className="fmt-row">
                {counts.map((n) => (
                  <FmtOption key={n} active={n === settings.count} onClick={() => set({ count: n })} tip={n > perRequest ? `This model returns ${perRequest} per request; the rest run as separate requests.` : undefined}>
                    {n}
                  </FmtOption>
                ))}
              </div>
            </section>
          ) : null}
          {durations.length ? (
            <section className="fmt-sect">
              <div className="fmt-label">Duration</div>
              <div className="fmt-row">
                {durations.map((d) => (
                  <FmtOption key={d} active={d === (settings.duration ?? durations[0])} onClick={() => set({ duration: d })}>
                    {durationLabel(d)}
                  </FmtOption>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </Popover>
    </>
  );
}

function AudioChip() {
  const ref = useStore((s) => s.composer.video.modelRef);
  const schema = useStore((s) => s.catalog.schemas[ref]);
  const audio = useStore((s) => s.composer.video.settings.audio);
  if (!paramByRole(schema, 'audio')) return null;
  return (
    <Chip
      icon={audio ? Volume2 : VolumeX}
      active={Boolean(audio)}
      onClick={() => {
        const cur = useStore.getState().composer.video.settings;
        setComposerMedia('video', { settings: { ...cur, audio: !cur.audio } });
      }}
      data-tip={audio ? 'Audio on (usually costs more)' : 'Audio off'}
      aria-pressed={Boolean(audio)}
    >
      {audio ? 'Audio' : 'Silent'}
    </Chip>
  );
}

/** Store one structured value (or clear it) in the composer settings. */
/** Several values from a fixed list (Grok voice_ids), kept in settings.extras. */
function MultiField({ kind, p }: { kind: MediaKind; p: ParamDef }) {
  const picked = useStore((s) => s.composer[kind].settings.extras?.[p.key]);
  const values = Array.isArray(picked) ? picked.map(String) : [];
  const toggle = (v: string) => {
    const cur = useStore.getState().composer[kind].settings;
    const next = values.includes(v) ? values.filter((x) => x !== v) : p.max && values.length >= p.max ? values : [...values, v];
    const extras = { ...cur.extras };
    if (next.length) extras[p.key] = next;
    else delete extras[p.key];
    setComposerMedia(kind, { settings: { ...cur, extras: Object.keys(extras).length ? extras : undefined } });
  };
  return (
    <div className="adv-row col">
      <span className="field-label" data-tip={p.description}>
        {p.label}
        {p.max ? <span className="faint"> · up to {p.max}</span> : null}
      </span>
      <div className="multi-options">
        {(p.options ?? []).map((o) => (
          <button key={String(o)} type="button" className={`option ${values.includes(String(o)) ? 'is-active' : ''}`} onClick={() => toggle(String(o))}>
            {String(o)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AdvancedField({ p, value, onChange }: { p: ParamDef; value: AdvancedValue | undefined; onChange: (v: AdvancedValue | undefined) => void }) {
  const current = value ?? p.default;
  if (p.type === 'boolean') {
    return (
      <div className="adv-row">
        <span className="field-label" data-tip={p.description}>
          {p.label}
        </span>
        <Toggle checked={Boolean(current)} onChange={(v) => onChange(v)} label={p.label} />
      </div>
    );
  }
  if (p.type === 'enum') {
    const opts = p.options ?? [];
    return (
      <div className="adv-row col">
        <span className="field-label" data-tip={p.description}>
          {p.label}
        </span>
        {opts.length <= 4 ? (
          <Segmented value={String(current ?? '')} options={opts.map((o) => ({ value: String(o), label: String(o) }))} onChange={(v) => onChange(typeof opts[0] === 'number' ? Number(v) : v)} size="sm" />
        ) : (
          <select className="select" value={String(current ?? '')} onChange={(e) => onChange(typeof opts[0] === 'number' ? Number(e.target.value) : e.target.value)}>
            {current == null ? <option value="">Default</option> : null}
            {opts.map((o) => (
              <option key={String(o)} value={String(o)}>
                {String(o)}
              </option>
            ))}
          </select>
        )}
      </div>
    );
  }
  if (p.type === 'number' || p.type === 'integer') {
    return (
      <div className="adv-row">
        <span className="field-label" data-tip={p.description}>
          {p.label}
        </span>
        <input
          className="num-input num"
          type="number"
          min={p.min}
          max={p.max}
          step={p.step ?? (p.type === 'integer' ? 1 : 0.1)}
          value={current == null ? '' : String(current)}
          placeholder="Default"
          onChange={(e) => {
            const v = e.target.value;
            if (v === '') onChange(undefined);
            else {
              const n = Number(v);
              if (Number.isFinite(n)) onChange(p.type === 'integer' ? Math.round(n) : n);
            }
          }}
        />
      </div>
    );
  }
  return null;
}

function AdvancedChip({ kind }: { kind: MediaKind }) {
  const ref = useStore((s) => s.composer[kind].modelRef);
  const schema = useStore((s) => s.catalog.schemas[ref]);
  const settings = useStore((s) => s.composer[kind].settings);
  const pop = usePopover();
  if (!schema) return null;
  const others = schema.params.filter((p) => p.role === 'other');
  const seed = paramByRole(schema, 'seed');
  const negative = paramByRole(schema, 'negative');
  const changed = Object.keys(settings.advanced).length + Object.keys(settings.extras ?? {}).length + (settings.seed != null ? 1 : 0) + (settings.negative ? 1 : 0);
  if (!others.length && !seed && !negative) return null;
  const update = (patch: Partial<typeof settings>) => setComposerMedia(kind, { settings: { ...useStore.getState().composer[kind].settings, ...patch } });
  return (
    <>
      <Chip ref={pop.ref} icon={SlidersHorizontal} active={pop.open || changed > 0} onClick={pop.toggle} data-tip="Advanced parameters">
        {changed ? <span className="num">{changed}</span> : null}
      </Chip>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={340} label="Advanced" className="pop-scroll">
        <PopoverHeader
          title="Advanced"
          sub={modelSummary(ref)?.name}
          right={
            changed ? (
              <button type="button" className="link-btn" onClick={() => update({ advanced: {}, extras: undefined, seed: undefined, negative: undefined })}>
                Reset
              </button>
            ) : undefined
          }
        />
        <div className="adv">
          {seed ? (
            <div className="adv-row">
              <span className="field-label">Seed</span>
              <div className="seed-input">
                <input
                  className="num-input num"
                  type="number"
                  value={settings.seed ?? ''}
                  placeholder="Random"
                  onChange={(e) => update({ seed: e.target.value === '' ? undefined : Math.round(Number(e.target.value)) })}
                />
                <button type="button" aria-label="Random seed" data-tip="Pick a random seed" onClick={() => update({ seed: randomSeed() })}>
                  <Dices size={14} />
                </button>
              </div>
            </div>
          ) : null}
          {negative ? (
            <label className="adv-row col">
              <span className="field-label">Negative prompt</span>
              <textarea className="text-area" rows={2} value={settings.negative ?? ''} placeholder="What to avoid" onChange={(e) => update({ negative: e.target.value || undefined })} />
            </label>
          ) : null}
          {others.filter((p) => p.type === 'multi').map((p) => (
            <MultiField key={p.key} kind={kind} p={p} />
          ))}
          {others.filter((p) => STRUCTURED_TYPES.has(p.type) && p.type !== 'multi' && !p.multiline).map((p) => (
            <StyleField key={p.key} kind={kind} p={p} />
          ))}
          {others.filter((p) => !STRUCTURED_TYPES.has(p.type)).map((p) => (
            <AdvancedField
              key={p.key}
              p={p}
              value={settings.advanced[p.key]}
              onChange={(v) => {
                const adv = { ...useStore.getState().composer[kind].settings.advanced };
                if (v === undefined || v === p.default) delete adv[p.key];
                else adv[p.key] = v;
                update({ advanced: adv });
              }}
            />
          ))}
          {schema.source === 'derived' ? <p className="set-note">Parameters for this model could not be loaded; it runs with provider defaults.</p> : null}
        </div>
      </Popover>
    </>
  );
}


/** Session subjects for Kling elements: create from attachments, mention as @Name. */
function SubjectsChip() {
  const ref = useStore((s) => s.composer.video.modelRef);
  const slot = useStore((s) => s.catalog.schemas[ref]?.slots.elements);
  // Without elements (Kling), subjects go as reference images (R10): any model that takes them.
  const takesRefs = useStore((s) => Boolean(s.catalog.schemas[ref]?.slots.images || s.catalog.schemas[ref]?.slots.mixedRefs));
  const sessionId = useStore((s) => s.activeSessionId);
  const subjects = useStore((s) => s.library);
  const attachments = useStore((s) => s.composer.attachments);
  const assets = useStore((s) => s.assets);
  const [name, setName] = useState('');
  const [voiceFor, setVoiceFor] = useState<string | null>(null);
  const pop = usePopover();
  if (!slot && !takesRefs) return null;
  const audio = attachments.find((id) => assets[id]?.kind === 'audio');
  const usable = attachments.some((id) => assets[id]?.kind === 'image' || (slot?.video && assets[id]?.kind === 'video'));
  const insert = (n: string) => setComposer((c) => ({ text: `${c.text}${c.text && !c.text.endsWith(' ') ? ' ' : ''}@${n} ` }));
  return (
    <>
      <Chip ref={pop.ref} icon={Users} active={pop.open} onClick={pop.toggle} aria-label="Subjects" data-tip="Subjects: mention them as @Name in the prompt">
        {subjects.length ? <span className="num">{subjects.length}</span> : null}
      </Chip>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={330} label="Subjects" className="pop-scroll">
        <PopoverHeader title="Subjects" sub={slot ? `Mention as @Name · up to ${slot.max} per video` : 'Mention as @Name · sent as reference images'} />
        <div className="subjects">
          {subjects.map((s) => (
            <div key={s.id} className="subject-row">
              <span className="subject-thumb">{s.frontalAssetId || s.videoAssetId ? <AssetMedia assetId={(s.frontalAssetId ?? s.videoAssetId)!} hoverPlay={false} draggable={false} /> : null}</span>
              <div className="subject-main">
                <button type="button" className="subject-name" onClick={() => insert(s.name)} data-tip="Insert in the prompt">
                  @{s.name}
                </button>
                <span className="faint">{s.videoAssetId && !s.frontalAssetId ? 'video' : `${1 + s.refAssetIds.length} view${s.refAssetIds.length ? 's' : ''}`}</span>
                {slot?.voice ? (
                  <div className="subject-voice-row">
                    <input className="subject-voice" placeholder="Voice ID (optional)" value={s.voiceId ?? ''} onChange={(e) => saveSubject({ ...s, voiceId: e.target.value.trim() || undefined })} />
                    <button type="button" className="link-btn" disabled={!audio} data-tip={audio ? 'Create a Kling voice from the attached audio' : 'Attach 5–30 s of speech first'} onClick={() => setVoiceFor(s.id)}>
                      From audio
                    </button>
                  </div>
                ) : null}
                {voiceFor === s.id ? (
                  <SpendConfirm
                    title={`Kling voice for @${s.name}`}
                    lines={['fal.ai creates the voice from the attached audio (5–30 s, one speaker).']}
                    estimate={{ usd: null, approximate: true, note: 'fal bills the voice when it is created' }}
                    confirmLabel="Create voice"
                    onConfirm={() => {
                      setVoiceFor(null);
                      void createSubjectVoice(sessionId, s.id);
                    }}
                    onCancel={() => setVoiceFor(null)}
                  />
                ) : null}
              </div>
              <IconButton icon={Trash} label="Delete subject" size="sm" tone="danger" onClick={() => deleteSubject(s.id)} />
            </div>
          ))}
          <div className="subject-new">
            <input placeholder="New subject name, e.g. Mia" value={name} onChange={(e) => setName(e.target.value)} />
            <Button
              size="sm"
              icon={Plus}
              disabled={!name.trim() || !usable}
              onClick={() => {
                const s = subjectFromAttachments(name);
                if (s) {
                  setName('');
                  insert(s.name);
                }
              }}
            >
              From attachments
            </Button>
            <p className="faint">Attach a frontal image first (plus up to {slot?.refMax ?? 3} more views{slot?.video ? ', or a short video' : ''}).</p>
          </div>
        </div>
      </Popover>
    </>
  );
}

/** Multi-shot storyboard: a prompt and seconds per shot, adding up to the clip length. */
function ShotsChip() {
  const ref = useStore((s) => s.composer.video.modelRef);
  const schema = useStore((s) => s.catalog.schemas[ref]);
  const settings = useStore((s) => s.composer.video.settings);
  const pop = usePopover();
  const slot = schema?.slots.shots;
  if (!slot) return null;
  const shots = settings.shots ?? [];
  const duration = settings.duration ?? (Number(paramByRole(schema, 'duration')?.default) || 5);
  const total = shots.reduce((t, s) => t + s.duration, 0);
  const set = (next: Array<{ prompt: string; duration: number }>) =>
    setComposerMedia('video', { settings: { ...useStore.getState().composer.video.settings, shots: next.length ? next : undefined } });
  const add = () => {
    if (!shots.length) {
      const half = Math.max(1, Math.floor(duration / 2));
      set([{ prompt: '', duration: half }, { prompt: '', duration: Math.max(1, duration - half) }]);
    } else if (shots.length < slot.max) set([...shots, { prompt: '', duration: 1 }]);
  };
  return (
    <>
      <Chip ref={pop.ref} icon={Clapperboard} active={pop.open || shots.length > 0} onClick={pop.toggle} aria-label="Shots" data-tip="Multi-shot storyboard">
        {shots.length ? <span className="num">{shots.length}</span> : null}
      </Chip>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={360} label="Shots" className="pop-scroll">
        <PopoverHeader
          title="Shots"
          sub={shots.length ? `${total} of ${duration} s` : 'One prompt per shot, in order'}
          right={
            shots.length ? (
              <button type="button" className="link-btn" onClick={() => set([])}>
                Clear
              </button>
            ) : undefined
          }
        />
        <div className="shots">
          {shots.map((sh, i) => (
            <div key={i} className="shot-row">
              <span className="num faint">{i + 1}</span>
              <textarea rows={2} value={sh.prompt} placeholder="What happens in this shot" onChange={(e) => set(shots.map((x, j) => (j === i ? { ...x, prompt: e.target.value } : x)))} />
              <input
                type="number"
                min={1}
                max={duration}
                className="num-input num"
                value={sh.duration}
                onChange={(e) => set(shots.map((x, j) => (j === i ? { ...x, duration: Math.max(1, Math.round(Number(e.target.value) || 1)) } : x)))}
              />
              <IconButton icon={Trash} label="Remove shot" size="sm" onClick={() => set(shots.filter((_, j) => j !== i))} />
            </div>
          ))}
          {shots.length && total !== duration ? <p className="shots-warn">Shots add up to {total} s; the clip is {duration} s.</p> : null}
          {shots.length < slot.max ? (
            <Button size="sm" variant="ghost" icon={Plus} onClick={add}>
              {shots.length ? 'Add shot' : 'Split into shots'}
            </Button>
          ) : null}
          {slot.exclusivePrompt && shots.length ? <p className="faint">With shots, the main prompt is not sent.</p> : null}
        </div>
      </Popover>
    </>
  );
}

/** Song lyrics (MiniMax Music / Lyrics): a text area with the model's section tags and its length limit. */
function LyricsChip({ kind }: { kind: MediaKind }) {
  const ref = useStore((s) => s.composer[kind].modelRef);
  const p = lyricsParam(useStore((s) => s.catalog.schemas[ref]));
  const value = useStore((s) => (p ? s.composer[kind].settings.extras?.[p.key] : undefined));
  const pop = usePopover();
  const taRef = useRef<HTMLTextAreaElement>(null);
  if (!p) return null;
  const text = typeof value === 'string' ? value : '';
  const over = p.max != null && text.trim().length > p.max;
  const insert = (tag: string) => {
    const ta = taRef.current;
    const at = ta?.selectionStart ?? text.length;
    const before = text.slice(0, at);
    const piece = `${before && !before.endsWith('\n') ? '\n' : ''}${tag}\n`;
    setExtra(kind, p, before + piece + text.slice(at));
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(at + piece.length, at + piece.length);
    });
  };
  return (
    <>
      <Chip ref={pop.ref} icon={FileText} active={pop.open || Boolean(text.trim())} onClick={pop.toggle} data-tip="Song lyrics">
        {text.trim() ? `${text.trim().split('\n').filter((l) => l.trim()).length} lines` : 'Lyrics'}
      </Chip>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={420} label="Lyrics">
        <PopoverHeader
          title="Lyrics"
          sub="One line per sung line, a blank line for a pause, section tags on their own line."
          right={
            text ? (
              <button type="button" className="link-btn" onClick={() => setExtra(kind, p, undefined)}>
                Clear
              </button>
            ) : undefined
          }
        />
        <div className="lyrics-editor">
          {p.tags?.length ? (
            <div className="lyrics-tags">
              {p.tags.map((t) => (
                <button key={t} type="button" className="option" onClick={() => insert(t)}>
                  {t}
                </button>
              ))}
            </div>
          ) : null}
          <textarea ref={taRef} className="text-area lyrics-text" rows={12} value={text} placeholder={'[Verse]\nFirst line of the song…'} onChange={(e) => setExtra(kind, p, e.target.value)} aria-label="Lyrics" />
          <span className={`lyrics-count num ${over ? 'field-error' : 'faint'}`}>
            {text.trim().length}
            {p.max != null ? ` / ${p.max}` : ''}
          </span>
        </div>
      </Popover>
    </>
  );
}

/** Contextual controls for image / video / audio / 3D mode. */
export function MediaControls({ kind }: { kind: MediaKind }) {
  const ref = useStore((s) => s.composer[kind].modelRef);
  const [, force] = useState(0);
  useEffect(() => {
    void ensureSchema(ref).then(() => force((n) => n + 1));
  }, [ref]);
  return (
    <>
      <ModelChip kind={kind} />
      <FormatChip kind={kind} />
      {kind === 'audio' || kind === 'model3d' ? <LyricsChip kind={kind} /> : null}
      {kind === 'video' ? <AudioChip /> : null}
      {kind === 'video' ? <SubjectsChip /> : null}
      {kind === 'video' ? <ShotsChip /> : null}
      <AdvancedChip kind={kind} />
    </>
  );
}
