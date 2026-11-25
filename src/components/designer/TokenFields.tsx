import { useMemo } from 'react';
import { useStore } from '../../store/store';
import { mutateDoc } from '../../engine/design/actions';
import { FONT_NAMES, fontNames } from '../../engine/design/doc';
import { docModes, tokenChoices, tokenOf, tokenPatch } from '../../engine/design/tokenBind';
import type { KitTokenType, TokenRef } from '../../engine/libraryTypes';
import type { DesignDoc, TextStyle } from '../../engine/types';
import { InlineSelect, useTokenMode } from './InlineControls';

/* What the tokens of the brand in use give besides its colors: fonts, sizes and the mode of the page. */
const key = (r: TokenRef) => `{${r.kit}/${r.token}}`;
function useChoices(type: KitTokenType) {
  const library = useStore((s) => s.library), kitId = useStore((s) => s.composer.kitId), mode = useTokenMode();
  return useMemo(() => tokenChoices(type, mode), [type, library, kitId, mode]);
}

export function FontField({ value, onChange }: { value: TextStyle; onChange: (patch: Partial<TextStyle>) => void }) {
  const choices = useChoices('fontFamily'), ref = tokenOf(value, 'fontFamily');
  const library = useStore((s) => s.library), own = useMemo(() => fontNames(library), [library]);
  const names = [...new Set([...FONT_NAMES, ...own, ...(ref ? [] : [value.fontFamily])])];
  return <InlineSelect label="Font" value={ref ? key(ref) : value.fontFamily}
    options={[...(ref && !choices.some((c) => key(c.ref) === key(ref)) ? [{ value: key(ref), label: ref.token }] : []), ...choices.map((c) => ({ value: key(c.ref), label: `${c.label} · ${c.ref.value}` })), ...names.map((f) => ({ value: f, label: f }))]}
    onChange={(v) => { const c = choices.find((x) => key(x.ref) === v); onChange(c ? tokenPatch('fontFamily', String(c.ref.value), c.ref) : tokenPatch('fontFamily', v)); }} />;
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
