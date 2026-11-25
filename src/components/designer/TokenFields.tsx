import { useMemo, useRef } from 'react';
import { toast, useStore } from '../../store/store';
import { FONT_ACCEPT, keepInLibrary, storeFonts } from '../../engine/fontFiles';
import { putFonts } from '../../engine/ownFonts';
import { Upload } from '../ui/icons';
import { mutateDoc } from '../../engine/design/actions';
import { FONT_NAMES, fontNames } from '../../engine/design/doc';
import { docModes, familyPatch, tokenChoices, tokenOf, tokenPatch } from '../../engine/design/tokenBind';
import type { KitTokenType, TokenRef } from '../../engine/libraryTypes';
import type { DesignDoc, TextLayer, TextStyle } from '../../engine/types';
import { Field, MenuItem } from '../ui/primitives';
import { InlineColor, InlineSelect, InlineToggle, useTokenMode } from './InlineControls';

/* What the tokens of the brand in use give besides its colors: fonts, sizes and the mode of the page. */
const key = (r: TokenRef) => `{${r.kit}/${r.token}}`;
function useChoices(type: KitTokenType) {
  const library = useStore((s) => s.library), kitId = useStore((s) => s.composer.kitId), [mode, own] = useTokenMode();
  return useMemo(() => tokenChoices(type, mode, own), [type, library, kitId, mode, own]);
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

/** What a picked text layer has in Layer properties. */
export function TextLayerFields({ layer, onChange }: { layer: TextLayer; onChange: (patch: Partial<TextLayer>) => void }) {
  return <>
    <Field label="Text"><textarea rows={3} value={layer.text} onChange={(e) => onChange({ text: e.target.value })} /></Field>
    <FontField value={layer} onChange={onChange} />
    <div className="property-grid"><Field label="Size"><input type="number" min={4} max={1000} value={layer.fontSize} onChange={(e) => onChange({ fontSize: Math.min(1000, Math.max(4, +e.target.value)) })} /></Field><Field label="Weight"><select value={layer.fontWeight} onChange={(e) => onChange({ fontWeight: +e.target.value })}>{[100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => <option key={w}>{w}</option>)}</select></Field></div>
    <SizeTokenField value={layer} onChange={onChange} />
    <InlineToggle label="Italic" checked={!!layer.italic} onChange={(on) => onChange({ italic: on || undefined })} />
    <Field label="Text color"><InlineColor label="Text color" value={layer.color} alpha={{ value: layer.colorOpacity ?? 1, onChange: (o) => onChange({ colorOpacity: o < 1 ? o : undefined }) }} token={tokenOf(layer, 'color')} onChange={(c, t, p) => onChange(tokenPatch('color', c, t, p))} /></Field>
    <Field label="Alignment"><select value={layer.align} onChange={(e) => onChange({ align: e.target.value as TextLayer['align'] })}>{['left', 'center', 'right'].map((a) => <option key={a}>{a}</option>)}</select></Field>
  </>;
}

/** Light, Dark…: which values the page takes from its brand; nothing when the brand has one set of values. */
export function TokenModeField({ sessionId, doc }: { sessionId: string; doc: DesignDoc }) {
  const library = useStore((s) => s.library), kitId = useStore((s) => s.composer.kitId);
  const modes = useMemo(() => docModes(doc), [doc, library, kitId]);
  if (!modes.length && !doc.tokenMode) return null;
  return <InlineSelect label="Mode" value={doc.tokenMode ?? ''} options={[{ value: '', label: 'Default' }, ...[...new Set([...modes, ...(doc.tokenMode ? [doc.tokenMode] : [])])].map((m) => ({ value: m, label: m }))]}
    onChange={(m) => mutateDoc(sessionId, doc.id, (d) => ({ ...d, tokenMode: m || undefined }))} />;
}
