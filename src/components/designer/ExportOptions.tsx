import { useState, type ReactNode } from 'react';
import { exportRows, row, type ExportArea, type ExportSettings } from '../../engine/design/exportSettings';
import { Button } from '../ui/primitives';
import { ExportMenu, ExportRows, formatOptions, OptText, withRows } from './ExportFields';
import { FormatGear } from './ExportFormatOptions';
import { InlineColor, InlineSelect, InlineSlider, InlineToggle } from './InlineControls';

type Patch = (options: Partial<ExportSettings>) => void;

/** What to export: one menu field. Selected objects and pixel selection are offered when they exist (or are the choice). */
export function AreaRow({ settings, patch, picked, pixels }: { settings: ExportSettings; patch: Patch; picked: boolean; pixels: boolean }) {
  const all: Array<{ value: ExportArea; label: string; ok: boolean }> = [
    { value: 'canvas', label: 'Canvas', ok: true },
    { value: 'content', label: 'Drawing', ok: true },
    { value: 'objects', label: 'Selected objects', ok: picked },
    { value: 'selection', label: 'Pixel selection', ok: pixels },
    { value: 'layer', label: 'Layer', ok: true },
  ];
  return <InlineSelect label="Area" value={settings.area} options={all.filter((a) => a.ok || a.value === settings.area).map(({ value, label }) => ({ value, label }))} onChange={(area) => patch({ area })} />;
}

/** Width, height and DPI, linked: DPI is the pixels per inch of the design at its 96-dpi size. */
export function ExportSize({ patch, geometry }: { patch: Patch; geometry: { width: number; height: number; box: { w: number; h: number } } }) {
  const { box } = geometry;
  const toWidth = (w: number) => patch({ size: 'width', pixels: Math.max(1, Math.round(w)) });
  return <>
    <div className="brush-row design-export-size">
      <InlineSlider label="W" tip="Width" log min={16} max={16384} unit="px" typedRange={[1, 32768]} value={geometry.width} onChange={toWidth} />
      <InlineSlider label="H" tip="Height" log min={16} max={16384} unit="px" typedRange={[1, 32768]} value={geometry.height} onChange={(h) => toWidth(h * box.w / box.h)} />
    </div>
    <div className="brush-row design-export-size">
      <InlineSlider label="DPI" min={24} max={1200} step={1} allowManualOverflow value={Math.round(96 * geometry.width / box.w)} onChange={(dpi) => toWidth(dpi * box.w / 96)} />
    </div>
  </>;
}

/** Background: the color field, and a Transparent switch beside it for PNG and WebP. */
export function BackgroundRow({ settings, patch, docBackground }: { settings: ExportSettings; patch: Patch; docBackground: string | null }) {
  const alpha = exportRows(settings).some((r) => r.format === 'png' || r.format === 'webp');
  const clear = alpha && (settings.background === null || (settings.background === undefined && !docBackground));
  const color = settings.background ?? docBackground ?? '#ffffff';
  return <div className="brush-row design-export-bg">
    {!clear && <InlineColor label="Background" showValue value={color} onChange={(background) => patch({ background })} />}
    {alpha && <InlineToggle label="Transparent" checked={clear} onChange={(on) => patch({ background: on ? null : docBackground ? undefined : '#ffffff' })} />}
  </div>;
}

/** Format with its gear, the rows when several files are exported, and Add scale. */
export function FormatRow({ settings, baseline, patch, hasText, gear }: { settings: ExportSettings; baseline: ExportSettings; patch: Patch; hasText: boolean; gear?: ReactNode }) {
  const rows = exportRows(settings), multi = !!settings.outputs?.length;
  const page = rows.some((r) => r.format === 'pdf') && settings.pdf && settings.pdf !== 'screen';
  return <>
    <div className="brush-row">
      {!multi && <ExportMenu label="Format" value={settings.format} options={formatOptions}
        onChange={(format) => patch({ format, ...(format !== 'png' && format !== 'webp' ? { background: undefined } : {}) })} />}
      {multi && <span className="opt design-export-files"><span className="opt-label">{rows.length} files</span></span>}
      <FormatGear settings={settings} baseline={baseline} patch={patch} hasText={hasText}>{gear}</FormatGear>
    </div>
    {multi && <ExportRows rows={rows} onChange={(next) => patch(withRows(next))} />}
    {!multi && !page && <button type="button" className="opt opt-pick design-export-add" onClick={() => patch({ outputs: [row(typeof settings.size === 'number' ? settings.size : 1, settings.format), row(2, settings.format, '@2x')], preset: undefined })}>
      <span className="opt-label">+ Add scale</span>
    </button>}
  </>;
}

/** Save the current settings as a preset; delete one of your own after an inline confirmation. */
export function PresetActions({ savePreset, own, deletePreset }: {
  savePreset: (name: string) => string | undefined;
  own?: { name: string };
  deletePreset: () => void;
}) {
  const [mode, setMode] = useState<'naming' | 'deleting'>();
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  if (mode === 'naming') return <>
    <OptText label="Preset name" value={name} maxLength={60} onChange={(v) => { setName(v); setError(undefined); }} />
    <div className="design-export-buttons">
      <Button size="sm" variant="ghost" onClick={() => { setMode(undefined); setError(undefined); }}>Cancel</Button>
      <Button size="sm" disabled={!name.trim()} onClick={() => {
        const problem = savePreset(name.trim());
        if (problem) setError(problem);
        else { setName(''); setMode(undefined); }
      }}>Save preset</Button>
    </div>
    {error && <p className="opt-hint" role="alert">{error}</p>}
  </>;
  if (mode === 'deleting' && own) return <div className="design-export-buttons">
    <span className="opt-hint">Delete “{own.name}”?</span>
    <Button size="sm" variant="ghost" onClick={() => setMode(undefined)}>Cancel</Button>
    <Button size="sm" onClick={() => { deletePreset(); setMode(undefined); }}>Delete preset</Button>
  </div>;
  return <div className="design-export-buttons">
    {own && <Button size="sm" variant="ghost" onClick={() => setMode('deleting')}>Delete preset</Button>}
    <Button size="sm" onClick={() => setMode('naming')}>Save as preset</Button>
  </div>;
}
