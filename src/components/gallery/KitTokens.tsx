import { useEffect, useRef, useState } from 'react';
import { downloadBlob } from '../../lib/media';
import { mergeTokens, resolveToken, tokenModes, tokensIn } from '../../engine/libraryTokens';
import { tokensFromFile, tokensToFile, withMode, type TokenFormat } from '../../engine/libraryTokensFile';
import { TOKEN_TYPES, type KitToken, type KitTokens as Tokens, type KitTokenType } from '../../engine/libraryTypes';
import type { Subject } from '../../engine/types';
import { Download, Plus, Upload, X } from '../ui/icons';
import { Button, IconButton } from '../ui/primitives';
import { toast } from '../../store/store';
import { saveItem } from '../../engine/libraryVersions';
import './KitTokens.css';

interface Row { name: string; type: KitTokenType; value: string; description?: string; modes?: Record<string, string>; }
const LABELS: Record<KitTokenType, string> = { color: 'Color', dimension: 'Size', fontFamily: 'Font', number: 'Number', string: 'Text' };
const START: Record<KitTokenType, string> = { color: '#000000', dimension: '16px', fontFamily: 'Inter', number: '1', string: '' };
const rowsOf = (tokens?: Tokens): Row[] => Object.entries(tokens ?? {}).map(([name, t]) => ({ name, type: t.type, value: String(t.value), ...(t.description ? { description: t.description } : {}), ...(t.modes ? { modes: Object.fromEntries(Object.entries(t.modes).map(([m, v]) => [m, String(v)])) } : {}) }));

const names = (list: readonly string[]) => (list.length > 4 ? `${list.slice(0, 4).join(', ')} and ${list.length - 4} more` : list.join(', '));

/** Row texts as tokens; a number typed as text is a number again. */
function tokensOf(rows: readonly Row[]): Tokens {
  const out: Tokens = {};
  for (const r of rows) {
    const name = r.name.trim(), text = r.value.trim();
    if (!name) throw new Error('Every token needs a name.');
    if (out[name]) throw new Error(`Two tokens are named "${name}".`);
    const val = (t: string): KitToken['value'] => (r.type === 'number' && t && Number.isFinite(Number(t)) ? Number(t) : t);
    const modes = Object.entries(r.modes ?? {}).flatMap(([m, v]) => (v.trim() && v.trim() !== text ? [[m, val(v.trim())]] : []));
    out[name] = { type: r.type, value: val(text), ...(r.description ? { description: r.description } : {}), ...(modes.length ? { modes: Object.fromEntries(modes) as KitToken['modes'] } : {}) };
  }
  return out;
}

/** The design tokens of a design system or brand kit: seen, edited, imported and exported. Save makes a version; so does leaving with edits. */
export function KitTokens({ item, onDone, types = TOKEN_TYPES }: { item: Subject; onDone?: () => void; /** Only these types show; the rest stay as they are. */ types?: readonly KitTokenType[] }) {
  const [rows, setRows] = useState(() => rowsOf(item.tokens)), [modes, setModes] = useState(() => tokenModes(item.tokens)), [busy, setBusy] = useState(false), [exporting, setExporting] = useState(false), file = useRef<HTMLInputElement>(null);
  // Edits are kept over what the entry gets meanwhile (a font uploaded, the agent), and saved when the editor closes.
  const base = useRef(item.tokens), edits = useRef(rows);
  edits.current = rows;
  const mine = () => ({ from: tokensOf(rowsOf(base.current)), to: tokensOf(edits.current) });
  const store = () => { const { from, to } = mine(); return saveItem({ subjectId: item.id, mode: 'overwrite', space: 'library', by: 'user', tokens: (live) => mergeTokens(from, to, live) }); };
  useEffect(() => {
    if (item.tokens === base.current) return;
    try {
      const { from, to } = mine(), next = mergeTokens(from, to, tokensOf(rowsOf(item.tokens)));
      base.current = item.tokens;
      setRows(rowsOf(next));
      setModes((ms) => [...new Set([...ms, ...tokenModes(next)])]);
    } catch { /* a row is half written: the edits are placed when they are saved */ }
  }, [item.tokens]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    try {
      const { from, to } = mine();
      if (JSON.stringify(from) !== JSON.stringify(to)) store().then(() => toast(`"${item.name}" saved.`, 'success'), (e: Error) => toast(`Not saved: ${e.message}`, 'error'));
    } catch (e) { toast(`Not saved: ${(e as Error).message}`, 'error'); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const patch = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const add = (type: KitTokenType) => setRows((rs) => {
    let n = 1;
    const stem = LABELS[type].toLowerCase();
    while (rs.some((r) => r.name === `${stem}.${n}`)) n++;
    return [...rs, { name: `${stem}.${n}`, type, value: START[type] }];
  });
  const importFiles = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    try {
      // Several files are the modes of one set of tokens (Figma writes one per mode): the light or shortest one is the base.
      const stem = (f: File) => f.name.replace(/(\.tokens)?\.json$/i, '');
      const [main, ...more] = [...files].sort((a, b) => Number(/light|default|base/i.test(stem(b))) - Number(/light|default|base/i.test(stem(a))) || stem(a).length - stem(b).length);
      const read = tokensFromFile(await main.text()), skipped = [...read.skipped], off = read.off;
      let tokens = read.tokens;
      for (const f of more) {
        const r = tokensFromFile(await f.text());
        skipped.push(...r.skipped.filter((n) => !skipped.includes(n)));
        tokens = withMode(tokens, (stem(f).startsWith(`${stem(main)}.`) ? stem(f).slice(stem(main).length + 1) : stem(f)) || 'Mode', r.tokens);
      }
      const importedCount = Object.keys(tokens).length;
      if (!importedCount) {
        toast(`No supported tokens found in ${main.name}${skipped.length ? ` (not supported: ${names(skipped)})` : ''}.`, 'error');
        return;
      }
      const nextRows = [...edits.current.filter((r) => !tokens[r.name]), ...rowsOf(tokens)];
      edits.current = nextRows;
      setModes((ms) => [...new Set([...ms, ...tokenModes(tokens)])]);
      setRows(nextRows);
      // Persist immediately so swatches, section tiles, and Designer auto-link update right away.
      try {
        base.current = (await store()).tokens;
      } catch (saveErr) {
        toast(`Tokens loaded, but not saved: ${(saveErr as Error).message}`, 'error');
        return;
      }
      toast(`${importedCount} ${importedCount === 1 ? 'token' : 'tokens'} imported${skipped.length ? `. Not supported: ${names(skipped)}` : ''}${off.length ? `. Sets not in use: ${names(off)}` : ''}.`, skipped.length || off.length ? 'info' : 'success');
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  const exportFile = (format: TokenFormat) => {
    try {
      const tokens = tokensOf(rows), files = format === 'penpot' ? [{ name: '.penpot', tokens }] : [undefined, ...tokenModes(tokens)].map((m) => ({ name: m ? `.${m}` : '', tokens: tokensIn(tokens, m) }));
      const left = new Set<string>();
      for (const f of files) {
        const r = tokensToFile(f.tokens, format, item.name);
        r.left.forEach((n) => left.add(n));
        downloadBlob(new Blob([r.text], { type: 'application/json' }), `${item.name}${f.name}.tokens.json`);
      }
      setExporting(false);
      if (left.size) toast(`Left out, not in this format: ${names([...left])}.`, 'info');
    } catch (e) { toast((e as Error).message, 'error'); }
  };
  const save = async () => {
    setBusy(true);
    try { base.current = (await store()).tokens; onDone?.(); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  const color = (r: Row, mode?: string) => { const t = Object.fromEntries(rows.map((x) => [x.name, { type: x.type, value: x.value, modes: Object.fromEntries(Object.entries(x.modes ?? {}).filter(([, v]) => v.trim())) }])) as Tokens; return String(resolveToken(t, r.name, mode) ?? r.value); };
  const swatch = (name: string, shown: string, value: string, set: (v: string) => void) => <input type="color" aria-label={`${name} color`} value={/^#[0-9a-f]{6}/i.exec(shown)?.[0].toLowerCase() ?? '#000000'} onChange={(e) => set(e.target.value + (/^#[0-9a-f]{6}([0-9a-f]{2})$/i.exec(value)?.[1] ?? ''))} />;
  const visibleCount = rows.filter((r) => types.includes(r.type)).length;
  const emptyNoun = types.length === 1 ? `${LABELS[types[0]].toLowerCase()}s` : 'tokens';
  return (
    <form className="kit-tokens" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      {visibleCount === 0 ? (
        <div className="kit-tokens-empty">
          <p className="faint">{`No ${emptyNoun} yet. Add one below or import a tokens.json file.`}</p>
          <Button size="sm" variant="secondary" icon={Upload} disabled={busy} onClick={() => file.current?.click()}>Import tokens.json</Button>
        </div>
      ) : null}
      <div className="kit-tokens-rows">
        {rows.map((r, i) => types.includes(r.type) && (
          <div key={i} className="kit-token">
            {r.type === 'color'
              ? swatch(r.name, color(r), r.value, (value) => patch(i, { value }))
              : <span className="kit-token-type faint">{LABELS[r.type]}</span>}
            <input aria-label="Token name" value={r.name} disabled={busy} onChange={(e) => patch(i, { name: e.target.value })} />
            <input aria-label={`${r.name} value`} value={r.value} disabled={busy} onChange={(e) => patch(i, { value: e.target.value })} />
            <IconButton icon={X} size="sm" label={`Remove ${r.name}`} onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))} />
            {modes.filter((m) => r.type === 'color' || r.modes?.[m] !== undefined).map((m) => { const set = (v: string) => patch(i, { modes: { ...r.modes, [m]: v } }); return <div key={m} className="kit-token-mode">
              {r.type === 'color' ? swatch(`${r.name} ${m}`, color(r, m), r.modes?.[m] ?? '', set) : <span />}
              <span className="faint">{m}</span>
              <input aria-label={`${r.name} ${m} value`} placeholder={r.value} value={r.modes?.[m] ?? ''} disabled={busy} onChange={(e) => set(e.target.value)} /></div>; })}
          </div>
        ))}
      </div>
      <div className="kit-tokens-add">{types.map((t) => <Button key={t} size="sm" variant="ghost" icon={Plus} disabled={busy} onClick={() => add(t)}>{LABELS[t]}</Button>)}{!modes.length && rows.length > 0 && types.includes('color') && <Button size="sm" variant="ghost" icon={Plus} disabled={busy} onClick={() => setModes(['Dark'])}>Dark mode</Button>}</div>
      <input ref={file} type="file" aria-label="Import tokens JSON" accept=".json,application/json" multiple hidden onChange={(e) => { void importFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
      <div className="confirm-pop-actions">
        <IconButton icon={Upload} size="sm" label="Import tokens" disabled={busy} onClick={() => file.current?.click()} />
        <IconButton icon={Download} size="sm" label="Export tokens" active={exporting} disabled={!rows.length} onClick={() => setExporting((v) => !v)} />
        {exporting && <>
          <Button size="sm" variant="ghost" onClick={() => exportFile('w3c')}>W3C / Figma</Button>
          <Button size="sm" variant="ghost" onClick={() => exportFile('penpot')}>Penpot</Button>
        </>}
        <Button size="sm" variant="primary" type="submit" loading={busy}>Save</Button>
      </div>
    </form>
  );
}
