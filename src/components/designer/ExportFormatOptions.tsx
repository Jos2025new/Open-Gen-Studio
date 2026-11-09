import { Fragment, type ReactNode } from 'react';
import { DEFAULT_JPEG_QUALITY, DEFAULT_PDF_PAGE, exportRows, PDF_PAPERS, pdfPage, type ExportSettings, type PdfPage, type PdfPaper } from '../../engine/design/exportSettings';
import { Pin, PinOff, RectangleHorizontal, Settings } from '../ui/icons';
import { setSettings, useStore } from '../../store/store';
import { Popover, usePopover } from '../ui/Popover';
import { InlineChoice, InlineSelect, InlineSlider, InlineToggle } from './InlineControls';

type Patch = (options: Partial<ExportSettings>) => void;
const quality = { compress: 75, high: DEFAULT_JPEG_QUALITY };
type Level = 'compress' | 'high' | 'limit';
const levelOf = (s: ExportSettings): Level => (s.maxKb !== undefined ? 'limit' : (s.quality ?? DEFAULT_JPEG_QUALITY) < 90 ? 'compress' : 'high');
const portrait = <RectangleHorizontal size={14} style={{ transform: 'rotate(90deg)' }} />;

interface Option { key: string; label: string; group: string; applies: boolean; /** The current action needs it: always in the main panel. */ contextual?: boolean; /** Differs from the preset or default: stays in the main panel. */ changed?: boolean; node: ReactNode }

/**
 * Every format option in one list, each drawn with the Designer's own fields (one row, or two side by side).
 * An option shows in the main panel when the action needs it, when it was changed, or when it is pinned;
 * the rest wait behind the gear.
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
    { key: 'pdf-page', label: 'PDF page', group: 'PDF', applies: pdf,
      node: <InlineSelect label="PDF page" value={pdfMode} options={[{ value: 'screen', label: 'Screen' }, { value: 'paper', label: 'Paper' }, { value: 'print', label: 'Print shop' }]}
        onChange={(m) => patch({ pdf: m === 'screen' ? 'screen' : page ?? DEFAULT_PDF_PAGE, print: m === 'print' ? { bleedMm: 3, marks: false } : undefined })} /> },
    { key: 'paper', label: 'Paper', group: 'PDF', applies: !!page, contextual: true, node: page &&
      <InlineSelect label="Paper" value={page.paper} options={Object.entries(PDF_PAPERS).map(([paper, { label }]) => ({ value: paper as PdfPaper, label }))} onChange={(paper) => patch({ pdf: { ...page, paper } })} /> },
    { key: 'orientation', label: 'Orientation', group: 'PDF', applies: !!page, contextual: true, node: page &&
      <InlineChoice label="Orientation" value={page.orientation} options={[{ value: 'portrait', label: 'Portrait', render: portrait }, { value: 'landscape', label: 'Landscape', render: <RectangleHorizontal size={14} /> }] as { value: PdfPage['orientation']; label: string; render: ReactNode }[]}
        onChange={(orientation) => patch({ pdf: { ...page, orientation } })} /> },
    { key: 'print', label: 'Bleed', group: 'PDF', applies: !!settings.print, contextual: true, node: settings.print && <>
      <InlineSlider label="Bleed" value={settings.print.bleedMm} min={0} max={10} step={0.5} unit="mm" onChange={(bleedMm) => patch({ print: { ...settings.print!, bleedMm } })} />
      <InlineToggle label="Crop marks" checked={settings.print.marks} onChange={(marks) => patch({ print: { ...settings.print!, marks } })} /></> },
    { key: 'text', label: 'Text', group: 'PDF · SVG', applies: hasText && has('svg', 'pdf'), contextual: true,
      node: <InlineSelect label="Text" value={settings.text ?? 'fonts'} options={[{ value: 'fonts', label: 'Embed fonts' }, { value: 'paths', label: 'Convert to paths' }]} onChange={(text) => patch({ text })} /> },
    { key: 'ppi', label: 'Raster resolution', group: 'PDF', applies: pdf && !!page, changed: (settings.ppi ?? 300) !== (baseline.ppi ?? 300),
      node: <InlineSlider label="Raster resolution" value={settings.ppi ?? 300} min={72} max={600} step={1} unit="ppi" allowManualOverflow onChange={(ppi) => patch({ ppi: Math.round(ppi) })} /> },
    { key: 'decimals', label: 'Decimals', group: 'SVG', applies: svgOut, changed: (svg.decimals ?? 3) !== (base.decimals ?? 3),
      node: <InlineSlider label="Decimals" value={svg.decimals ?? 3} min={0} max={6} step={1} onChange={(decimals) => patch({ svg: { ...svg, decimals } })} /> },
    { key: 'minify', label: 'Minify', group: 'SVG', applies: svgOut, changed: !!svg.minify !== !!base.minify,
      node: <InlineToggle label="Minify" checked={!!svg.minify} onChange={(minify) => patch({ svg: { ...svg, minify } })} /> },
    { key: 'title', label: 'Include title', group: 'SVG', applies: svgOut, changed: (svg.metadata !== false) !== (base.metadata !== false),
      node: <InlineToggle label="Include title" checked={svg.metadata !== false} onChange={(metadata) => patch({ svg: { ...svg, metadata } })} /> },
    { key: 'quality', label: 'Quality', group: 'JPG · WebP', applies: lossy, contextual: true, changed: level !== levelOf(baseline) || settings.maxKb !== baseline.maxKb, node: <>
      <InlineSelect label="Quality" value={level} options={[{ value: 'compress' as Level, label: 'Compress' }, { value: 'high' as Level, label: 'High' }, { value: 'limit' as Level, label: 'Limit size' }]}
        onChange={(l) => patch(l === 'limit' ? { maxKb: settings.maxKb ?? 500 } : { maxKb: undefined, quality: quality[l] })} />
      {level === 'limit' && <InlineSlider label="Max" value={settings.maxKb ?? 500} min={10} max={2000} step={10} unit="KB" allowManualOverflow onChange={(maxKb) => patch({ maxKb: Math.round(maxKb) })} />}</> },
  ];
}

const noPins = [] as string[];
export const usePinned = () => useStore((st) => st.settings.designExportPinned) ?? noPins;

/** Pin an option to the main panel (or take it back): kept in app settings, not per document. */
export function PinButton({ id, label }: { id: string; label: string }) {
  const pinned = usePinned().includes(id);
  const Icon = pinned ? PinOff : Pin;
  return <button type="button" className="opt opt-pick is-icon design-export-pin" aria-pressed={pinned} aria-label={`${pinned ? 'Unpin' : 'Pin'} ${label}`} data-tip={pinned ? 'Unpin' : 'Pin to panel'}
    onClick={() => setSettings((st) => ({ designExportPinned: pinned ? (st.designExportPinned ?? []).filter((k) => k !== id) : [...(st.designExportPinned ?? []), id] }))}><Icon size={13} /></button>;
}

const inMain = (o: Option, pinned: string[]) => o.applies && (o.contextual || o.changed || pinned.includes(o.key));

/** The options the current action needs, plus anything changed or pinned: one field row each. */
export function MainOptions({ settings, baseline, patch, hasText, only }: { settings: ExportSettings; baseline: ExportSettings; patch: Patch; hasText: boolean; /** Keys to show (the page block); the rest when `only` is false. */ only: string[] | false }) {
  const pinned = usePinned();
  const page = ['paper', 'orientation', 'print'];
  return <>{options(settings, baseline, patch, hasText).filter((o) => inMain(o, pinned) && (only ? only.includes(o.key) : !page.includes(o.key))).map((o) => <div key={o.key} className="brush-row">{o.node}</div>)}</>;
}

/** The gear button beside Format, and behind it the rest of the options grouped by format, each with a pin. */
export function FormatGear({ settings, baseline, patch, hasText, children }: { settings: ExportSettings; baseline: ExportSettings; patch: Patch; hasText: boolean; children?: ReactNode }) {
  const pop = usePopover();
  const pinned = usePinned();
  const all = options(settings, baseline, patch, hasText).filter((o) => o.applies);
  const rest = all.filter((o) => !inMain(o, pinned) || pinned.includes(o.key));
  const groups = [...new Set(rest.map((o) => o.group))];
  return <>
    <button type="button" ref={pop.ref} className="opt opt-pick is-icon" aria-label="Format options" data-tip="Format options" aria-haspopup="dialog" aria-expanded={pop.open} onClick={pop.toggle}><Settings size={14} /></button>
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} placement="bottom-start" width={300} className="design-export-pop" label="Format options">
      <div className="sidebar-tool-settings design-export-body"><div className="tool-settings">
        {groups.map((g) => <Fragment key={g}>
          <span className="field-label design-export-title">{g}</span>
          {rest.filter((o) => o.group === g).map((o) => <div key={o.key} className="brush-row">{o.node}<PinButton id={o.key} label={o.label} /></div>)}
        </Fragment>)}
        {children}
      </div></div>
    </Popover>
  </>;
}
