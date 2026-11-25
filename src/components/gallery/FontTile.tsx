import { useRef, useState } from 'react';
import { deleteSubject } from '../../engine/actions';
import { getDoc, patchLayer } from '../../engine/design/actions';
import { fontStack } from '../../engine/design/doc';
import { tokenPatch } from '../../engine/design/tokenBind';
import { FONT_ACCEPT, keepInLibrary, storeFonts } from '../../engine/fontFiles';
import { putFonts } from '../../engine/ownFonts';
import type { Subject, TextStyle } from '../../engine/types';
import { setUi, toast, useStore } from '../../store/store';
import { setUserHidden } from '../../store/userHidden';
import { CardMenu, MenuConfirm, MenuItem, useTapReveal, type ItemView } from '../ui/PanelControls';
import { Eye, EyeOff, Plus, Trash, Upload } from '../ui/icons';
import { Button } from '../ui/primitives';
import { CardActions } from './GalleryTiles';
import { KIT_META } from './newKit';
import { useDesign } from './useDesign';

/** A font for the selected text, else for the next one. */
export function applyFont(sessionId: string, docId: string | undefined, patch: Partial<TextStyle>): void {
  const doc = docId ? getDoc(sessionId, docId) : undefined, layer = doc?.layers.find((l) => l.id === doc.activeLayerId);
  if (doc && layer?.type === 'text' && !layer.locked) patchLayer(sessionId, doc.id, layer.id, patch);
  else setUi((u) => ({ text: { ...u.text, ...patch } }));
}

export function UploadFonts() {
  const file = useRef<HTMLInputElement>(null);
  const add = async (files: File[]) => {
    try { keepInLibrary(await storeFonts(files)); } catch (err) { toast((err as Error).message, 'error'); }
  };
  return <div className="pc-flags">
    <input ref={file} type="file" aria-label="Font files" accept={FONT_ACCEPT} multiple hidden onChange={(e) => { const list = [...(e.target.files ?? [])]; e.target.value = ''; if (list.length) void add(list); }} />
    <Button size="sm" icon={Upload} onClick={() => file.current?.click()}>Upload font</Button>
  </div>;
}

function FontMenu({ item, close }: { item: Subject; close: () => void }) {
  const library = useStore((s) => s.library), [sub, setSub] = useState<'menu' | 'into' | 'remove'>('menu');
  const kits = library.filter((s) => (s.kind === 'brand-kit' || s.kind === 'design-system') && !s.userHidden);
  if (sub === 'remove') return <MenuConfirm text={`Remove ${item.name} from the library? Text in other sessions that uses it shows Inter.`} action="Remove" onCancel={() => setSub('menu')} onConfirm={() => { deleteSubject(item.id); close(); }} />;
  if (sub === 'into') return <>{kits.map((k) => <MenuItem key={k.id} icon={KIT_META[k.kind as 'brand-kit'].icon} onClick={() => { close(); void putFonts(k.id, item.fonts ?? [], 'user').then(() => toast(`${item.name} added to ${k.name}.`, 'success'), (e) => toast((e as Error).message, 'error')); }}>{k.name}</MenuItem>)}</>;
  return <>
    <MenuItem icon={Plus} disabled={!kits.length} onClick={() => setSub('into')}>Add to brand kit</MenuItem>
    <MenuItem icon={item.userHidden ? Eye : EyeOff} onClick={() => { setUserHidden('subject', [item.id], !item.userHidden); close(); }}>{item.userHidden ? 'Unhide' : 'Hide'}</MenuItem>
    <MenuItem icon={Trash} tone="danger" onClick={() => setSub('remove')}>{`Remove ${item.name}`}</MenuItem>
  </>;
}

/** A font of Library: a click uses it. */
export function FontTile({ item, view }: { item: Subject; view: ItemView }) {
  const { sessionId, docId } = useDesign(), open = () => applyFont(sessionId, docId, tokenPatch('fontFamily', item.name)), tap = useTapReveal(open);
  const faces = item.fonts ?? [], sub = faces.map((f) => `${f.variable ? 'Variable' : f.weight}${f.italic ? ' italic' : ''}`).join(', ');
  const sample = <span className="font-sample" style={{ fontFamily: fontStack(item.name), fontWeight: faces[0]?.weight }}>Aa{view === 'list' ? null : <small>{item.name}</small>}</span>;
  const menu = <CardMenu label={`More actions for ${item.name}`} className="pc-hover">{(close) => <FontMenu item={item} close={close} />}</CardMenu>;
  const text = <><span className="pc-info-title">{item.name}</span><span className="pc-info-sub">{sub}</span></>;
  if (view === 'list') return <div className={`g-tile lib-tile pc-row${item.userHidden ? ' is-hidden-item' : ''}`}>
    <button type="button" className="g-open pc-thumb" aria-label={`Use ${item.name}`} onClick={open}>{sample}</button>
    <span className="pc-text">{text}</span><span className="pc-tools">{menu}</span>
  </div>;
  return <div className={`g-tile lib-tile pc-card ${view === 'tile' ? 'pc-tile' : 'pc-fade'}${item.userHidden ? ' is-hidden-item' : ''}${tap.armed ? ' is-armed' : ''}`}>
    <button type="button" className="g-open pc-open pc-glyph-cover" aria-label={`Use ${item.name}`} onPointerDown={tap.onPointerDown} onClick={tap.onClick}>{sample}</button>
    <div className={`pc-info${view === 'card' ? ' pc-hover' : ''}`}>{text}<CardActions main={<span />}>{menu}</CardActions></div>
  </div>;
}
