import { useRef, useState } from 'react';
import { useStore } from '../../store/store';
import { downloadBlob } from '../../lib/media';
import { resolveToken } from '../../engine/libraryTokens';
import { tokensFromFile, tokensToFile } from '../../engine/libraryTokensFile';
import { TOKEN_TYPES, type KitToken, type KitTokens as Tokens, type KitTokenType } from '../../engine/libraryTypes';
import type { Subject } from '../../engine/types';
import { Download, Plus, Upload, X } from '../ui/icons';
import { Button, IconButton } from '../ui/primitives';
import { toast } from '../../store/store';
import { saveItem } from '../../engine/libraryVersions';
import './KitTokens.css';

interface Row { name: string; type: KitTokenType; value: string; description?: string; }
const LABELS: Record<KitTokenType, string> = { color: 'Color', dimension: 'Size', fontFamily: 'Font', number: 'Number', string: 'Text' };
const START: Record<KitTokenType, string> = { color: '#000000', dimension: '16px', fontFamily: 'Inter', number: '1', string: '' };
const rowsOf = (tokens?: Tokens): Row[] => Object.entries(tokens ?? {}).map(([name, t]) => ({ name, type: t.type, value: String(t.value), ...(t.description ? { description: t.description } : {}) }));

/** Row texts as tokens; a number typed as text is a number again. */
function tokensOf(rows: readonly Row[]): Tokens {
  const out: Tokens = {};
  for (const r of rows) {
    const name = r.name.trim(), text = r.value.trim();
    if (!name) throw new Error('Every token needs a name.');
    if (out[name]) throw new Error(`Two tokens are named "${name}".`);
    const value: KitToken['value'] = r.type === 'number' && text && Number.isFinite(Number(text)) ? Number(text) : text;
    out[name] = { type: r.type, value, ...(r.description ? { description: r.description } : {}) };
  }
  return out;
}

/** The design tokens of a design system or brand kit: seen, edited, imported and exported. Save makes a version. */
export function KitTokens({ item, onDone, types = TOKEN_TYPES }: { item: Subject; onDone: () => void; /** Only these types show; the rest stay as they are. */ types?: readonly KitTokenType[] }) {
  const [rows, setRows] = useState(() => rowsOf(item.tokens)), [busy, setBusy] = useState(false), file = useRef<HTMLInputElement>(null);
  const patch = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const add = (type: KitTokenType) => setRows((rs) => {
    let n = 1;
    const stem = LABELS[type].toLowerCase();
    while (rs.some((r) => r.name === `${stem}.${n}`)) n++;
    return [...rs, { name: `${stem}.${n}`, type, value: START[type] }];
  });
  const importFile = async (f?: File) => {
    if (!f) return;
    try {
      const { tokens, skipped } = tokensFromFile(await f.text());
      setRows((rs) => [...rs.filter((r) => !tokens[r.name]), ...rowsOf(tokens)]);
      toast(`${Object.keys(tokens).length} tokens imported${skipped.length ? `, ${skipped.length} not supported` : ''}.`, skipped.length ? 'info' : 'success');
    } catch (e) { toast((e as Error).message, 'error'); }
  };
  const save = async () => {
    setBusy(true);
    try {
      const tokens = tokensOf(rows), live = useStore.getState().library.find((s) => s.id === item.id);
      if (!live) throw new Error(`No Library item "${item.name}".`);
      await saveItem({ subjectId: item.id, mode: 'overwrite', space: 'library', by: 'user', tokens });
      onDone();
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  const color = (r: Row) => { const t = Object.fromEntries(rows.map((x) => [x.name, { type: x.type, value: x.value }])) as Tokens; return String(resolveToken(t, r.name) ?? r.value); };
  return (
    <form className="kit-tokens" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="kit-tokens-rows">
        {rows.map((r, i) => types.includes(r.type) && (
          <div key={i} className="kit-token">
            {r.type === 'color'
              ? <input type="color" aria-label={`${r.name} color`} value={/^#[0-9a-f]{6}$/i.test(color(r)) ? color(r) : '#000000'} onChange={(e) => patch(i, { value: e.target.value })} />
              : <span className="kit-token-type faint">{LABELS[r.type]}</span>}
            <input aria-label="Token name" value={r.name} disabled={busy} onChange={(e) => patch(i, { name: e.target.value })} />
            <input aria-label={`${r.name} value`} value={r.value} disabled={busy} onChange={(e) => patch(i, { value: e.target.value })} />
            <IconButton icon={X} size="sm" label={`Remove ${r.name}`} onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))} />
          </div>
        ))}
      </div>
      <div className="kit-tokens-add">{types.map((t) => <Button key={t} size="sm" variant="ghost" icon={Plus} disabled={busy} onClick={() => add(t)}>{LABELS[t]}</Button>)}</div>
      <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ''; }} />
      <div className="confirm-pop-actions">
        <IconButton icon={Upload} size="sm" label="Import tokens" onClick={() => file.current?.click()} />
        <IconButton icon={Download} size="sm" label="Export tokens" disabled={!rows.length} onClick={() => { try { downloadBlob(new Blob([tokensToFile(tokensOf(rows))], { type: 'application/json' }), `${item.name}.tokens.json`); } catch (e) { toast((e as Error).message, 'error'); } }} />
        <Button size="sm" variant="primary" type="submit" loading={busy}>Save</Button>
      </div>
    </form>
  );
}
