import type { ReactNode } from 'react';
import { DEFAULT_JPEG_QUALITY, DEFAULT_PDF_PAGE, exportRows, PDF_PAPERS, pdfPage, type ExportSettings, type PdfPage, type PdfPaper } from '../../engine/design/exportSettings';
import { Pin, PinOff, Settings } from '../ui/icons';
import { setSettings, useStore } from '../../store/store';
import { Popover, usePopover } from '../ui/Popover';
import { Segmented } from './ExportFields';
import { InlineSelect, InlineSlider, InlineToggle } from './InlineControls';

type Patch = (options: Partial<ExportSettings>) => void;
const quality = { compress: 75, high: DEFAULT_JPEG_QUALITY };
const levelOf = (s: ExportSettings) => (s.maxKb !== undefined ? 'limit' : (s.quality ?? DEFAULT_JPEG_QUALITY) < 90 ? 'compress' : 'high');

interface Option { key: string; group: string; applies: boolean; /** Relevant to the current action: always in the main panel. */ contextual?: boolean; /** Different from the preset (or default): stays in the main panel. */ changed?: boolean; node: ReactNode }

/**
 * Every format option, in one list. An option shows in the main panel when the current action needs it (paper for a
 * PDF on paper, bleed for Print shop, text for SVG/PDF with text) or when the user changed it; the rest wait behind the gear.
 */
function options(settings: ExportSettings, baseline: ExportSettings, patch: Patch, hasText: boolean): Option[] {
  const rows = exportRows(settings);
  const has = (...formats: string[]) => rows.some((r) => formats.includes(r.format));
  const page = has('pdf') ? pdfPage(settings.pdf) : undefined;
  const pdfMode = !page ? 'screen' : settings.print ? 'print' : 'paper';
  const svg = settings.svg ?? {}, base = baseline.svg ?? {};
  const level = levelOf(settings);
  const pdf = has('pdf'), svgOut = has('svg'), lossy = has('jpg', 'webp');
  return [
    { key: 'text', group: 'PDF', applies: hasText && has('svg', 'pdf'), contextual: true,
      node: <Segmented label="Text" value={settings.text ?? 'fonts'} options={[{ value: 'fonts', label: 'Embed fonts' }, { value: 'paths', label: 'Convert to paths' }]} onChange={(t) => patch({ text: t })} /> },
    { key: 'paper', group: 'PDF', applies: !!page, contextual: true, node: page && <>
      <InlineSelect label="Paper" value={page.paper} options={Object.entries(PDF_PAPERS).map(([paper, { label }]) => ({ value: paper as PdfPaper, label }))} onChange={(paper) => patch({ pdf: { ...page, paper } })} />
      <Segmented label="Orientation" value={page.orientation} options={[{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }] as { value: PdfPage['orientation']; label: string }[]}
        onChange={(orientation) => patch({ pdf: { ...page, orientation } })} /></> },
    { key: 'print', group: 'PDF', applies: !!settings.print, contextual: true, node: settings.print && <>
      <InlineSlider label="Bleed" value={settings.print.bleedMm} min={0} max={10} step={0.5} unit="mm" onChange={(bleedMm) => patch({ print: { ...settings.print!, bleedMm } })} />
      <InlineToggle label="Crop marks" checked={settings.print.marks} onChange={(marks) => patch({ print: { ...settings.print!, marks } })} /></> },
    { key: 'pdf-page', group: 'PDF', applies: pdf,
      node: <Segmented label="PDF page" value={pdfMode} options={[{ value: 'screen', label: 'Screen' }, { value: 'paper', label: 'Paper' }, { value: 'print', label: 'Print shop' }]}
        onChange={(m) => patch({ pdf: m === 'screen' ? 'screen' : page ?? DEFAULT_PDF_PAGE, print: m === 'print' ? { bleedMm: 3, marks: false } : undefined })} /> },
    { key: 'ppi', group: 'PDF', applies: pdf && !!page, changed: (settings.ppi ?? 300) !== (baseline.ppi ?? 300),
      node: <InlineSlider label="Raster resolution" value={settings.ppi ?? 300} min={72} max={600} step={1} unit="ppi" allowManualOverflow onChange={(ppi) => patch({ ppi: Math.round(ppi) })} /> },
    { key: 'decimals', group: 'SVG', applies: svgOut, changed: (svg.decimals ?? 3) !== (base.decimals ?? 3),
      node: <InlineSlider label="Decimals" value={svg.decimals ?? 3} min={0} max={6} step={1} onChange={(decimals) => patch({ svg: { ...svg, decimals } })} /> },
    { key: 'minify', group: 'SVG', applies: svgOut, changed: !!svg.minify !== !!base.minify,
      node: <InlineToggle label="Minify" checked={!!svg.minify} onChange={(minify) => patch({ svg: { ...svg, minify } })} /> },
    { key: 'title', group: 'SVG', applies: svgOut, changed: (svg.metadata !== false) !== (base.metadata !== false),
      node: <InlineToggle label="Include title" checked={svg.metadata !== false} onChange={(metadata) => patch({ svg: { ...svg, metadata } })} /> },
    { key: 'quality', group: 'JPG · WebP', applies: lossy, contextual: true, changed: level !== levelOf(baseline) || settings.maxKb !== baseline.maxKb, node: <>
      <Segmented label="Quality" value={level} options={[{ value: 'compress', label: 'Compress' }, { value: 'high', label: 'High' }, { value: 'limit', label: 'Limit size' }]}
        onChange={(l) => patch(l === 'limit' ? { maxKb: settings.maxKb ?? 500 } : { maxKb: undefined, quality: quality[l] })} />
      {level === 'limit' && <InlineSlider label="Maximum" value={settings.maxKb ?? 500} min={10} max={2000} step={10} unit="KB" allowManualOverflow onChange={(maxKb) => patch({ maxKb: Math.round(maxKb) })} />}</> },
  ];
}

const noPins = [] as string[];
export const usePinned = () => useStore((st) => st.settings.designExportPinned) ?? noPins;

/** Pin an option to the main panel (or take it back): kept in app settings, not per document. */
export function PinButton({ id, label }: { id: string; label: string }) {
  const pinned = usePinned().includes(id);
  const Icon = pinned ? PinOff : Pin;
  return <button type="button" className="design-export-pin" aria-pressed={pinned} aria-label={`${pinned ? 'Unpin' : 'Pin'} ${label}`} data-tip={pinned ? 'Unpin' : 'Pin to panel'}
    onClick={() => setSettings((st) => ({ designExportPinned: pinned ? (st.designExportPinned ?? []).filter((k) => k !== id) : [...(st.designExportPinned ?? []), id] }))}><Icon size={13} /></button>;
}

const labels: Record<string, string> = { text: 'Text', paper: 'Paper', print: 'Bleed', 'pdf-page': 'PDF page', ppi: 'Raster resolution', decimals: 'Decimals', minify: 'Minify', title: 'Include title', quality: 'Quality' };
const inMain = (o: Option, pinned: string[]) => o.applies && (o.contextual || o.changed || pinned.includes(o.key));

/** The options the current action needs, plus anything the user changed. */
export function MainOptions({ settings, baseline, patch, hasText }: { settings: ExportSettings; baseline: ExportSettings; patch: Patch; hasText: boolean }) {
  const pinned = usePinned();
  const shown = options(settings, baseline, patch, hasText).filter((o) => inMain(o, pinned));
  return shown.length ? <div className="design-export-fields">{shown.map((o) => <div key={o.key} className="design-export-opt">{o.node}{pinned.includes(o.key) && <PinButton id={o.key} label={labels[o.key] ?? o.key} />}</div>)}</div> : null;
}

/** The rest of the options, grouped by format, behind the gear. */
export function GearOptions({ settings, baseline, patch, hasText, prefix, extra }: { settings: ExportSettings; baseline: ExportSettings; patch: Patch; hasText: boolean; prefix: boolean; extra?: ReactNode }) {
  const pinned = usePinned();
  const rest = options(settings, baseline, patch, hasText).filter((o) => o.applies && !inMain(o, pinned));
  const groups = [...new Set(rest.map((o) => o.group))];
  return <div className="design-export-fields">
    {prefix && <div className="design-export-opt"><label>Prefix
      <input value={settings.prefix ?? ''} maxLength={40} onChange={(e) => patch({ prefix: e.target.value || undefined })} />
    </label><PinButton id="prefix" label="Prefix" /></div>}
    {groups.map((g) => <div key={g} className="design-export-fields">
      <div className="menu-sep-label">{g}</div>
      {rest.filter((o) => o.group === g).map((o) => <div key={o.key} className="design-export-opt">{o.node}<PinButton id={o.key} label={labels[o.key] ?? o.key} /></div>)}
    </div>)}
    {extra}
  </div>;
}

/** The gear button beside Format. */
export function FormatGear(props: { settings: ExportSettings; baseline: ExportSettings; patch: Patch; hasText: boolean; prefix: boolean; extra?: ReactNode }) {
  const pop = usePopover();
  return <>
    <button type="button" ref={pop.ref} className="design-export-gear" aria-label="Format options" data-tip="Format options" aria-haspopup="dialog" aria-expanded={pop.open} onClick={pop.toggle}><Settings size={15} /></button>
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} placement="bottom-start" width={300} className="design-export-pop" label="Format options">
      <GearOptions {...props} />
    </Popover>
  </>;
}
