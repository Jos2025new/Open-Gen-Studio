import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { diskAvailable } from '../../lib/disk';
import { useStore } from '../../store/store';
import { Button } from '../ui/primitives';

interface DiskInfo { path: string; parts: Record<string, { files: number; bytes: number }> }

const size = (b: number) => (b < 1024 ? `${b} B` : b < 1 << 20 ? `${(b / 1024).toFixed(0)} KB` : b < 1 << 30 ? `${(b / (1 << 20)).toFixed(1)} MB` : `${(b / (1 << 30)).toFixed(2)} GB`);
const PART_LABELS: Record<string, string> = { 'state.json': 'Sessions, chats, settings', asset: 'Media files', raster: 'Designer paint layers' };

/** Settings → Data: what is saved, where, and a ZIP of it (media + state without API keys). */
export function DataSummary() {
  const sessions = useStore((s) => s.sessions);
  const assets = useStore((s) => s.assets);
  const generations = useStore((s) => s.generations);
  const library = useStore((s) => s.library);
  const [disk, setDisk] = useState<DiskInfo | null | 'none'>(null);

  useEffect(() => {
    let live = true;
    void diskAvailable().then(async (ok) => {
      if (!ok) { if (live) setDisk('none'); return; }
      const info = await fetch('/x/store/info', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (live) setDisk(info ?? 'none');
    });
    return () => { live = false; };
  }, []);

  const list = Object.values(sessions);
  const messages = list.reduce((n, s) => n + s.feed.filter((f) => f.type === 'user').length, 0);
  const designs = list.reduce((n, s) => n + s.docs.length, 0);
  const nodes = list.reduce((n, s) => n + s.graph.nodes.length, 0);
  const byKind: Record<string, number> = {};
  for (const a of Object.values(assets)) byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
  const rows: [string, string][] = [
    ['Sessions', String(list.length)],
    ['Your messages', String(messages)],
    ['Generations', String(Object.keys(generations).length)],
    ['Files', Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(' · ') || '0'],
    ['Designs · nodes', `${designs} · ${nodes}`],
    ['Library', String(library.length)],
  ];
  const total = disk && disk !== 'none' ? Object.values(disk.parts).reduce((t, p) => t + p.bytes, 0) : 0;

  return (
    <div className="data-summary">
      <dl className="data-rows">
        {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="num">{v}</dd></div>)}
      </dl>
      {disk === null ? <p className="set-note">Reading the disk copy…</p> : disk === 'none' ? (
        <p className="set-note">No disk copy: the app is served without its local server, so everything lives only in this browser.</p>
      ) : (
        <>
          <dl className="data-rows">
            {Object.entries(disk.parts).map(([k, p]) => <div key={k}><dt>{PART_LABELS[k] ?? k}</dt><dd className="num">{p.files > 1 ? `${p.files} files · ` : ''}{size(p.bytes)}</dd></div>)}
            <div><dt>Total</dt><dd className="num">{size(total)}</dd></div>
          </dl>
          <p className="set-note">Saved in <code className="data-path">{disk.path}</code>. That folder holds only your work: deleting it does not break the app (it starts empty).</p>
          <Button size="sm" variant="ghost" icon={Download} onClick={() => { window.location.href = '/x/store/export'; }} data-tip="Media, chats, designs, nodes and settings. API keys are left out.">
            Download all as ZIP
          </Button>
        </>
      )}
    </div>
  );
}
