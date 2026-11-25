import { useEffect, useRef, useState } from 'react';
import { ArrowUpFromLine, ChevronLeft, FilePlus2, FileText, FolderOpen, ImagePlus, Library } from '../ui/icons';
import type { DesignDoc } from '../../engine/types';
import { IconButton, MenuItem } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { AspectGlyph } from '../composer/MediaControls';
import { DOC_PRESETS } from '../../engine/design/doc';
import { DocBackgroundChoice } from '../designer/DocBackgroundChoice';
import { newBlankDoc } from '../../engine/design/actions';
import { ExportPanel } from '../designer/ExportPanel';
import { DocumentChoices } from '../designer/DocumentPicker';
import { IMPORT_ACCEPT, importDesignFiles } from '../designer/designerFile';
import { NewKitItems } from '../gallery/newKit';
import { SaveDesignToLibrary } from '../gallery/SaveDesignToLibrary';

type View = 'menu' | 'new' | 'open' | 'export' | 'library';
const TITLES: Record<View, string> = { menu: 'File', new: 'New design', open: 'Open design', export: 'Export', library: 'Save to Library' };

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
          {doc && <MenuItem icon={Library} label="Save to Library…" onClick={() => go('library')} />}
          {doc && <MenuItem icon={ArrowUpFromLine} label="Export…" onClick={() => go('export')} />}
        </>}
        {view === 'new' && <DocBackgroundChoice />}
        {view === 'new' && DOC_PRESETS.map((p) => <MenuItem key={p.id} label={<span className="preset-menu-label"><span className="preset-menu-glyph"><AspectGlyph value={`${p.width}:${p.height}`} size={16} /></span>{p.label}</span>} detail={`${p.width} × ${p.height}`} onClick={() => { newBlankDoc(sessionId, p); close(); }} />)}
        {view === 'new' && <NewKitItems sessionId={sessionId} space="studio" onDone={close} />}
        {view === 'open' && doc && <DocumentChoices sessionId={sessionId} docs={docs} active={doc} />}
        {view === 'library' && doc && <SaveDesignToLibrary key={doc.id} space="studio" sessionId={sessionId} doc={doc} busy={busy} setBusy={setBusy} onDone={close} onCancel={() => go('menu')} />}
      </div>}
    </Popover>
  </>;
}
