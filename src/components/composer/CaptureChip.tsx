import { Camera } from 'lucide-react';
import { DIRECTIVES, IMPERFECTIONS, LEGACY_PRESETS, TONES, presetById, presetsFor, type CaptureSel } from '../../engine/captureStyles';
import type { GenSettings } from '../../engine/types';
import { setComposerMedia, useStore } from '../../store/store';
import { Popover, PopoverHeader, usePopover } from '../ui/Popover';
import { Chip, Toggle } from '../ui/primitives';

/** Estilo de captura (cámara, tono, luz, textura), directivas de video e imperfecciones, tras un solo icono. */
export function CaptureChip({ kind }: { kind: 'image' | 'video' }) {
  const settings = useStore((s) => s.composer[kind].settings);
  const library = useStore((s) => s.library);
  const pop = usePopover();
  const cap = settings.capture;
  const mine = library.filter((s) => s.kind === 'style' && s.capture);
  const legacy = LEGACY_PRESETS.find((l) => !cap && settings.realism === l.realism && (l.shot ?? undefined) === settings.shot);
  const preset = presetById(cap?.style);
  const label = cap?.custom && !preset ? cap.style ?? 'Mi estilo' : preset ? preset.label : legacy?.label ?? 'Natural';
  const put = (patch: Partial<GenSettings>) => setComposerMedia(kind, { settings: { ...settings, ...patch } });
  const setCap = (next: CaptureSel | undefined) => put({ capture: next && Object.keys(next).length ? next : undefined });
  const pick = (next: CaptureSel | undefined, reg?: { realism: GenSettings['realism']; shot?: string }) =>
    put({ capture: next, realism: reg?.realism, shot: reg?.shot });
  const tone = cap?.tone ?? preset?.tone ?? cap?.custom?.tone;
  const hasStyle = Boolean(preset || cap?.custom);
  const imperfect = cap?.imperfect ?? preset?.imperfect ?? cap?.custom?.imperfect ?? [];
  const toggle = (list: string[] | undefined, id: string) => (list?.includes(id) ? list.filter((x) => x !== id) : [...(list ?? []), id]);
  const on = Boolean(cap || legacy);
  return (
    <>
      <Chip ref={pop.ref} icon={Camera} active={pop.open || on} onClick={pop.toggle} aria-label="Estilo de captura" data-card="Captura" data-tip="Estilo de captura: cámara, tono, luz y textura">
        <span className="card-value">{label}</span>
      </Chip>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={320} label="Estilo de captura" className="pop-scroll">
        <PopoverHeader title="Estilo de captura" sub="Cámara · tono · luz · textura" />
        <div className="sessions-view">
          <div className="sv-row">
            <span className="sv-label">Estilo</span>
            <div className="sv-canvas">
              <button type="button" className={`canvas-tab ${!cap && !legacy ? 'is-on' : ''}`} onClick={() => pick(undefined)}>Natural</button>
              {LEGACY_PRESETS.map((l) => (
                <button key={l.id} type="button" className={`canvas-tab ${legacy?.id === l.id ? 'is-on' : ''}`} onClick={() => pick(undefined, { realism: l.realism, shot: l.shot })}>{l.label}</button>
              ))}
              {presetsFor(kind).map((p) => (
                <button key={p.id} type="button" className={`canvas-tab ${cap?.style === p.id ? 'is-on' : ''}`} onClick={() => setCap({ ...(kind === 'video' && cap?.directives ? { directives: cap.directives } : {}), style: p.id })} data-tip={p.camera}>{p.label}</button>
              ))}
            </div>
          </div>
          {mine.length ? (
            <div className="sv-row">
              <span className="sv-label">Mis estilos</span>
              <div className="sv-canvas">
                {mine.map((s) => (
                  <button key={s.id} type="button" className={`canvas-tab ${cap?.style === s.name && cap.custom ? 'is-on' : ''}`} onClick={() => setCap({ ...(kind === 'video' && cap?.directives ? { directives: cap.directives } : {}), style: s.name, custom: s.capture })} data-tip={s.capture!.camera}>{s.name}</button>
                ))}
              </div>
            </div>
          ) : null}
          {hasStyle ? (
            <div className="sv-row">
              <span className="sv-label">Tono</span>
              <div className="sv-canvas">
                {[...new Set([...(tone ? [tone] : []), ...TONES])].map((t) => (
                  <button key={t} type="button" className={`canvas-tab ${tone === t ? 'is-on' : ''}`} onClick={() => setCap({ ...cap, tone: t })}>{t}</button>
                ))}
              </div>
            </div>
          ) : null}
          {kind === 'video' ? (
            <div className="sv-row">
              <span className="sv-label">Cámara (combinables)</span>
              {DIRECTIVES.map((d) => (
                <label key={d.id} className="sv-switch"><span>{d.label}</span><Toggle checked={Boolean(cap?.directives?.includes(d.id))} onChange={() => setCap({ ...cap, directives: toggle(cap?.directives, d.id) })} label={d.label} /></label>
              ))}
            </div>
          ) : null}
          <div className="sv-row">
            <span className="sv-label">Imperfecciones (solo si las quieres)</span>
            {IMPERFECTIONS.map((i) => (
              <label key={i.id} className="sv-switch"><span>{i.label}</span><Toggle checked={imperfect.includes(i.id)} onChange={() => setCap({ ...cap, imperfect: toggle(imperfect, i.id) })} label={i.label} /></label>
            ))}
          </div>
        </div>
      </Popover>
    </>
  );
}
