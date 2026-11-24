import { useEffect, useRef, useState } from 'react';
import { ArrowUpFromLine, ChevronLeft, FilePlus2, FileText, FolderOpen, Images, ImagePlus, Library } from '../ui/icons';
import type { DesignDoc } from '../../engine/types';
import { Button, IconButton, MenuItem } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { AspectGlyph } from '../composer/MediaControls';
import { DOC_PRESETS } from '../../engine/design/doc';
import { DocBackgroundChoice } from '../designer/DocBackgroundChoice';
import { newBlankDoc } from '../../engine/design/actions';
import { ExportPanel } from '../designer/ExportPanel';
import { DocumentChoices } from '../designer/DocumentPicker';
import { IMPORT_ACCEPT, importDesignFiles, runDesignOutput } from '../designer/designerFile';
import { NewKitItems } from '../gallery/newKit';
import { SaveToLibrary } from '../gallery/SaveToLibrary';

type View = 'menu' | 'new' | 'open' | 'export' | 'save' | 'library';
const TITLES: Record<View, string> = { menu: 'File', new: 'New design', open: 'Open design', export: 'Export', save: 'Save to gallery', library: 'Save to Library' };

/** New, Open, Import and Export behind one icon: the full Designer's own actions and components, in one menu. */
export function EmbeddedFileMenu({ sessionId, docs, doc }: { sessionId: string; docs: DesignDoc[]; doc?: DesignDoc }) {
  const pop = usePopover();
  const [view, setView] = useState<View>('menu');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const go = (v: View) => setView(v);
  const close = () => { pop.close(); setView('menu'); };
  const setOpen = pop.setOpen;
  useEffect(() => {
    if (!doc || busy) return;
    const open = () => { setView('export'); setOpen(true); };
    window.addEventListener('ogs:designer-export', open);
    return () => window.removeEventListener('ogs:designer-export', open);
  }, [doc?.id, busy, setOpen]);
  const saveToGallery = async () => {
    if (!doc || busy) return;
    close();
    setBusy(true);
    try { await runDesignOutput(sessionId, doc.id, true, undefined); } finally { setBusy(false); }
  };
  return <>
    <input ref={input} type="file" accept={IMPORT_ACCEPT} multiple hidden onChange={(e) => { const files = [...(e.currentTarget.files ?? [])]; e.currentTarget.value = ''; if (doc) void importDesignFiles(sessionId, doc.id, files); }} />
    <IconButton ref={pop.ref} icon={FileText} label="File" size="sm" active={pop.open} aria-haspopup="menu" aria-expanded={pop.open} onClick={() => { setView('menu'); pop.toggle(); }} />
    <Popover open={pop.open} anchor={pop.ref} onClose={close} placement="bottom-start"
      edge={view === 'export' ? 'slide' : 'narrow'} align={view === 'export' ? 'start' : 'end'}
      width={view === 'export' ? 350 : view === 'library' ? 300 : view === 'open' ? 220 : 240} label={TITLES[view]}>
      {view === 'export' && doc ? <ExportPanel key={doc.id} sessionId={sessionId} doc={doc} onBack={() => go('menu')} /> : <div className="menu" role="menu">
        {view !== 'menu' && <MenuItem icon={ChevronLeft} label={TITLES[view]} onClick={() => go('menu')} />}
        {view === 'menu' && <>
          <MenuItem icon={FilePlus2} label="New…" onClick={() => go('new')} />
          {docs.length > 0 && doc && <MenuItem icon={FolderOpen} label="Open…" detail={doc.name} onClick={() => go('open')} />}
          {doc && <MenuItem icon={ImagePlus} label="Import image" onClick={() => { close(); input.current?.click(); }} />}
          {doc && <MenuItem icon={Images} label="Save to gallery…" onClick={() => go('save')} />}
          {doc && <MenuItem icon={Library} label="Save to Library…" onClick={() => go('library')} />}
          {doc && <MenuItem icon={ArrowUpFromLine} label="Export…" onClick={() => go('export')} />}
        </>}
        {view === 'new' && <DocBackgroundChoice />}
        {view === 'new' && DOC_PRESETS.map((p) => <MenuItem key={p.id} label={<span className="preset-menu-label"><span className="preset-menu-glyph"><AspectGlyph value={`${p.width}:${p.height}`} size={16} /></span>{p.label}</span>} detail={`${p.width} × ${p.height}`} onClick={() => { newBlankDoc(sessionId, p); close(); }} />)}
        {view === 'new' && <NewKitItems sessionId={sessionId} space="studio" onDone={close} />}
        {view === 'open' && doc && <DocumentChoices sessionId={sessionId} docs={docs} active={doc} />}
        {view === 'save' && doc && <div className="confirm-pop">
          <p>Save <strong>{doc.name}</strong> to the gallery as an image?</p>
          <div className="confirm-pop-actions">
            <Button size="sm" variant="ghost" onClick={() => go('menu')}>Cancel</Button>
            <Button size="sm" variant="primary" icon={Images} onClick={() => void saveToGallery()}>Save</Button>
          </div>
        </div>}
        {view === 'library' && doc && <SaveToLibrary space="studio" sessionId={sessionId} doc={doc} onDone={close} />}
      </div>}
    </Popover>
  </>;
}
