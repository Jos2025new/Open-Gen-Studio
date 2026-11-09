import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { uid } from '../../lib/id';
import type { DesignDoc } from '../../engine/types';
import { currentExportTarget, deliverDesignExport, prepareDesignExport, prepareDesignPreview, rememberDesignExport, resolveExportTarget } from '../../engine/design/exportDesign';
import { exportDownloadFile, exportFileNames, exportGeometry, validateExport } from '../../engine/design/exportJob';
import { canChooseFolder, chooseFolder, writeFilesToFolder, type FolderHandle } from '../../engine/design/exportFolder';
import { useObjectSelection } from '../../engine/design/objectSelection';
import { BUILTIN_EXPORTS, DEFAULT_EXPORT, exportRows, pageLayout, PDF_PAPERS, pdfPage, type ExportSettings, type RememberedExport } from '../../engine/design/exportSettings';
import { getSelection, useSelectionVersion } from '../../engine/design/pixelSelection';
import { rasterVersion, subscribeRaster } from '../../engine/design/raster';
import { setSettings, useStore } from '../../store/store';
import { Button } from '../ui/primitives';
import { AreaRow, BackgroundRow, ExportSize, FormatRow, PresetActions } from './ExportOptions';
import { MainOptions, PinButton, usePinned } from './ExportFormatOptions';

import { blankNotice, hasVisibleContent, isNearUniform, parseColor, samplePreview } from '../../engine/design/exportContrast';
import { ExportMenu } from './ExportFields';
import { InlineToggle } from './InlineControls';
import { Folder } from '../ui/icons';

import { exportError } from '../../engine/design/exportErrors';
const groups = ['Share', 'Print', 'Work', 'Apps'];
const stable = (value: unknown): string => JSON.stringify(value, (_k, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : 1))) : v);
const sameSettings = (a: ExportSettings, b: ExportSettings) => {
  const strip = ({ preset: _p, base: _b, fitInstagram: _f, ...rest }: ExportSettings) => rest;
  return stable(strip(initialExport({ lastExport: { settings: a } } as DesignDoc).settings)) === stable(strip(initialExport({ lastExport: { settings: b } } as DesignDoc).settings));
};
const cm = (mm: number) => (Math.round(mm / 10 * 10) / 10).toFixed(1);
const noPresets = [] as const;
const message = (error: unknown) => exportError(error, 'The export could not be prepared, so try a smaller size or another format.').message;

function initialExport(doc: DesignDoc): RememberedExport {
  const saved = doc.lastExport ?? { settings: DEFAULT_EXPORT };
  return saved.settings.pdf === 'a4' ? { ...saved, settings: { ...saved.settings, pdf: pdfPage('a4') } } : saved;
}

export function ExportPanel({ sessionId, doc, onBack }: { sessionId: string; doc: DesignDoc; onBack?: () => void }) {
  const [draft, setDraft] = useState(() => initialExport(doc));
  const [choice, setChoice] = useState(() => draft.settings.preset ?? draft.settings.base ?? '');
  const [filename, setFilename] = useState(doc.name);
  const [progress, setProgress] = useState<string>();
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [preview, setPreview] = useState<{ request: object; image?: Blob; error?: string; blank?: boolean }>();
  const running = useRef<AbortController | null>(null);
  const [delivery, setDelivery] = useState<{ request: object; kb: number; notices: string[] }>();
  const [folder, setFolder] = useState<FolderHandle>();
  const custom = useStore((s) => s.settings.designExportPresets) ?? noPresets;
  const selectionVersion = useSelectionVersion();
  const objectPicks = useObjectSelection((st) => st.byDoc[doc.id]);
  const pixelVersion = useSyncExternalStore(subscribeRaster, rasterVersion);
  const { settings } = draft;
  const target = useMemo(() => resolveExportTarget(doc, draft), [doc.id, draft, selectionVersion, objectPicks]);
  // Keep the thumbnail when only export metadata changes.
  const request = useMemo(() => ({}), [doc.id, doc.name, doc.width, doc.height, doc.background, doc.layers, settings, target, pixelVersion]);
  const { geometry, invalid } = useMemo(() => {
    try {
      validateExport(doc, settings, target);
      const first = exportRows(settings)[0];
      return { geometry: exportGeometry(doc, { ...settings, size: settings.outputs?.length ? first.scale : settings.size, format: first.format }, target), invalid: undefined };
    } catch (error) { return { geometry: undefined, invalid: message(error) }; }
  }, [doc, settings, target]);

  const image = preview?.request === request ? preview.image : undefined;
  const [lastImage, setLastImage] = useState<Blob>();
  useEffect(() => { if (image) setLastImage(image); }, [image]);
  const delivered = delivery?.request === request ? delivery : undefined;
  const previewError = preview?.request === request ? preview.error : undefined;

  useEffect(() => {
    return () => { running.current?.abort(); };
  }, []);

  useEffect(() => {
    if (invalid) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const image = await prepareDesignPreview(doc, settings, target, controller.signal);
        const sample = hasVisibleContent(doc) ? await samplePreview(image) : null;
        if (!controller.signal.aborted) setPreview({ request, image, blank: !!sample && isNearUniform(sample, parseColor(pageColor)) });
      } catch (error) {
        if (!controller.signal.aborted) setPreview({ request, error: message(error) });
      }
    }, 500);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [request, invalid]);

  function apply(next: ExportSettings, name: string) {
    setChoice(name);
    const settings = { ...(next.pdf === 'a4' ? { ...next, pdf: pdfPage('a4') } : next), base: name || undefined };
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
      if (result.files.length > 1 && !folder) setProgress('Packing ZIP…');
      let kb: number, said: string;
      if (folder) {
        setProgress('Saving files…');
        const names = await writeFilesToFolder(folder, result.files, !!settings.subfolders);
        controller.signal.throwIfAborted();
        kb = Math.max(1, Math.round(result.files.reduce((sum, f) => sum + f.bytes.size, 0) / 1024));
        said = `Saved ${names.length === 1 ? names[0] : `${names.length} files`} to ${folder.name}.`;
      } else {
        const file = await exportDownloadFile(filename, result.files, controller.signal);
        controller.signal.throwIfAborted();
        kb = Math.max(1, Math.round(file.bytes.size / 1024));
        said = `Download requested for ${deliverDesignExport(file)}.`;
      }
      setDelivery({ request, kb, notices: result.notices });
      if (doc.lastExport !== draft) rememberDesignExport(sessionId, doc.id, draft);
      setStatus(said);
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

  const instagramFit = settings.preset === 'instagram' && geometry && !settings.fitInstagram
    && geometry.box.w !== geometry.box.h && geometry.box.w * 5 !== geometry.box.h * 4;
  const rows = exportRows(settings);
  const pageColor = settings.background !== undefined ? settings.background : doc.background ?? (rows.some((r) => r.format === 'pdf' || r.format === 'jpg') ? '#ffffff' : null);
  const paper = rows[0].format === 'pdf' ? pdfPage(settings.pdf) : undefined;
  const chosen = [...BUILTIN_EXPORTS, ...custom].find((p) => p.id === choice);
  const edited = !!chosen && !sameSettings(settings, chosen.settings);
  const own = custom.find((p) => p.id === choice);
  const layout = paper && geometry ? pageLayout(paper, geometry.width, geometry.height, settings.print) : undefined;
  const [short, long] = paper ? PDF_PAPERS[paper.paper].mm : [0, 0];
  const trimMm = paper ? (paper.orientation === 'portrait' ? [short, long] : [long, short]) : [0, 0];
  const paperName = paper ? `${PDF_PAPERS[paper.paper].label} ${paper.orientation}` : '';
  const info = paper ? `${paperName}${settings.print ? ' trim' : ''} · ${cm(trimMm[0])} × ${cm(trimMm[1])} cm${settings.print ? ` + ${settings.print.bleedMm} mm bleed` : ''}`
    : geometry ? `${geometry.width} × ${geometry.height} px${rows.length > 1 ? ` · ${rows.length} files` : ''}` : '';
  const hasText = doc.layers.some((l) => l.type === 'text' && l.visible);
  const pinned = usePinned();
  const showPrefix = rows.length > 1 || !!settings.prefix || pinned.includes('prefix');
  const folderControls = canChooseFolder() ? (
      <div className="design-export-folder">
      <div className="menu-sep-label">Save to</div><PinButton id="folder" label="folder" />
      <Button size="sm" icon={Folder} onClick={() => void chooseFolder().then((dir) => dir && setFolder(dir)).catch((e) => setError(message(e)))}>
        {folder ? `Folder: ${folder.name}` : 'Choose folder'}
      </Button>
      {folder && <Button size="sm" variant="ghost" onClick={() => setFolder(undefined)}>Use downloads</Button>}
      {folder && <InlineToggle label="Subfolders by format" checked={!!settings.subfolders} onChange={(subfolders) => patch({ subfolders })} />}
    </div>
  ) : undefined;
  const files = exportFileNames(settings, filename);
  const namesLine = `→ ${files.slice(0, 3).join(', ')}${files.length > 3 ? ` +${files.length - 3} more` : ''}${files.length > 1 && !folder ? ' (ZIP)' : ''}`;
  const presetOptions = [
    ...BUILTIN_EXPORTS.map((p) => ({ value: p.id as string, label: p.name + (edited && p.id === choice ? ' (edited)' : ''), group: p.group })).sort((a, b) => groups.indexOf(a.group) - groups.indexOf(b.group)),
    ...custom.map((p) => ({ value: p.id, label: p.name + (edited && p.id === choice ? ' (edited)' : ''), group: 'My presets' })),
    { value: '', label: 'Custom', group: 'Other' },
  ];

  return <div className="design-export">
    {onBack && <Button size="sm" variant="ghost" onClick={onBack}>Back to File</Button>}
    <div className="design-export-scroll"><fieldset disabled={!!progress}>
      <ExportMenu autoFocus label="What is it for?" value={choice} options={presetOptions} onChange={(id) => {
        const preset = [...BUILTIN_EXPORTS, ...custom].find((p) => p.id === id);
        apply(preset?.settings ?? { ...settings, preset: undefined, fitInstagram: undefined }, id);
      }} />
      <AreaRow settings={settings} patch={patch} picked={!!objectPicks?.length} pixels={!!getSelection(doc.id)} />
      {settings.area !== 'canvas' && settings.area !== 'content' && draft.target !== currentExportTarget(doc, settings) && <Button size="sm" onClick={() => patch({ area: settings.area })}>
        Use current {settings.area === 'layer' ? 'layer' : settings.area === 'objects' ? 'objects' : 'selection'}
      </Button>}
      <ExportPreview transparent={pageColor === null} ratio={layout ? layout.pageWidth / layout.pageHeight : geometry ? geometry.width / geometry.height : 1} image={image ?? lastImage} stale={!image} busy={!invalid && !previewError && !image} layout={layout} />
      {preview?.request === request && preview.blank && <p className="design-export-hint" role="note">{blankNotice(pageColor)}</p>}
      {geometry && <p className="design-export-hint">{info}{delivered ? ` · ${delivered.kb.toLocaleString()} KB` : ''}</p>}
      {delivered?.notices.map((note) => <p className="design-export-hint" key={note}>{note}</p>)}
      {geometry && !paper && !settings.outputs?.length && <ExportSize settings={settings} patch={patch} geometry={geometry} />}
      {instagramFit && <div className="design-export-hint">
        <span>This ratio differs from 4:5 or square.</span>
        <Button size="sm" onClick={() => patch({ fitInstagram: true })}>Fit to 4:5</Button>
      </div>}
      {settings.preset === 'instagram' && settings.fitInstagram && <Button size="sm" variant="ghost" onClick={() => patch({ fitInstagram: false })}>Use original ratio</Button>}
      <BackgroundRow settings={settings} patch={patch} docBackground={doc.background ?? null} />
      <MainOptions settings={settings} baseline={chosen?.settings ?? DEFAULT_EXPORT} patch={patch} hasText={hasText} />
      <div className={showPrefix ? 'design-export-row' : undefined}>
        {showPrefix && <div className="design-export-opt"><label>Prefix
          <input value={settings.prefix ?? ''} maxLength={40} onChange={(e) => patch({ prefix: e.target.value || undefined })} />
        </label>{pinned.includes('prefix') && <PinButton id="prefix" label="Prefix" />}</div>}
        <label>File name
          <input value={filename} placeholder={doc.name} onChange={(e) => { setFilename(e.target.value); setStatus(undefined); }} />
        </label>
      </div>
      {invalid ? null : <p className="design-export-hint" data-testid="export-names">{namesLine}</p>}
      <FormatRow settings={settings} baseline={chosen?.settings ?? DEFAULT_EXPORT} patch={patch} hasText={hasText} prefix={!showPrefix} extra={folder || pinned.includes('folder') ? undefined : folderControls} />
      {(folder || pinned.includes('folder')) && folderControls}
      <details className="design-export-more" open={!!own}>
        <summary>More</summary>
        <PresetActions savePreset={savePreset} own={own} deletePreset={() => {
          setSettings((st) => ({ designExportPresets: (st.designExportPresets ?? []).filter((p) => p.id !== choice) }));
          setChoice('');
        }} />
      </details>
    </fieldset></div>
    <footer className="design-export-footer">
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
    </footer>
  </div>;
}

function ExportPreview({ image, transparent, ratio, stale, busy, layout }: { image?: Blob; transparent: boolean; ratio: number; stale: boolean; busy: boolean; layout?: ReturnType<typeof pageLayout> }) {
  const [preview, setPreview] = useState<{ image: Blob; url: string }>();
  useEffect(() => {
    if (!image) return;
    const url = URL.createObjectURL(image);
    setPreview({ image, url });
    return () => URL.revokeObjectURL(url);
  }, [image]);
  const trim = layout?.trim;
  return <figure className="design-export-figure">
    <div className={`design-export-frame${stale ? ' is-stale' : ''}`}>{image ? <div className={`design-export-page${transparent ? ' is-transparent' : ''}`} style={{ '--ratio': ratio } as React.CSSProperties}>
      {preview?.image === image && <img className="design-export-preview" src={preview.url} alt="Export preview" />}
      {layout && trim && <span className="design-export-trim" style={{ left: `${trim.x / layout.pageWidth * 100}%`, top: `${trim.y / layout.pageHeight * 100}%`, width: `${trim.w / layout.pageWidth * 100}%`, height: `${trim.h / layout.pageHeight * 100}%` }} />}
    </div> : <span className="design-export-hint">{busy ? 'Preparing preview…' : 'No preview'}</span>}</div>
    {busy && image && <figcaption className="design-export-hint">Updating preview…</figcaption>}
  </figure>;
}
