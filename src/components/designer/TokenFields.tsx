import { useMemo, useRef } from 'react';
import { toast, useStore } from '../../store/store';
import { FONT_ACCEPT, keepInLibrary, storeFonts } from '../../engine/fontFiles';
import { putFonts } from '../../engine/ownFonts';
import { Upload } from '../ui/icons';
import { mutateDoc } from '../../engine/design/actions';
import { FONT_NAMES, fontNames } from '../../engine/design/doc';
import { docModes, familyPatch, tokenChoices, tokenOf, tokenPatch } from '../../engine/design/tokenBind';
import type { KitTokenType, TokenRef } from '../../engine/libraryTypes';
import type { DesignDoc, TextStyle } from '../../engine/types';
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
  const file = useRef<HTMLInputElement>(null);
  // Into the brand in use, else into Library's Fonts.
  const upload = async (files: File[]) => {
    try {
      const fonts = await storeFonts(files), { composer, library: all } = useStore.getState();
      const brand = all.find((s) => s.id === composer.kitId && (s.kind === 'brand-kit' || s.kind === 'design-system'));
      if (brand) await putFonts(brand.id, fonts, 'user');
      else keepInLibrary(fonts);
      const kit = brand && useStore.getState().library.find((s) => s.id === brand.id), { family } = fonts[0];
      onChange(kit ? familyPatch(kit, family) : tokenPatch('fontFamily', family));
      toast(`${family} added to ${kit?.name ?? 'Library'}.`, 'success');
    } catch (err) { toast((err as Error).message, 'error'); }
  };
  return <>
    <input ref={file} type="file" aria-label="Font file" accept={FONT_ACCEPT} multiple hidden onChange={(e) => { const list = [...(e.target.files ?? [])]; e.target.value = ''; if (list.length) void upload(list); }} />
    <InlineSelect label="Font" value={ref ? key(ref) : value.fontFamily}
      options={[...(ref && !choices.some((c) => key(c.ref) === key(ref)) ? [{ value: key(ref), label: ref.token }] : []), ...choices.map((c) => ({ value: key(c.ref), label: `${c.label} · ${c.ref.value}` })), ...names.map((f) => ({ value: f, label: f }))]}
      more={(close) => <MenuItem icon={Upload} label="Upload font" onClick={() => { file.current?.click(); close(); }} />}
      onChange={(v) => { const c = choices.find((x) => key(x.ref) === v); onChange(c ? tokenPatch('fontFamily', String(c.ref.value), c.ref) : tokenPatch('fontFamily', v)); }} />
  </>;
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
