import { useState } from 'react';
import { exportRows, row, type ExportSettings } from '../../engine/design/exportSettings';
import { Button } from '../ui/primitives';
import { ExportMenu, ExportRows, formatOptions, Segmented, withRows } from './ExportFields';
import { FormatGear } from './ExportFormatOptions';
import { InlineColor, InlineToggle } from './InlineControls';

type Patch = (options: Partial<ExportSettings>) => void;
const group = (area: ExportSettings['area']) => (area === 'objects' || area === 'selection' ? 'selection' : area);

/** What to export, as one row: Canvas · Drawing · Selection (objects or pixels) · Layer. */
export function AreaRow({ settings, patch, picked, pixels }: { settings: ExportSettings; patch: Patch; picked: boolean; pixels: boolean }) {
  const current = group(settings.area);
  return <>
    <Segmented label="Export area" value={current} options={[{ value: 'canvas', label: 'Canvas' }, { value: 'content', label: 'Drawing' }, { value: 'selection', label: 'Selection' }, { value: 'layer', label: 'Layer' }]}
      onChange={(g) => patch({ area: g === 'selection' ? (pixels && !picked ? 'selection' : 'objects') : g })} />
    {current === 'selection' && <Segmented label="Selection of" value={settings.area} options={[{ value: 'objects', label: 'Objects' }, { value: 'selection', label: 'Pixels' }]} onChange={(area) => patch({ area })} />}
  </>;
}

/** Width, height and DPI, linked: DPI is the pixels per inch of the design at its 96-dpi size. */
export function ExportSize({ settings, patch, geometry }: { settings: ExportSettings; patch: Patch; geometry: { width: number; height: number; box: { w: number; h: number } } }) {
  const [draft, setDraft] = useState<{ key: string; text: string }>();
  const { box } = geometry;
  const fields = [
    { key: 'w', label: 'Width (px)', value: geometry.width, toWidth: (v: number) => v },
    { key: 'h', label: 'Height (px)', value: geometry.height, toWidth: (v: number) => v * box.w / box.h },
    { key: 'dpi', label: 'DPI', value: Math.round(96 * geometry.width / box.w), toWidth: (v: number) => v * box.w / 96 },
  ];
  void settings;
  return <div className="design-export-size">
    {fields.map((f) => <label key={f.key}>{f.label}
      <input type="number" min={1} step={1} value={draft?.key === f.key ? draft.text : f.value}
        onChange={(e) => {
          setDraft({ key: f.key, text: e.target.value });
          const v = Number(e.target.value);
          if (e.target.value && v > 0) patch({ size: 'width', pixels: Math.max(1, Math.round(f.toWidth(v))) });
        }}
        onBlur={() => setDraft(undefined)} />
    </label>)}
  </div>;
}

const colorName = (c: string) => (c.toLowerCase() === '#ffffff' ? 'White' : c.toLowerCase() === '#000000' ? 'Black' : c.toUpperCase());

/** One row: swatch, a readable value, and a Transparent switch (PNG and WebP only). */
export function BackgroundRow({ settings, patch, docBackground }: { settings: ExportSettings; patch: Patch; docBackground: string | null }) {
  const alpha = exportRows(settings).some((r) => r.format === 'png' || r.format === 'webp');
  const clear = alpha && (settings.background === null || (settings.background === undefined && !docBackground));
  const color = settings.background ?? docBackground ?? '#ffffff';
  return <div className="design-export-bgrow">
    <InlineColor label="Background color" iconOnly value={color} onChange={(background) => patch({ background })} />
    <span className="design-export-bgvalue">{clear ? 'Transparent' : colorName(color)}</span>
    {alpha && <InlineToggle label="Transparent" checked={clear} onChange={(on) => patch({ background: on ? null : docBackground ? undefined : '#ffffff' })} />}
  </div>;
}

/** Format menu with its gear, or the list of files when several scales are exported. */
export function FormatRow({ settings, patch, hasText }: { settings: ExportSettings; patch: Patch; hasText: boolean }) {
  const rows = exportRows(settings), multi = !!settings.outputs?.length;
  const page = rows.some((r) => r.format === 'pdf') && settings.pdf && settings.pdf !== 'screen';
  return <>
    <div className="design-export-formatrow">
      {!multi ? <ExportMenu label="Format" value={settings.format} options={formatOptions}
        onChange={(format) => patch({ format, ...(format !== 'png' && format !== 'webp' ? { background: undefined } : {}) })} />
        : <span className="design-export-hint">Files</span>}
      <FormatGear settings={settings} patch={patch} hasText={hasText} />
    </div>
    {multi && <ExportRows rows={rows} onChange={(next) => patch(withRows(next))} />}
    {multi && <p className="design-export-hint">{rows.length} files · packed in one ZIP</p>}
    {!multi && !page && <button type="button" className="opt opt-pick" onClick={() => patch({ outputs: [row(typeof settings.size === 'number' ? settings.size : 1, settings.format), row(2, settings.format, '@2x')], preset: undefined })}>
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
  if (mode === 'naming') return <div className="design-export-actions">
    <label>Preset name<input maxLength={60} value={name} onChange={(e) => { setName(e.target.value); setError(undefined); }} /></label>
    <div className="design-export-buttons">
      <Button size="sm" variant="ghost" onClick={() => { setMode(undefined); setError(undefined); }}>Cancel</Button>
      <Button size="sm" disabled={!name.trim()} onClick={() => {
        const problem = savePreset(name.trim());
        if (problem) setError(problem);
        else { setName(''); setMode(undefined); }
      }}>Save preset</Button>
    </div>
    {error && <p role="alert">{error}</p>}
  </div>;
  if (mode === 'deleting' && own) return <div className="design-export-actions">
    <p>Delete the preset “{own.name}”? Your exported files are not touched.</p>
    <div className="design-export-buttons">
      <Button size="sm" variant="ghost" onClick={() => setMode(undefined)}>Cancel</Button>
      <Button size="sm" onClick={() => { deletePreset(); setMode(undefined); }}>Delete preset</Button>
    </div>
  </div>;
  return <div className="design-export-buttons">
    {own && <Button size="sm" variant="ghost" onClick={() => setMode('deleting')}>Delete preset</Button>}
    <Button size="sm" onClick={() => setMode('naming')}>Save as preset</Button>
  </div>;
}
