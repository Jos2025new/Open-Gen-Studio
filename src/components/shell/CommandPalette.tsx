import { useEffect, useMemo, useRef, useState } from 'react';
import { command, invoke } from '../../engine/commands';
import type { Target } from '../../engine/commands';
import { activeDoc } from '../../engine/design/actions';
import { useStore } from '../../store/store';
import { ArrowLeft, BookOpen, Cpu, LayoutGrid, Library, MessageSquare, Palette, Search, Sparkles, Workflow, X, type LucideIcon } from '../ui/icons';
import { MenuItem, Toggle } from '../ui/primitives';
import { areaName, buildArgs, effectNote, isPaletteKey, paletteSections, rememberRun, type PaletteField, type PaletteRow } from './commandPaletteModel';
import './CommandPalette.css';

const ICONS: Record<string, LucideIcon> = { designer: Palette, nodes: Workflow, studio: Sparkles, library: Library, skills: BookOpen, models: Cpu, sessions: MessageSquare };
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
type Values = Record<string, string | boolean | undefined>;

/** The command palette (Ctrl+K / Cmd+K) over the command registry. Mounted once in the app shell. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isPaletteKey(e)) return;
      e.preventDefault();
      setOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return open ? <Panel onClose={() => setOpen(false)} /> : null;
}

function Panel({ onClose }: { onClose: () => void }) {
  const workspace = useStore((s) => s.ui.workspace);
  const sessionId = useStore((s) => s.activeSessionId);
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const [step, setStep] = useState<PaletteRow | null>(null);
  const [values, setValues] = useState<Values>({});
  const [error, setError] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const doc = activeDoc(sessionId);
  const on: Target = useMemo(() => ({ session: sessionId, ...(doc ? { doc: doc.id } : {}) }), [sessionId, doc]);
  const sections = useMemo(() => paletteSections({ query, on, workspace }), [query, on, workspace]);
  const rows = sections.flatMap((s) => s.rows);

  useEffect(() => {
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [onClose]);
  useEffect(() => { setAt(0); }, [query]);
  useEffect(() => { box.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus(); }, [step]);

  const execute = (row: PaletteRow, given: Values) => {
    const spec = command(row.id);
    if (!spec) return;
    const parsed = spec.args.safeParse(buildArgs(row.fields, given));
    if (!parsed.success) { setStep(row); setError(parsed.error.issues.map((i) => `${i.path.join('.') || 'args'}: ${i.message}`).join('; ')); return; }
    const fail = (e: unknown) => { setStep(row); setError(messageOf(e)); };
    const done = () => { rememberRun(row.id); onClose(); };
    try {
      const out: unknown = invoke(spec, parsed.data, on);
      if (out && typeof (out as Promise<unknown>).then === 'function') (out as Promise<unknown>).then(done, fail);
      else done();
    } catch (e) {
      fail(e);
    }
  };
  const choose = (row: PaletteRow) => {
    if (row.available !== true) return;
    if (row.needsStep) { setStep(row); setValues({}); setError(''); return; }
    execute(row, {});
  };
  const back = () => { setStep(null); setError(''); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (step) back(); else onClose(); return; }
    if (step) { if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') { e.preventDefault(); execute(step, values); } return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (rows.length) setAt((i) => (i + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length);
    } else if (e.key === 'Enter' && rows[at]) { e.preventDefault(); choose(rows[at]); }
  };

  return (
    <div ref={box} className="popover cmd-palette" role="dialog" aria-label="Command palette" onKeyDown={onKeyDown}>
      {step ? (
        <Form row={step} values={values} setValues={setValues} error={error} onBack={back} onRun={() => execute(step, values)} layers={doc?.layers.map((l) => ({ id: l.id, name: l.name })) ?? []} />
      ) : (
        <>
          <div className="cp-search">
            <Search size={14} />
            <input data-autofocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search commands" aria-label="Search commands" />
            {query ? <button type="button" aria-label="Clear search" onClick={() => setQuery('')}><X size={13} /></button> : null}
          </div>
          <div className="cp-list">
            {sections.map((section) => (
              <div key={section.label ?? 'results'}>
                {section.label ? <div className="cp-label">{section.label}</div> : null}
                {section.rows.map((row) => {
                  const index = rows.indexOf(row);
                  return (
                    <div key={`${section.label}-${row.id}`} className={row.available === true ? '' : 'cp-dim'} onMouseEnter={() => setAt(index)}>
                      <MenuItem icon={ICONS[row.area] ?? LayoutGrid} label={row.title} right={row.detail ? <span className="cp-detail">{row.detail}</span> : undefined} active={index === at} onClick={() => choose(row)} />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Form({ row, values, setValues, error, onBack, onRun, layers }: { row: PaletteRow; values: Values; setValues: (v: Values) => void; error: string; onBack: () => void; onRun: () => void; layers: Array<{ id: string; name: string }> }) {
  const set = (name: string, v: string | boolean) => setValues({ ...values, [name]: v });
  return (
    <>
      <div className="cp-head">
        <button type="button" aria-label="Back" onClick={onBack}><ArrowLeft size={14} /></button>
        <span className="cp-area">{areaName(row.id)} ›</span>
        <span className="cp-title">{row.title}{effectNote(row.effect)}</span>
      </div>
      <div className="cp-fields">
        {row.fields.map((f, i) => (
          <label key={f.name} className="cp-field">
            <span>{f.name}</span>
            <Control field={f} value={values[f.name]} layers={layers} first={i === 0} onChange={(v) => set(f.name, v)} />
          </label>
        ))}
      </div>
      {error ? <div className="cp-error" role="alert">{error}</div> : null}
      <div className="cp-foot"><button type="button" className="btn btn-primary" data-autofocus={row.fields.length ? undefined : ''} onClick={onRun}>Run</button></div>
    </>
  );
}

function Control({ field, value, layers, first, onChange }: { field: PaletteField; value: string | boolean | undefined; layers: Array<{ id: string; name: string }>; first: boolean; onChange: (v: string | boolean) => void }) {
  const focus = first ? { 'data-autofocus': '' } : {};
  if (field.kind === 'boolean') return <Toggle checked={value === true || (value === undefined && field.default === true)} label={field.name} onChange={onChange} />;
  if (field.kind === 'enum' || field.kind === 'layer') {
    const options = field.kind === 'layer' ? layers.map((l) => ({ value: l.id, label: l.name })) : (field.options ?? []).map((o) => ({ value: o, label: o }));
    return (
      <select {...focus} value={(value as string | undefined) ?? (field.required ? '' : '')} onChange={(e) => onChange(e.target.value)}>
        <option value="">{field.required ? 'Choose' : ''}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  const numeric = field.kind === 'number' || field.kind === 'integer';
  return <input {...focus} type={numeric ? 'number' : 'text'} step={field.kind === 'integer' ? 1 : 'any'} value={(value as string | undefined) ?? (field.default !== undefined ? String(field.default) : '')} onChange={(e) => onChange(e.target.value)} />;
}
