import { useState } from 'react';
import { DEFAULT_JPEG_QUALITY, DEFAULT_PDF_PAGE, exportRows, PDF_PAPERS, pdfPage, row, type ExportSettings, type PdfPage, type PdfPaper } from '../../engine/design/exportSettings';
import { Button } from '../ui/primitives';
import { ExportMenu, ExportRows, formatOptions, Hint, withRows } from './ExportFields';
import { InlineChoice, InlineColor, InlineSelect, InlineSlider, InlineToggle } from './InlineControls';

const quality = { compress: 75, high: DEFAULT_JPEG_QUALITY };

/** Only the fields that apply to what is being exported. */
export function ExportOptions({ settings, patch, geometry, areaOptions }: {
  settings: ExportSettings;
  patch: (options: Partial<ExportSettings>) => void;
  geometry?: { width: number; height: number };
  areaOptions: { value: ExportSettings['area']; label: string }[];
}) {
  const rows = exportRows(settings), multi = !!settings.outputs?.length;
  const has = (...formats: string[]) => rows.some((r) => formats.includes(r.format));
  const page = has('pdf') ? pdfPage(settings.pdf) : undefined;
  const pdfMode = !page ? 'screen' : settings.print ? 'print' : 'paper';
  const lossy = has('jpg', 'webp');
  const mode = settings.size === 'width' ? 'width' : settings.size === 'long-side' ? 'long-side' : 'scale';
  const level = settings.maxKb !== undefined ? 'limit' : (settings.quality ?? DEFAULT_JPEG_QUALITY) < 90 ? 'compress' : 'high';
  const svg = settings.svg ?? {};
  const showSize = !multi && !page;
  return <div className="design-export-fields">
    {!multi ? <ExportMenu label="Format" value={settings.format} options={formatOptions}
      onChange={(format) => patch({ format, ...(format !== 'png' && format !== 'webp' ? { background: undefined } : {}) })} />
      : <ExportRows rows={rows} onChange={(next) => patch(withRows(next))} />}
    {!multi && <button type="button" className="opt opt-pick" onClick={() => patch({ outputs: [row(typeof settings.size === 'number' ? settings.size : 1, settings.format), row(2, settings.format, '@2x')], preset: undefined })}>
      <span className="opt-label">+ Add scale</span>
    </button>}
    {multi && <Hint>{rows.length} files · packed in one ZIP</Hint>}
    <InlineSelect label="What to export" value={settings.area} options={areaOptions} onChange={(area) => patch({ area })} />
    {showSize && <>
      <InlineChoice label="Size by" value={mode} options={[{ value: 'scale', label: 'Scale' }, { value: 'width', label: 'Width' }, { value: 'long-side', label: 'Long side' }]}
        onChange={(m) => patch(m === 'scale' ? { size: 1 } : { size: m, pixels: settings.pixels ?? geometry?.width ?? 1000 })} />
      {mode === 'scale'
        ? <InlineSlider label="Scale" value={typeof settings.size === 'number' ? settings.size : 1} min={0.25} max={4} step={0.25} unit="×" typedRange={[0.1, 8]} onChange={(size) => patch({ size })} />
        : <InlineSlider label={mode === 'width' ? 'Width' : 'Long side'} value={settings.pixels ?? 1000} min={16} max={4096} step={1} unit="px" allowManualOverflow onChange={(pixels) => patch({ pixels: Math.round(pixels) })} />}
    </>}
    {lossy && <>
      <InlineChoice label="Quality" value={level} options={[{ value: 'compress', label: 'Compress' }, { value: 'high', label: 'High' }, { value: 'limit', label: 'Limit size' }]}
        onChange={(l) => patch(l === 'limit' ? { maxKb: settings.maxKb ?? 500 } : { maxKb: undefined, quality: quality[l] })} />
      {level === 'limit' && <InlineSlider label="Maximum" value={settings.maxKb ?? 500} min={10} max={2000} step={10} unit="KB" allowManualOverflow onChange={(maxKb) => patch({ maxKb: Math.round(maxKb) })} />}
    </>}
    {has('png', 'webp') && <>
      <InlineToggle label="Transparent background" checked={settings.background === null} onChange={(on) => patch({ background: on ? null : undefined })} />
      {typeof settings.background === 'string' && <InlineColor label="Background color" value={settings.background} onChange={(background) => patch({ background })} showValue />}
      {settings.background === undefined && <button type="button" className="opt opt-pick" onClick={() => patch({ background: '#ffffff' })}><span className="opt-label">Solid background color</span></button>}
    </>}
    {has('pdf') && <>
      <InlineChoice label="PDF page" value={pdfMode} options={[{ value: 'screen', label: 'Screen' }, { value: 'paper', label: 'Paper' }, { value: 'print', label: 'Print shop' }]}
        onChange={(m) => patch({ pdf: m === 'screen' ? 'screen' : page ?? DEFAULT_PDF_PAGE, print: m === 'print' ? { bleedMm: 3, marks: true } : undefined })} />
      {page && <>
        <InlineSelect label="Paper" value={page.paper} options={Object.entries(PDF_PAPERS).map(([paper, { label }]) => ({ value: paper as PdfPaper, label }))} onChange={(paper) => patch({ pdf: { ...page, paper } })} />
        <InlineChoice label="Orientation" value={page.orientation} options={[{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }] as { value: PdfPage['orientation']; label: string }[]}
          onChange={(orientation) => patch({ pdf: { ...page, orientation } })} />
      </>}
      {settings.print && <>
        <InlineSlider label="Bleed" value={settings.print.bleedMm} min={0} max={10} step={0.5} unit="mm" onChange={(bleedMm) => patch({ print: { ...settings.print!, bleedMm } })} />
        <InlineToggle label="Crop marks" checked={settings.print.marks} onChange={(marks) => patch({ print: { ...settings.print!, marks } })} />
      </>}
    </>}
    {has('svg') && <>
      <InlineSlider label="SVG decimals" value={svg.decimals ?? 3} min={0} max={6} step={1} onChange={(decimals) => patch({ svg: { ...svg, decimals } })} />
      <InlineToggle label="Minify SVG" checked={!!svg.minify} onChange={(minify) => patch({ svg: { ...svg, minify } })} />
      <InlineToggle label="Include title" checked={svg.metadata !== false} onChange={(metadata) => patch({ svg: { ...svg, metadata } })} />
      <Hint>Fonts are not embedded in SVG: text keeps the font name.</Hint>
    </>}
  </div>;
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
