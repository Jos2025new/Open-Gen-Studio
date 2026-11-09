import { useState, type ReactNode } from 'react';
import { exportRows, row, type ExportArea, type ExportSettings } from '../../engine/design/exportSettings';
import { Button, Segmented } from '../ui/primitives';
import { ExportMenu, ExportRows, formatOptions, OptText, withRows } from './ExportFields';
import { FormatGear } from './ExportFormatOptions';
import { InlineColor, InlineSelect, InlineSlider, InlineToggle } from './InlineControls';

type Patch = (options: Partial<ExportSettings>) => void;

/** What to export, as the app's tabs: Canvas · Drawing · Selection · Layer. Selection means the picked objects when
 * there are some, else the pixel selection; with both, a field below chooses. */
export function AreaTabs({ settings, patch, picked, pixels }: { settings: ExportSettings; patch: Patch; picked: boolean; pixels: boolean }) {
  const tab = settings.area === 'objects' ? 'selection' : settings.area;
  return <>
    <div className="design-export-tabs">
      <Segmented<'canvas' | 'content' | 'selection' | 'layer'> size="sm" value={tab} onChange={(t) => patch({ area: t === 'selection' ? (picked || !pixels ? 'objects' : 'selection') : t })}
        options={[{ value: 'canvas', label: 'Canvas' }, { value: 'content', label: 'Drawing' }, { value: 'selection', label: 'Selection', disabled: !picked && !pixels && tab !== 'selection', tip: 'Select objects or an area first' }, { value: 'layer', label: 'Layer' }]} />
    </div>
    {tab === 'selection' && picked && pixels && <div className="brush-row"><InlineSelect<ExportArea> label="Selection" value={settings.area} options={[{ value: 'objects', label: 'Objects' }, { value: 'selection', label: 'Pixels' }]} onChange={(area) => patch({ area })} /></div>}
  </>;
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

/** Background, beside the preview it changes: a Transparent switch (PNG and WebP) and the color. */
export function BackgroundFields({ settings, patch, docBackground }: { settings: ExportSettings; patch: Patch; docBackground: string | null }) {
  const alpha = exportRows(settings).some((r) => r.format === 'png' || r.format === 'webp');
  const clear = alpha && (settings.background === null || (settings.background === undefined && !docBackground));
  const color = settings.background ?? docBackground ?? '#ffffff';
  return <>
    {alpha && <InlineToggle label="Transparent" checked={clear} onChange={(on) => patch({ background: on ? null : docBackground ? undefined : '#ffffff' })} />}
    {!clear && <InlineColor label="Background" showValue value={color} onChange={(background) => patch({ background })} />}
  </>;
}

/** The output bar: file name, format and its gear on one line (the file count when several are exported). */
export function OutputBar({ settings, baseline, patch, hasText, gear, name }: { settings: ExportSettings; baseline: ExportSettings; patch: Patch; hasText: boolean; gear?: ReactNode; name: ReactNode }) {
  const multi = !!settings.outputs?.length;
  return <div className="brush-row design-export-bar">
    {name}
    {!multi && <ExportMenu bare label="Format" value={settings.format} options={formatOptions}
      onChange={(format) => patch({ format, ...(format !== 'png' && format !== 'webp' ? { background: undefined } : {}) })} />}
    <FormatGear settings={settings} baseline={baseline} patch={patch} hasText={hasText}>{gear}</FormatGear>
  </div>;
}

/** Several files: one row each (scale, suffix, format), or the button that starts them. */
export function ScaleRows({ settings, patch }: { settings: ExportSettings; patch: Patch }) {
  const rows = exportRows(settings), multi = !!settings.outputs?.length;
  const page = rows.some((r) => r.format === 'pdf') && settings.pdf && settings.pdf !== 'screen';
  if (multi) return <ExportRows rows={rows} onChange={(next) => patch(withRows(next))} />;
  return page ? null : <button type="button" className="opt opt-pick design-export-add" onClick={() => patch({ outputs: [row(typeof settings.size === 'number' ? settings.size : 1, settings.format), row(2, settings.format, '@2x')], preset: undefined })}>
    <span className="opt-label">+ Add scale</span>
  </button>;
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
