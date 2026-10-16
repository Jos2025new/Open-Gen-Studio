import { useRef, useState } from 'react';
import { ArrowUpFromLine, ChevronLeft, FilePlus2, FileText, FolderOpen, Images, ImagePlus } from 'lucide-react';
import type { DesignDoc } from '../../engine/types';
import { Button, IconButton, MenuItem } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { AspectGlyph } from '../composer/MediaControls';
import { DOC_PRESETS } from '../../engine/design/doc';
import { newBlankDoc } from '../../engine/design/actions';
import { DocumentChoices } from '../designer/DocumentPicker';
import { EXPORT_FORMATS, IMPORT_ACCEPT, importDesignFiles, runDesignOutput } from '../designer/designerFile';

type View = 'menu' | 'new' | 'open' | 'export' | 'save';
const TITLES: Record<View, string> = { menu: 'File', new: 'New design', open: 'Open design', export: 'Export', save: 'Save to gallery' };

/** New, Open, Import and Export behind one icon: the full Designer's own actions and components, in one menu. */
export function EmbeddedFileMenu({ sessionId, docs, doc }: { sessionId: string; docs: DesignDoc[]; doc?: DesignDoc }) {
  const pop = usePopover();
  const [view, setView] = useState<View>('menu');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const go = (v: View) => setView(v);
  const close = () => { pop.close(); setView('menu'); };
  const output = async (gallery: boolean, format?: Parameters<typeof runDesignOutput>[3]) => {
    if (!doc || busy) return;
    close();
    setBusy(true);
    try { await runDesignOutput(sessionId, doc.id, gallery, format); } finally { setBusy(false); }
  };
  return <>
    <input ref={input} type="file" accept={IMPORT_ACCEPT} multiple hidden onChange={(e) => { const files = [...(e.currentTarget.files ?? [])]; e.currentTarget.value = ''; if (doc) void importDesignFiles(sessionId, doc.id, files); }} />
    <IconButton ref={pop.ref} icon={FileText} label="File" size="sm" active={pop.open} aria-haspopup="menu" aria-expanded={pop.open} onClick={() => { setView('menu'); pop.toggle(); }} />
    <Popover open={pop.open} anchor={pop.ref} onClose={close} placement="bottom-start" width={view === 'open' ? 220 : 240} label={TITLES[view]}>
      <div className="menu" role="menu">
        {view !== 'menu' && <MenuItem icon={ChevronLeft} label={TITLES[view]} onClick={() => go('menu')} />}
        {view === 'menu' && <>
          <MenuItem icon={FilePlus2} label="New…" onClick={() => go('new')} />
          {docs.length > 0 && doc && <MenuItem icon={FolderOpen} label="Open…" detail={doc.name} onClick={() => go('open')} />}
          {doc && <MenuItem icon={ImagePlus} label="Import image" onClick={() => { close(); input.current?.click(); }} />}
          {doc && <MenuItem icon={Images} label="Save to gallery…" onClick={() => go('save')} />}
          {doc && <MenuItem icon={ArrowUpFromLine} label="Export…" onClick={() => go('export')} />}
        </>}
        {view === 'new' && DOC_PRESETS.map((p) => <MenuItem key={p.id} label={<span className="preset-menu-label"><span className="preset-menu-glyph"><AspectGlyph value={`${p.width}:${p.height}`} size={16} /></span>{p.label}</span>} detail={`${p.width} × ${p.height}`} onClick={() => { newBlankDoc(sessionId, p); close(); }} />)}
        {view === 'open' && doc && <DocumentChoices sessionId={sessionId} docs={docs} active={doc} />}
        {view === 'export' && EXPORT_FORMATS.map((f) => <MenuItem key={f.id} label={f.label} detail={f.detail} onClick={() => void output(false, f.id)} />)}
        {view === 'save' && doc && <div className="confirm-pop">
          <p>Save <strong>{doc.name}</strong> to the gallery as an image?</p>
          <div className="confirm-pop-actions">
            <Button size="sm" variant="ghost" onClick={() => go('menu')}>Cancel</Button>
            <Button size="sm" variant="primary" icon={Images} onClick={() => void output(true)}>Save</Button>
          </div>
        </div>}
      </div>
    </Popover>
  </>;
}
