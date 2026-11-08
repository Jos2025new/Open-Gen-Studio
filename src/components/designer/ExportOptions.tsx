import { useState } from 'react';
import { DEFAULT_JPEG_QUALITY, DEFAULT_PDF_PAGE, PDF_PAPERS, pdfPage, type ExportSettings, type PdfPage, type PdfPaper } from '../../engine/design/exportSettings';
import { Button } from '../ui/primitives';
import { InlineColor, InlineSlider } from './InlineControls';

export function ExportOptions({ settings, patch, savePreset }: {
  settings: ExportSettings;
  patch: (options: Partial<ExportSettings>) => void;
  savePreset: (name: string) => string | undefined;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const alpha = settings.format === 'png' || settings.format === 'webp' || settings.preset === 'brand';
  const page = pdfPage(settings.pdf);
  const lossy = settings.format === 'jpg' || settings.format === 'webp';
  return <details className="design-export-options">
    <summary>More options</summary>
    {alpha && <label>Background
      <select value={settings.background === undefined ? 'document' : settings.background === null ? 'transparent' : 'color'}
        onChange={(e) => patch({ background: e.target.value === 'document' ? undefined : e.target.value === 'transparent' ? null : '#ffffff' })}>
        <option value="document">Use design background</option>
        <option value="transparent">Transparent</option>
        <option value="color">Solid color</option>
      </select>
    </label>}
    {alpha && settings.background && <InlineColor label="Background color" value={settings.background} onChange={(background) => patch({ background })} showValue />}
    {lossy && <>
      <label>Compression
        <select value={settings.maxKb === undefined ? 'quality' : 'limit'} onChange={(e) => patch({ maxKb: e.target.value === 'limit' ? 500 : undefined })}>
          <option value="quality">Quality</option><option value="limit">File size limit</option>
        </select>
      </label>
      {settings.maxKb !== undefined
        ? <label>Maximum KB<input type="number" min={1} step={1} value={settings.maxKb || ''} onChange={(e) => patch({ maxKb: Number(e.target.value) })} /></label>
        : <InlineSlider label="Quality" value={settings.quality ?? DEFAULT_JPEG_QUALITY} min={0} max={100} unit="%" onChange={(quality) => patch({ quality })} />}
    </>}
    {settings.format === 'pdf' && <>
      <label>PDF for
        <select value={page ? 'paper' : 'screen'} onChange={(e) => patch({ pdf: e.target.value === 'paper' ? DEFAULT_PDF_PAGE : 'screen' })}>
          <option value="screen">Screen · design size</option><option value="paper">Home printing</option>
        </select>
      </label>
      {page && <div className="design-export-row">
        <label>Paper
          <select value={page.paper} onChange={(e) => patch({ pdf: { ...page, paper: e.target.value as PdfPaper } })}>
            {Object.entries(PDF_PAPERS).map(([paper, { label }]) => <option key={paper} value={paper}>{label}</option>)}
          </select>
        </label>
        <label>Orientation
          <select value={page.orientation} onChange={(e) => patch({ pdf: { ...page, orientation: e.target.value as PdfPage['orientation'] } })}>
            <option value="portrait">Portrait</option><option value="landscape">Landscape</option>
          </select>
        </label>
      </div>}
    </>}
    {naming ? <>
      <label>Preset name<input maxLength={60} value={name} onChange={(e) => { setName(e.target.value); setError(undefined); }} /></label>
      <div className="design-export-buttons">
        <Button size="sm" variant="ghost" onClick={() => { setNaming(false); setError(undefined); }}>Cancel</Button>
        <Button size="sm" disabled={!name.trim()} onClick={() => {
          const problem = savePreset(name.trim());
          if (problem) setError(problem);
          else { setName(''); setNaming(false); }
        }}>Save preset</Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </> : <Button size="sm" onClick={() => setNaming(true)}>Save as preset</Button>}
  </details>;
}
