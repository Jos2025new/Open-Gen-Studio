import { useMemo, useRef, useState } from 'react';
import { toast, useStore } from '../../store/store';
import { FONT_ACCEPT, storeFonts } from '../../engine/fontFiles';
import { createItem } from '../../engine/libraryVersions';
import { putFonts } from '../../engine/ownFonts';
import { Plus, Upload } from '../ui/icons';
import { mutateDoc } from '../../engine/design/actions';
import { FONT_NAMES, fontNames } from '../../engine/design/doc';
import { docModes, familyPatch, tokenChoices, tokenOf, tokenPatch } from '../../engine/design/tokenBind';
import type { KitKind, KitTokenType, TokenRef } from '../../engine/libraryTypes';
import type { DesignDoc, TextStyle } from '../../engine/types';
import { KIT_META, newKitName } from '../gallery/newKit';
import { MenuItem } from '../ui/primitives';
import { InlineSelect, useTokenMode } from './InlineControls';

/* What the tokens of the brand in use give besides its colors: fonts, sizes and the mode of the page. */
const key = (r: TokenRef) => `{${r.kit}/${r.token}}`;
function useChoices(type: KitTokenType) {
  const library = useStore((s) => s.library), kitId = useStore((s) => s.composer.kitId), mode = useTokenMode();
  return useMemo(() => tokenChoices(type, mode), [type, library, kitId, mode]);
}

export function FontField({ value, onChange }: { value: TextStyle; onChange: (patch: Partial<TextStyle>) => void }) {
  const choices = useChoices('fontFamily'), ref = tokenOf(value, 'fontFamily');
  const library = useStore((s) => s.library), given = useStore((s) => s.sessions[s.activeSessionId]?.fonts), own = useMemo(() => fontNames(library), [library]);
  const names = [...new Set([...FONT_NAMES, ...own, ...(given ?? []).map((f) => f.family), ...(ref ? [] : [value.fontFamily])])];
  const file = useRef<HTMLInputElement>(null), target = useRef<string | null>(null);
  const upload = async (files: File[]) => {
    try {
      const fonts = await storeFonts(files), id = target.current ?? (await createItem({ name: newKitName('brand-kit', library), kind: 'brand-kit', space: 'library', by: 'user', draft: false, open: false })).subject.id;
      const [family] = await putFonts(id, fonts, 'user'), kit = useStore.getState().library.find((s) => s.id === id);
      if (!family || !kit) return;
      onChange(familyPatch(kit, family));
      toast(`${family} added to ${kit.name}.`, 'success');
    } catch (err) { toast((err as Error).message, 'error'); }
  };
  return <>
    <input ref={file} type="file" aria-label="Font file" accept={FONT_ACCEPT} multiple hidden onChange={(e) => { const list = [...(e.target.files ?? [])]; e.target.value = ''; if (list.length) void upload(list); }} />
    <InlineSelect label="Font" value={ref ? key(ref) : value.fontFamily}
      options={[...(ref && !choices.some((c) => key(c.ref) === key(ref)) ? [{ value: key(ref), label: ref.token }] : []), ...choices.map((c) => ({ value: key(c.ref), label: `${c.label} · ${c.ref.value}` })), ...names.map((f) => ({ value: f, label: f }))]}
      more={(close) => <UploadFont onPick={(id) => { target.current = id; file.current?.click(); close(); }} />}
      onChange={(v) => { const c = choices.find((x) => key(x.ref) === v); onChange(c ? tokenPatch('fontFamily', String(c.ref.value), c.ref) : tokenPatch('fontFamily', v)); }} />
  </>;
}

/** Into the brand in use, else the one picked here; null is a new brand kit. */
function UploadFont({ onPick }: { onPick: (id: string | null) => void }) {
  const library = useStore((s) => s.library), kitId = useStore((s) => s.composer.kitId), [open, setOpen] = useState(false);
  const kits = library.filter((s) => s.kind === 'brand-kit' || s.kind === 'design-system'), using = kits.find((s) => s.id === kitId);
  if (!open) return <MenuItem icon={Upload} label="Upload font" onClick={() => { if (using) onPick(using.id); else if (kits.length) setOpen(true); else onPick(null); }} />;
  return <>{kits.map((s) => <MenuItem key={s.id} icon={KIT_META[s.kind as KitKind].icon} label={s.name} onClick={() => onPick(s.id)} />)}<MenuItem icon={Plus} label="New brand kit" onClick={() => onPick(null)} /></>;
}

/** The sizes of the brand; nothing without them. */
export function SizeTokenField({ value, onChange }: { value: TextStyle; onChange: (patch: Partial<TextStyle>) => void }) {
  const choices = useChoices('dimension'), ref = tokenOf(value, 'fontSize');
  if (!choices.length) return null;
  return <InlineSelect label="Brand size" value={ref ? key(ref) : ''} options={[{ value: '', label: 'None' }, ...choices.map((c) => ({ value: key(c.ref), label: `${c.label} · ${c.ref.value}px` }))]}
    onChange={(v) => { const c = choices.find((x) => key(x.ref) === v); onChange({ fontSize: c ? Number(c.ref.value) : value.fontSize, fontSizeToken: c?.ref }); }} />;
}

/** Light, Dark…: which values the page takes from its brand; nothing when the brand has one set of values. */
export function TokenModeField({ sessionId, doc }: { sessionId: string; doc: DesignDoc }) {
  const library = useStore((s) => s.library), kitId = useStore((s) => s.composer.kitId);
  const modes = useMemo(() => docModes(doc), [doc, library, kitId]);
  if (!modes.length && !doc.tokenMode) return null;
  return <InlineSelect label="Mode" value={doc.tokenMode ?? ''} options={[{ value: '', label: 'Default' }, ...[...new Set([...modes, ...(doc.tokenMode ? [doc.tokenMode] : [])])].map((m) => ({ value: m, label: m }))]}
    onChange={(m) => mutateDoc(sessionId, doc.id, (d) => ({ ...d, tokenMode: m || undefined }))} />;
}
