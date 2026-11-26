import { useEffect, useRef, useState, type ReactNode } from 'react';
import { setComposer, setUi, toast, useStore } from '../../store/store';
import { addAsReference, sendToNodes, uploadFiles } from '../../engine/actions';
import { addTextLayer, getDoc, patchLayer, placeAsset } from '../../engine/design/actions';
import { fontStack } from '../../engine/design/doc';
import { patchPickedShapes } from '../../engine/design/multiObjectOps';
import { objectPicks } from '../../engine/design/objectSelection';
import { openHistoryGroup } from '../../engine/design/history';
import { brandToDoc, brushColorPatch, familyPatch, tokenOf, tokenPatch, tokenValue } from '../../engine/design/tokenBind';
import { rememberColor } from '../../engine/design/swatches';
import { FONT_ACCEPT } from '../../engine/fontFiles';
import { applyFont } from './FontTile';
import { useDesign } from './useDesign';
import { addFonts, removeFont } from '../../engine/ownFonts';
import { insertComponent } from '../../engine/libraryInsert';
import { addCategory, addToSection, kitSections, moveToSection, removeCategory, removeFromSection, sectionNodes, setSectionText, type KitSection } from '../../engine/librarySections';
import { resolveToken } from '../../engine/libraryTokens';
import { colorHex } from '../../engine/libraryTokensColor';
import { createItem, readKitVersion, saveItem } from '../../engine/libraryVersions';
import type { GraphNode, Subject } from '../../engine/types';
import { PICTURE_ACCEPT, isSvg } from '../../lib/imports';
import { AssetMedia } from '../ui/AssetMedia';
import { ChevronLeft, Images, Layers, PenTool, Plus, Shapes, Sparkles, Trash, Type, Upload } from '../ui/icons';
import { Button, IconButton } from '../ui/primitives';
import { CardMenu, MenuItem } from '../ui/PanelControls';
import { Popover, usePopover } from '../ui/Popover';
import { KIT_META, newKitName } from './newKit';
import { KitTokens } from './KitTokens';
import './KitPage.css';

type Run = (fn: () => unknown) => Promise<void>;
const assetOf = (n: GraphNode) => (n.data.kind === 'asset' ? n.data.assetId ?? undefined : undefined);
const tokensOf = (s: Subject, sec: KitSection) => Object.entries(s.tokens ?? {}).filter(([, t]) => sec.tokens?.includes(t.type)).map(([name, t]) => ({ name, token: name, type: t.type, value: String(resolveToken(s.tokens!, name) ?? t.value) }));
const insideOf = (s: Subject, sec: KitSection, library: readonly Subject[]) => (s.kits ?? []).flatMap((id) => library.find((x) => x.id === id && x.kind === sec.kit) ?? []);

/** A brand kit or design system in Library: its sections, each filled and used in place. */
export function KitPage({ item, chrome, menu, cover, onBack, onOpen, onDesign }: {
  item: Subject; chrome: ReactNode; menu: ReactNode; cover: (s: Subject) => string | undefined;
  onBack: () => void; onOpen: (s: Subject) => void; onDesign: () => void;
}) {
  const using = useStore((s) => s.composer.kitId === item.id), { sessionId, docId } = useDesign();
  const use = () => {
    setComposer({ kitId: using ? null : item.id });
    const doc = !using && docId ? getDoc(sessionId, docId) : undefined;
    if (!doc) return;
    const group = openHistoryGroup(doc.id);
    try { brandToDoc(doc, (id, p) => patchLayer(sessionId, doc.id, id, p)); } finally { group.close(); }
  };
  const [title, setTitle] = useState<string | null>(null), [busy, setBusy] = useState(false), busyRef = useRef(false);
  const sections = kitSections(item), section = sections.find((x) => x.title === title);
  const run: Run = async (fn) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await fn(); } catch (e) { toast((e as Error).message, 'error'); } finally { busyRef.current = false; setBusy(false); }
  };
  return <>
    <div className="gallery-controls generated-controls"><div className="pc-bar">
      <div className="pc-grp pc-left kit-crumbs">
        <IconButton icon={ChevronLeft} label="Back" size="sm" onClick={section ? () => setTitle(null) : onBack} />
        {section ? <><button type="button" className="kit-crumb" onClick={() => setTitle(null)}>{item.name}</button><span className="faint">/</span><strong>{section.title}</strong></> : <strong>{item.name}</strong>}
        <div className="pc-icons">{section ? <IconButton icon={Sparkles} label={using ? 'In use' : 'Use'} size="sm" active={using} aria-pressed={using} onClick={use} /> : <Button size="sm" icon={Sparkles} variant={using ? 'primary' : 'secondary'} aria-pressed={using} data-tip="The agent and the Designer follow it" onClick={use}>{using ? 'In use' : 'Use'}</Button>}{menu}</div>
      </div>
      <div className="pc-grp pc-right">{chrome}</div>
    </div></div>
    <div className="pc-split"><div className="pc-main"><div className={`gallery-scroll${busy ? ' is-busy' : ''}`} aria-busy={busy}>
      {section
        ? <Section key={section.title} item={item} section={section} sections={sections} busy={busy} run={run} cover={cover} onOpen={onOpen} onDesign={onDesign} onGone={() => setTitle(null)} />
        : <div className="kit-sections">
          {sections.map((s) => <SectionTile key={s.title} item={item} section={s} cover={cover} onOpen={() => setTitle(s.title)} />)}
          <NewCategory onAdd={(name) => run(() => setTitle(addCategory(item.id, name)))} />
        </div>}
    </div></div></div>
  </>;
}

function NewCategory({ onAdd }: { onAdd: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" className="kit-tile is-new" onClick={() => setOpen(true)}><span className="kit-tile-art"><Plus size={20} /></span><span className="kit-tile-name">New category</span></button>;
  return <form className="kit-tile is-new" onSubmit={(e) => { e.preventDefault(); const name = String(new FormData(e.currentTarget).get('name') ?? ''); if (name.trim()) onAdd(name); }}>
    <span className="kit-tile-art"><input name="name" autoFocus aria-label="Category name" placeholder="Name" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }} /></span>
    <span className="kit-tile-name">New category</span>
  </form>;
}

function SectionTile({ item, section, cover, onOpen }: { item: Subject; section: KitSection; cover: (s: Subject) => string | undefined; onOpen: () => void }) {
  const library = useStore((s) => s.library), nodes = sectionNodes(item, section), images = nodes.flatMap((n) => assetOf(n) ?? []), inside = insideOf(item, section, library);
  const colors = section.title === 'Colors' ? tokensOf(item, section) : [], tokens = section.type === 'tokens' ? tokensOf(item, section) : [];
  const quote = nodes.find((n) => n.data.kind === 'text'), covers = inside.flatMap((s) => cover(s) ?? []), groups = section.type === 'components' ? item.groupIds?.length ?? 0 : 0;
  const count = colors.length || tokens.length || inside.length || groups || nodes.length, Icon = section.type === 'components' ? Layers : section.type === 'kits' ? KIT_META[section.kit!].icon : section.type === 'text' ? Type : section.title === 'Fonts' ? Type : section.type === 'tokens' ? Shapes : Images;
  const shown = [...images, ...covers].slice(0, 4);
  return <button type="button" className="kit-tile" onClick={onOpen}>
    <span className={`kit-tile-art${shown.length ? ` is-images n${shown.length}` : ''}`}>
      {shown.length ? shown.map((id) => <AssetMedia key={id} assetId={id} />)
        : colors.length ? colors.slice(0, 8).map((c) => <i key={c.name} className="kit-tile-color" style={{ background: c.value }} />)
          : section.title === 'Fonts' && tokens.length ? <span className="kit-tile-font" style={{ fontFamily: fontStack(tokens[0].value.split(',')[0].trim()) }}>Aa</span>
            : quote?.data.kind === 'text' ? <span className="kit-tile-quote">{quote.data.text}</span>
              : <Icon size={20} />}
    </span>
    <span className="kit-tile-name">{section.title}{count ? <span className="pc-count num">{count}</span> : null}</span>
  </button>;
}

interface SectionProps { item: Subject; section: KitSection; sections: KitSection[]; busy: boolean; run: Run; cover: (s: Subject) => string | undefined; onOpen: (s: Subject) => void; onDesign: () => void; onGone: () => void; }
function Section(p: SectionProps) {
  const { item, section, run } = p;
  if (section.type === 'tokens') return <div className="kit-section"><Swatches item={item} section={section} />{section.title === 'Fonts' && <Fonts {...p} />}<KitTokens key={item.id} item={item} types={section.tokens} /></div>;
  if (section.type === 'components') return <Components {...p} />;
  if (section.type === 'kits') return <Inside {...p} />;
  if (section.type === 'text') return <div className="kit-section"><Texts {...p} nodes={sectionNodes(item, section)} /><NewText onAdd={(text) => run(() => addToSection(item.id, section.title, { texts: [text] }))} /></div>;
  return <Items {...p} />;
}

/** The colors of the kit, one click away: the picked text's or shapes' color, else the Designer's; or copied. */
function Swatches({ item, section }: { item: Subject; section: KitSection }) {
  const { sessionId, docId } = useDesign(), colors = section.title === 'Colors' ? tokensOf(item, section) : [];
  if (!colors.length) return null;
  const use = (c: string, token?: string) => {
    const doc = docId ? getDoc(sessionId, docId) : undefined, value = doc && token ? tokenValue(item, token, doc.tokenMode) : undefined, hex = String(value ?? colorHex(c) ?? c).toLowerCase();
    if (doc && /^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(hex)) {
      const ref = token && value !== undefined ? { kit: item.id, token, value } : undefined, layer = doc.layers.find((l) => l.id === doc.activeLayerId), picks = objectPicks(doc.id);
      const firstShape = picks.length ? doc.layers.flatMap((l) => (l.type === 'vector' ? l.shapes : [])).find((s) => picks.some((p) => p.ids.includes(s.id))) : undefined;
      if (picks.length) patchPickedShapes(sessionId, doc.id, doc, picks, tokenPatch('fill', hex, ref, firstShape && tokenOf(firstShape, 'fill')));
      else if (layer?.type === 'text' && !layer.locked) patchLayer(sessionId, doc.id, layer.id, tokenPatch('color', hex, ref, tokenOf(layer, 'color')));
      else setUi((u) => ({ brush: { ...u.brush, ...brushColorPatch(hex) }, text: { ...u.text, ...tokenPatch('color', hex, ref, tokenOf(u.text, 'color')) }, shape: { ...u.shape, ...tokenPatch('fill', hex, ref, tokenOf(u.shape, 'fill')) }, lineart: { ...u.lineart, ...tokenPatch('color', hex, ref, tokenOf(u.lineart, 'color'), 'opacity') } }));
      rememberColor(hex.slice(0, 7));
    } else void navigator.clipboard?.writeText(c).then(() => toast(`${c} copied.`, 'success'), () => toast('Could not copy.', 'error'));
  };
  return <div className="kit-swatches">{colors.map((c) => <button key={c.name} type="button" className="kit-swatch" aria-label={`${c.name} ${c.value}`} data-tip={c.value} style={{ background: c.value }} onClick={() => use(c.value, c.token)} />)}</div>;
}

/** The entry's own font files: added, used in the picked text (or the next one) with a click, and removed. */
function Fonts({ item, busy, run }: SectionProps) {
  const { sessionId, docId } = useDesign(), file = useRef<HTMLInputElement>(null);
  const families = [...new Set((item.fonts ?? []).map((f) => f.family))];
  const use = (family: string) => applyFont(sessionId, docId, familyPatch(item, family));
  return <>
    <div className="kit-add">
      <input ref={file} type="file" accept={FONT_ACCEPT} multiple hidden onChange={(e) => { const list = [...(e.target.files ?? [])]; e.target.value = ''; void run(async () => { const names = await addFonts(item.id, list); if (names.length) toast(`${names.join(', ')} added.`, 'success'); }); }} />
      <Button size="sm" icon={Upload} disabled={busy} onClick={() => file.current?.click()}>Upload font</Button>
    </div>
    {families.map((f) => <div key={f} className="kit-font">
      <button type="button" className="kit-font-use" aria-label={`Use ${f}`} style={{ fontFamily: fontStack(f) }} onClick={() => use(f)}>{f}</button>
      <IconButton icon={Trash} label={`Remove ${f}`} size="sm" disabled={busy} onClick={() => void run(() => removeFont(item.id, f))} />
    </div>)}
  </>;
}

function Items({ item, section, sections, busy, run, onGone }: SectionProps) {
  const { sessionId, docId } = useDesign(), workspace = useStore((s) => s.ui.workspace);
  const nodes = sectionNodes(item, section), file = useRef<HTMLInputElement>(null), [over, setOver] = useState(false);
  const add = (assetIds: string[]) => run(async () => { if (assetIds.length) await addToSection(item.id, section.title, { assetIds }); });
  const upload = (files: FileList | null) => { const list = [...(files ?? [])].filter((f) => f.type.startsWith('image/') || isSvg(f)); if (list.length) void run(async () => { const ids = await uploadFiles(list); if (ids.length) await addToSection(item.id, section.title, { assetIds: ids }); }); };
  const use = (id: string) => {
    if (docId) void placeAsset(sessionId, docId, id, 'new');
    else if (workspace === 'node') sendToNodes(id);
    else addAsReference(id);
  };
  const accepts = (e: React.DragEvent) => e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('application/x-ogs-asset');
  return <div className={`kit-section${over ? ' is-over' : ''}`} onDragOver={(e) => { if (accepts(e)) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)}
    onDrop={(e) => { setOver(false); if (!accepts(e)) return; e.preventDefault(); const id = e.dataTransfer.getData('application/x-ogs-asset'); if (id) void add([id]); else upload(e.dataTransfer.files); }}>
    <div className="kit-add">
      <input ref={file} type="file" accept={`${PICTURE_ACCEPT},image/gif`} multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
      <Button size="sm" icon={Upload} disabled={busy} onClick={() => file.current?.click()}>Upload</Button>
      <FromLibrary disabled={busy} taken={new Set(nodes.flatMap((n) => assetOf(n) ?? []))} onAdd={(ids) => void add(ids)} />
      {section.custom && !nodes.length ? <IconButton icon={Trash} label={`Remove ${section.title}`} size="sm" onClick={() => { removeCategory(item.id, section.title); onGone(); }} /> : null}
    </div>
    <div className="kit-images">
      {nodes.map((n) => { const id = assetOf(n); return id ? <div key={n.id} className="kit-image">
        <button type="button" className="kit-image-use" aria-label={`Use ${n.data.title}`} onClick={() => use(id)}><AssetMedia assetId={id} /></button>
        <CardMenu label={`More actions for ${n.data.title}`} className="pc-hover">{(close) => <>
          {sections.filter((s) => s.type === 'items' && s.title !== section.title).map((s) => <MenuItem key={s.title} disabled={busy} onClick={() => { close(); void run(() => moveToSection(item.id, n.id, s.title)); }}>{`Move to ${s.title}`}</MenuItem>)}
          <MenuItem icon={Trash} tone="danger" onClick={() => { close(); void run(() => removeFromSection(item.id, n.id)); }}>Remove</MenuItem>
        </>}</CardMenu>
      </div> : null; })}
    </div>
    <Texts item={item} run={run} nodes={nodes} />
  </div>;
}

/** Images already in the app, to pick for a section. */
function FromLibrary({ taken, disabled, onAdd }: { taken: ReadonlySet<string>; disabled: boolean; onAdd: (ids: string[]) => void }) {
  const pop = usePopover(), [picked, setPicked] = useState<string[]>([]);
  const close = () => { pop.close(); setPicked([]); };
  return <>
    <Button ref={pop.ref} size="sm" icon={Images} disabled={disabled} aria-haspopup="dialog" aria-expanded={pop.open} onClick={pop.toggle}>Library</Button>
    <Popover open={pop.open} anchor={pop.ref} onClose={close} width={340} placement="bottom-start" label="Add from Library" className="pop-scroll">
      <PickImages taken={taken} picked={picked} onPick={(id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))} />
      <div className="confirm-pop-actions"><Button size="sm" variant="primary" disabled={!picked.length} onClick={() => { onAdd(picked); close(); }}>{picked.length ? `Add ${picked.length}` : 'Add'}</Button></div>
    </Popover>
  </>;
}
function PickImages({ taken, picked, onPick }: { taken: ReadonlySet<string>; picked: readonly string[]; onPick: (id: string) => void }) {
  const assets = useStore((s) => s.assets), [limit, setLimit] = useState(60);
  const list = Object.values(assets).filter((a) => a.kind === 'image' && !a.userHidden && !taken.has(a.id)).sort((a, b) => b.createdAt - a.createdAt);
  if (!list.length) return <p className="faint kit-empty">No images yet.</p>;
  return <div className="kit-pick" onScroll={(e) => { const t = e.currentTarget; if (t.scrollTop + t.clientHeight > t.scrollHeight - 80 && limit < list.length) setLimit(limit + 60); }}>
    {list.slice(0, limit).map((a) => <button key={a.id} type="button" className={`kit-pick-item${picked.includes(a.id) ? ' is-on' : ''}`} aria-pressed={picked.includes(a.id)} aria-label={a.name || 'Image'} onClick={() => onPick(a.id)}><AssetMedia assetId={a.id} /></button>)}
  </div>;
}

function Texts({ item, run, nodes }: { item: Subject; run: Run; nodes: GraphNode[] }) {
  const { sessionId, docId } = useDesign();
  return <>{nodes.map((n) => n.data.kind === 'text' ? <div key={n.id} className="kit-text">
    <textarea aria-label={n.data.title} defaultValue={n.data.text} rows={Math.min(10, Math.max(3, n.data.text.split('\n').length))} onBlur={(e) => { const v = e.target.value.trim(), was = n.data.kind === 'text' ? n.data.text : ''; if (!v) e.target.value = was; else if (v !== was) void run(() => setSectionText(item.id, n.id, v)); }} />
    <span className="kit-text-tools">
      {docId ? <IconButton icon={Type} label="Insert in design" size="sm" onClick={() => { if (n.data.kind === 'text') addTextLayer(sessionId, docId, n.data.text, { x: 80, y: 80, width: 600 }, {}, n.data.title); }} /> : null}
      <IconButton icon={Trash} label="Remove text" size="sm" onClick={() => void run(() => removeFromSection(item.id, n.id))} />
    </span>
  </div> : null)}</>;
}
function NewText({ onAdd }: { onAdd: (text: string) => void }) {
  const [text, setText] = useState('');
  return <form className="kit-text" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { onAdd(text); setText(''); } }}>
    <textarea aria-label="New text" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
    <span className="kit-text-tools"><Button size="sm" icon={Plus} type="submit" disabled={!text.trim()}>Add</Button></span>
  </form>;
}

/** The groups of its document, inserted in the open design. */
function Components({ item, busy, run, onDesign }: SectionProps) {
  const { sessionId, docId } = useDesign(), [list, setList] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    let on = true;
    if (item.versionId) void readKitVersion(item.versionId).then((snap) => { if (on) setList((snap?.doc?.groups ?? []).filter((g) => snap!.doc!.layers.some((l) => l.groupId === g.id)).map((g) => ({ id: g.id, name: g.name }))); }, () => undefined);
    return () => { on = false; };
  }, [item.versionId]);
  return <div className="kit-section">
    <div className="kit-add"><Button size="sm" icon={PenTool} disabled={busy} onClick={onDesign}>Open in Designer</Button></div>
    <div className="kit-sections">{list.map((c) => <button key={c.id} type="button" className="kit-tile" disabled={busy || !docId} onClick={() => void run(() => insertComponent(sessionId, docId!, item.id, c.id))}>
      <span className="kit-tile-art"><Layers size={20} /></span><span className="kit-tile-name">{c.name}</span>
    </button>)}</div>
  </div>;
}

/** The moodboards and design systems it contains. */
function Inside({ item, section, busy, run, cover, onOpen }: SectionProps) {
  const library = useStore((s) => s.library), kind = section.kit!, meta = KIT_META[kind], inside = insideOf(item, section, library);
  const save = (kits: string[]) => saveItem({ subjectId: item.id, mode: 'overwrite', space: 'library', by: 'user', kits });
  const others = library.filter((s) => s.kind === kind && !s.userHidden && s.id !== item.id && !item.kits?.includes(s.id));
  return <div className="kit-section">
    <div className="kit-add"><CardMenu label={`Add ${meta.singular.toLowerCase()}`}>{(close) => <>
      {others.map((s) => <MenuItem key={s.id} icon={meta.icon} disabled={busy} onClick={() => { close(); void run(() => save([...(item.kits ?? []), s.id])); }}>{s.name}</MenuItem>)}
      <MenuItem icon={Plus} disabled={busy} onClick={() => { close(); void run(async () => { const { subject } = await createItem({ name: newKitName(kind, library), kind, space: 'library', by: 'user', draft: false, open: false }); await save([...(item.kits ?? []), subject.id]); }); }}>{`New ${meta.singular.toLowerCase()}`}</MenuItem>
    </>}</CardMenu></div>
    <div className="kit-sections">{inside.map((s) => { const c = cover(s); return <div key={s.id} className="kit-image">
      <button type="button" className="kit-tile" onClick={() => onOpen(s)}><span className={`kit-tile-art${c ? ' is-images n1' : ''}`}>{c ? <AssetMedia assetId={c} /> : <meta.icon size={20} />}</span><span className="kit-tile-name">{s.name}</span></button>
      <CardMenu label={`More actions for ${s.name}`} className="pc-hover">{(close) => <MenuItem icon={Trash} onClick={() => { close(); void run(() => save((item.kits ?? []).filter((id) => id !== s.id))); }}>{`Take out of ${item.name}`}</MenuItem>}</CardMenu>
    </div>; })}</div>
  </div>;
}
