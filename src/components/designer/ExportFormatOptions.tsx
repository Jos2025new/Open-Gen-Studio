import { DEFAULT_JPEG_QUALITY, DEFAULT_PDF_PAGE, exportRows, PDF_PAPERS, pdfPage, type ExportSettings, type PdfPage, type PdfPaper } from '../../engine/design/exportSettings';
import { Settings } from '../ui/icons';
import { Popover, usePopover } from '../ui/Popover';
import { Hint, Segmented } from './ExportFields';
import { InlineSelect, InlineSlider, InlineToggle } from './InlineControls';

const quality = { compress: 75, high: DEFAULT_JPEG_QUALITY };

/** Everything that only one format needs, grouped by format (the gear next to Format opens it). */
export function FormatOptions({ settings, patch, hasText }: { settings: ExportSettings; patch: (options: Partial<ExportSettings>) => void; hasText: boolean }) {
  const rows = exportRows(settings);
  const has = (...formats: string[]) => rows.some((r) => formats.includes(r.format));
  const page = has('pdf') ? pdfPage(settings.pdf) : undefined;
  const pdfMode = !page ? 'screen' : settings.print ? 'print' : 'paper';
  const level = settings.maxKb !== undefined ? 'limit' : (settings.quality ?? DEFAULT_JPEG_QUALITY) < 90 ? 'compress' : 'high';
  const svg = settings.svg ?? {};
  const text = hasText && has('svg', 'pdf') && <>
    <Segmented label="Text" value={settings.text ?? 'fonts'} options={[{ value: 'fonts', label: 'Embed fonts' }, { value: 'paths', label: 'Convert to paths' }]} onChange={(t) => patch({ text: t })} />
    {(settings.text ?? 'fonts') === 'fonts' && <Hint>System fonts cannot be embedded: that text keeps the font name.</Hint>}
  </>;
  return <div className="design-export-fields">
    {has('pdf') && <>
      <div className="menu-sep-label">PDF</div>
      {text}
      <Segmented label="PDF page" value={pdfMode} options={[{ value: 'screen', label: 'Screen' }, { value: 'paper', label: 'Paper' }, { value: 'print', label: 'Print shop' }]}
        onChange={(m) => patch({ pdf: m === 'screen' ? 'screen' : page ?? DEFAULT_PDF_PAGE, print: m === 'print' ? { bleedMm: 3, marks: false } : undefined })} />
      {page && <>
        <InlineSelect label="Paper" value={page.paper} options={Object.entries(PDF_PAPERS).map(([paper, { label }]) => ({ value: paper as PdfPaper, label }))} onChange={(paper) => patch({ pdf: { ...page, paper } })} />
        <Segmented label="Orientation" value={page.orientation} options={[{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }] as { value: PdfPage['orientation']; label: string }[]}
          onChange={(orientation) => patch({ pdf: { ...page, orientation } })} />
        <InlineSlider label="Raster resolution" value={settings.ppi ?? 300} min={72} max={600} step={1} unit="ppi" allowManualOverflow onChange={(ppi) => patch({ ppi: Math.round(ppi) })} />
      </>}
      {settings.print && <>
        <InlineSlider label="Bleed" value={settings.print.bleedMm} min={0} max={10} step={0.5} unit="mm" onChange={(bleedMm) => patch({ print: { ...settings.print!, bleedMm } })} />
        <InlineToggle label="Crop marks" checked={settings.print.marks} onChange={(marks) => patch({ print: { ...settings.print!, marks } })} />
      </>}
    </>}
    {has('svg') && <>
      <div className="menu-sep-label">SVG</div>
      {!has('pdf') && text}
      <InlineSlider label="Decimals" value={svg.decimals ?? 3} min={0} max={6} step={1} onChange={(decimals) => patch({ svg: { ...svg, decimals } })} />
      <InlineToggle label="Minify" checked={!!svg.minify} onChange={(minify) => patch({ svg: { ...svg, minify } })} />
      <InlineToggle label="Include title" checked={svg.metadata !== false} onChange={(metadata) => patch({ svg: { ...svg, metadata } })} />
    </>}
    {has('jpg', 'webp') && <>
      <div className="menu-sep-label">JPG · WebP</div>
      <Segmented label="Quality" value={level} options={[{ value: 'compress', label: 'Compress' }, { value: 'high', label: 'High' }, { value: 'limit', label: 'Limit size' }]}
        onChange={(l) => patch(l === 'limit' ? { maxKb: settings.maxKb ?? 500 } : { maxKb: undefined, quality: quality[l] })} />
      {level === 'limit' && <InlineSlider label="Maximum" value={settings.maxKb ?? 500} min={10} max={2000} step={10} unit="KB" allowManualOverflow onChange={(maxKb) => patch({ maxKb: Math.round(maxKb) })} />}
    </>}
    {has('png') && !has('svg', 'pdf', 'jpg', 'webp') && <Hint>PNG is lossless: it has no extra options.</Hint>}
  </div>;
}

/** The gear button beside Format, with the options of the chosen format(s) in a small popover. */
export function FormatGear(props: { settings: ExportSettings; patch: (options: Partial<ExportSettings>) => void; hasText: boolean }) {
  const pop = usePopover();
  return <>
    <button type="button" ref={pop.ref} className="design-export-gear" aria-label="Format options" data-tip="Format options" aria-haspopup="dialog" aria-expanded={pop.open} onClick={pop.toggle}><Settings size={15} /></button>
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} placement="bottom-start" width={300} className="design-export-pop" label="Format options">
      <FormatOptions {...props} />
    </Popover>
  </>;
}
