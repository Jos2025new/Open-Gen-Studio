import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { uid } from '../../lib/id';
import type { DesignDoc } from '../../engine/types';
import { currentExportTarget, deliverDesignExport, prepareDesignExport, prepareDesignPreview, rememberDesignExport, resolveExportTarget } from '../../engine/design/exportDesign';
import { exportDownloadFile, exportGeometry, validateExport } from '../../engine/design/exportJob';
import { BUILTIN_EXPORTS, DEFAULT_EXPORT, EXPORT_FORMATS, PDF_PAPERS, pdfPage, type ExportArea, type ExportSettings, type RememberedExport } from '../../engine/design/exportSettings';
import { useSelectionVersion } from '../../engine/design/pixelSelection';
import { rasterVersion, subscribeRaster } from '../../engine/design/raster';
import { setSettings, useStore } from '../../store/store';
import { Button } from '../ui/primitives';
import { ExportOptions } from './ExportOptions';

import { exportError } from '../../engine/design/exportErrors';
const groups = ['Share', 'Print', 'Work'];
const noPresets = [] as const;
const message = (error: unknown) => exportError(error, 'The export could not be prepared, so try a smaller size or another format.').message;

function initialExport(doc: DesignDoc): RememberedExport {
  const saved = doc.lastExport ?? { settings: DEFAULT_EXPORT };
  return saved.settings.pdf === 'a4' ? { ...saved, settings: { ...saved.settings, pdf: pdfPage('a4') } } : saved;
}

export function ExportPanel({ sessionId, doc, onBack }: { sessionId: string; doc: DesignDoc; onBack?: () => void }) {
  const [draft, setDraft] = useState(() => initialExport(doc));
  const [choice, setChoice] = useState(() => draft.settings.preset ?? '');
  const [filename, setFilename] = useState(doc.name);
  const [progress, setProgress] = useState<string>();
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [preview, setPreview] = useState<{ request: object; image?: Blob; error?: string }>();
  const running = useRef<AbortController | null>(null);
  const [delivery, setDelivery] = useState<{ request: object; kb: number; notices: string[] }>();
  const presetSelect = useRef<HTMLSelectElement>(null);
  const custom = useStore((s) => s.settings.designExportPresets) ?? noPresets;
  const selectionVersion = useSelectionVersion();
  const pixelVersion = useSyncExternalStore(subscribeRaster, rasterVersion);
  const { settings } = draft;
  const target = useMemo(() => resolveExportTarget(doc, draft), [doc.id, draft, selectionVersion]);
  // Keep the thumbnail when only export metadata changes.
  const request = useMemo(() => ({}), [doc.id, doc.name, doc.width, doc.height, doc.background, doc.layers, settings, target, pixelVersion]);
  const { geometry, invalid } = useMemo(() => {
    try {
      validateExport(doc, settings, target);
      return { geometry: exportGeometry(doc, settings, target), invalid: undefined };
    } catch (error) { return { geometry: undefined, invalid: message(error) }; }
  }, [doc, settings, target]);

  const image = preview?.request === request ? preview.image : undefined;
  const delivered = delivery?.request === request ? delivery : undefined;
  const previewError = preview?.request === request ? preview.error : undefined;

  useEffect(() => {
    presetSelect.current?.focus();
    return () => { running.current?.abort(); };
  }, []);

  useEffect(() => {
    if (invalid) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const image = await prepareDesignPreview(doc, settings, target, controller.signal);
        if (!controller.signal.aborted) setPreview({ request, image });
      } catch (error) {
        if (!controller.signal.aborted) setPreview({ request, error: message(error) });
      }
    }, 500);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [request, invalid]);

  function apply(next: ExportSettings, name: string) {
    setChoice(name);
    const settings = next.pdf === 'a4' ? { ...next, pdf: pdfPage('a4') } : next;
    setDraft({ settings, target: currentExportTarget(doc, settings) });
    setError(undefined);
    setStatus(undefined);
  }

  function patch(options: Partial<ExportSettings>) {
    const next = { ...settings, ...options };
    if (options.format && options.format !== settings.format) {
      next.preset = undefined;
      next.fitInstagram = undefined;
      if (options.format !== 'png' && options.format !== 'webp') next.background = undefined;
    }
    setDraft({ settings: next, target: options.area ? currentExportTarget(doc, next) : draft.target });
    setError(undefined);
    setStatus(undefined);
  }

  async function run() {
    if (running.current || invalid) return;
    const controller = new AbortController();
    running.current = controller;
    setError(undefined);
    setStatus(undefined);
    setProgress('Preparing export…');
    try {
      const result = await prepareDesignExport(doc, settings, target, controller.signal,
        (done, total) => setProgress(total === 1 ? 'Preparing file…' : `Preparing file ${done + 1} of ${total}…`), filename);
      controller.signal.throwIfAborted();
      if (result.files.length > 1) setProgress('Packing ZIP…');
      const file = await exportDownloadFile(filename, result.files, controller.signal);
      controller.signal.throwIfAborted();
      const name = deliverDesignExport(file);
      setDelivery({ request, kb: Math.max(1, Math.round(file.bytes.size / 1024)), notices: result.notices });
      if (doc.lastExport !== draft) rememberDesignExport(sessionId, doc.id, draft);
      setStatus(`Download requested for ${name}.`);
    } catch (error) {
      if (!controller.signal.aborted) setError(message(error));
    } finally {
      if (!controller.signal.aborted) setProgress(undefined);
      if (running.current === controller) running.current = null;
    }
  }

  function savePreset(name: string): string | undefined {
    if (invalid) return invalid;
    if ([...BUILTIN_EXPORTS, ...custom].some((p) => p.name.toLowerCase() === name.toLowerCase()) || name.toLowerCase() === 'custom') {
      return 'Choose a different preset name.';
    }
    const id = uid('export-preset');
    setSettings((s) => ({ designExportPresets: [...(s.designExportPresets ?? []), { id, name, settings }] }));
    setChoice(id);
  }

  const brand = settings.preset === 'brand';
  const areaNames = { canvas: 'Canvas', selection: 'Pixel selection', layer: 'Layer' };
  const instagramFit = settings.preset === 'instagram' && geometry && !settings.fitInstagram
    && geometry.box.w !== geometry.box.h && geometry.box.w * 5 !== geometry.box.h * 4;
  const paper = settings.format === 'pdf' ? pdfPage(settings.pdf) : undefined;

  return <div className="design-export">
    {onBack && <Button size="sm" variant="ghost" onClick={onBack}>Back to File</Button>}
    <fieldset disabled={!!progress}>
      <label>What is it for?
        <select ref={presetSelect} value={choice} onChange={(e) => {
          const id = e.target.value;
          const preset = [...BUILTIN_EXPORTS, ...custom].find((p) => p.id === id);
          apply(preset?.settings ?? { ...settings, preset: undefined, fitInstagram: undefined }, id);
        }}>
          {groups.map((group) => <optgroup key={group} label={group}>
            {BUILTIN_EXPORTS.filter((p) => p.group === group).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </optgroup>)}
          {!!custom.length && <optgroup label="My presets">{custom.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>}
          <option value="">Custom</option>
        </select>
      </label>
      <div className="design-export-row">
        <label>Format
          <select value={brand ? 'zip' : settings.format} disabled={brand} onChange={(e) => patch({ format: e.target.value as ExportSettings['format'] })}>
            {brand && <option value="zip">ZIP · SVG + 2 PNGs</option>}
            {EXPORT_FORMATS.map((format) => <option value={format} key={format}>{format.toUpperCase()}</option>)}
          </select>
        </label>
        <label>What to export
          <select value={settings.area} onChange={(e) => patch({ area: e.target.value as ExportArea })}>
            {Object.entries(areaNames).map(([area, name]) => <option key={area} value={area}>{name}</option>)}
          </select>
        </label>
      </div>
      {settings.area !== 'canvas' && draft.target !== currentExportTarget(doc, settings) && <Button size="sm" onClick={() => patch({ area: settings.area })}>
        Use current {settings.area === 'layer' ? 'layer' : 'selection'}
      </Button>}
      <div className="design-export-row">
        <label>Size
          <select value={brand ? 'bundle' : settings.size} disabled={brand} onChange={(e) => {
            const value = e.target.value;
            patch({ size: value === 'width' || value === 'long-side' ? value : Number(value) as 1 | 2 | 3, pixels: settings.pixels ?? geometry?.width ?? doc.width });
          }}>
            {brand && <option value="bundle">1× and 2×</option>}
            {[1, 2, 3].map((size) => <option key={size} value={size}>{size}×</option>)}
            <option value="width">Width in pixels</option>
            {settings.size === 'long-side' && <option value="long-side">Long side in pixels</option>}
          </select>
        </label>
        {!brand && typeof settings.size === 'string' && <label>Pixels
          <input type="number" min={1} step={1} value={settings.pixels || ''} onChange={(e) => patch({ pixels: Number(e.target.value) })} />
        </label>}
      </div>
      {instagramFit && <div className="design-export-hint">
        <span>This ratio differs from 4:5 or square.</span>
        <Button size="sm" onClick={() => patch({ fitInstagram: true })}>Fit to 4:5</Button>
      </div>}
      {settings.preset === 'instagram' && settings.fitInstagram && <Button size="sm" variant="ghost" onClick={() => patch({ fitInstagram: false })}>Use original ratio</Button>}
      <label>Name
        <input value={filename} placeholder={doc.name} onChange={(e) => { setFilename(e.target.value); setStatus(undefined); }} />
      </label>
      {geometry && <p className="design-export-hint">
        {paper ? `${PDF_PAPERS[paper.paper].label} · ${paper.orientation} · ` : ''}{geometry.width} × {geometry.height} px
        {brand ? ` and ${geometry.width * 2} × ${geometry.height * 2} px` : ''}
        {delivered ? ` · ${delivered.kb.toLocaleString()} KB` : ''}
      </p>}
      {image && <ExportPreview image={image} />}
      {delivered?.notices.map((note) => <p className="design-export-hint" key={note}>{note}</p>)}
      {!invalid && !previewError && !image && !progress && <p className="design-export-hint">Preparing preview…</p>}
      <ExportOptions settings={settings} patch={patch} savePreset={savePreset} />
    </fieldset>
    {(invalid || error || previewError) && <p role="alert">{invalid || error || previewError}</p>}
    <div className="design-export-buttons">
      {progress ? <Button size="sm" onClick={() => {
        running.current?.abort();
        running.current = null;
        setProgress(undefined);
        setStatus('Export cancelled. No file was downloaded.');
      }}>Cancel</Button> : <Button size="sm" variant="primary" disabled={!!invalid} onClick={() => void run()}>Export</Button>}
    </div>
    {(progress || status) && <p role="status">{progress || status}</p>}
  </div>;
}

function ExportPreview({ image }: { image: Blob }) {
  const [preview, setPreview] = useState<{ image: Blob; url: string }>();
  useEffect(() => {
    const url = URL.createObjectURL(image);
    setPreview({ image, url });
    return () => URL.revokeObjectURL(url);
  }, [image]);
  return preview?.image === image ? <img className="design-export-preview" src={preview.url} alt="Export preview" /> : null;
}
