import { useEffect, useState } from 'react';
import { ArrowDownToLine, Check, X } from 'lucide-react';
import { AssetMedia } from './AssetMedia';
import { Popover, PopoverHeader, usePopover } from './Popover';
import { Button, IconButton } from './primitives';
import { TopbarActions } from '../shell/TopBar';

export interface ChatItem {
  id: string;
  assetId?: string;
  label: string;
}

interface ImportResultsProps {
  sessionId: string;
  canvas: 'node' | 'designer' | 'chat';
  source: 'Chat' | 'Nodes';
  items: ChatItem[];
  noun: string;
  modes?: Array<{ id: string; label: string }>;
  onImport: (ids: string[], mode?: string) => void;
  notice?: boolean;
}

/**
 * Import from Chat, on the node canvas and in the Designer: a toolbar button with a dialog to pick what to bring
 * (all checked by default), plus a notice above the canvas while something new is waiting. The notice closes
 * with ✕ and stays closed until more results arrive (remembered per session and canvas in this browser).
 */
function ImportResults({ sessionId, canvas, source, items, noun, modes, onImport, notice = true }: ImportResultsProps) {
  const pop = usePopover();
  const [picked, setPicked] = useState<string[]>([]);
  const [mode, setMode] = useState(modes?.[0]?.id);
  const key = source === 'Chat' ? `ogs.fromChat.${canvas}.${sessionId}` : `ogs.fromNodes.${canvas}.${sessionId}`;
  const [closedAt, setClosedAt] = useState(0);
  useEffect(() => {
    try {
      setClosedAt(Number(localStorage.getItem(key)) || 0);
    } catch {
      setClosedAt(0);
    }
  }, [key]);
  useEffect(() => {
    if (pop.open) setPicked(items.map((i) => i.id));
    // Opening the dialog picks everything waiting; later changes to the list keep the user's choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pop.open]);
  const close = () => {
    setClosedAt(items.length);
    try {
      localStorage.setItem(key, String(items.length));
    } catch {
      /* storage blocked: closed for this view only */
    }
  };
  const run = (ids: string[], m?: string) => {
    onImport(ids, m);
    pop.close();
  };
  const plural = (n: number) => `${n} ${noun}${n === 1 ? '' : 's'}`;
  return (
    <>
      <TopbarActions>
      <IconButton ref={pop.ref} className={`import-chat-btn ${canvas === 'designer' ? 'designer-import-chat' : 'node-import-chat'}`} icon={ArrowDownToLine} label={`Import from ${source}`} size="sm" active={pop.open} onClick={pop.toggle} />
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={360} label={`Import from ${source}`}>
        <PopoverHeader title={`Import from ${source}`} sub={items.length ? `${plural(items.length)} not here yet` : `Everything from ${source} is already here`} />
        {items.length ? (
          <>
            <div className="import-list">
              {items.map((i) => {
                const on = picked.includes(i.id);
                return (
                  <button key={i.id} type="button" className={`import-row ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={() => setPicked((xs) => (on ? xs.filter((x) => x !== i.id) : [...xs, i.id]))}>
                    <span className="import-check">{on ? <Check size={12} /> : null}</span>
                    {i.assetId ? (
                      <span className="attach-thumb small">
                        <AssetMedia assetId={i.assetId} hoverPlay={false} />
                      </span>
                    ) : null}
                    <span className="import-label">{i.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="import-foot">
              <button type="button" className="faint import-all" onClick={() => setPicked(picked.length === items.length ? [] : items.map((i) => i.id))}>
                {picked.length === items.length ? 'None' : 'All'}
              </button>
              {modes ? (
                <select className="ml-filter" aria-label="How" value={mode} onChange={(e) => setMode(e.target.value)}>
                  {modes.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              ) : null}
              <Button size="sm" variant="primary" disabled={!picked.length} onClick={() => run(picked, mode)}>
                Import {picked.length || ''}
              </Button>
            </div>
          </>
        ) : null}
      </Popover>
      </TopbarActions>
      {notice && items.length > closedAt ? (
        <div className="node-from-chat" role="status">
          <span>{plural(items.length)} from {source}</span>
          {modes ? (
            modes.map((m) => (
              <Button key={m.id} size="sm" onClick={() => onImport(items.map((i) => i.id), m.id)}>{m.label}</Button>
            ))
          ) : (
            <Button size="sm" onClick={() => onImport(items.map((i) => i.id))}>{canvas === 'chat' ? 'Add to Chat' : 'Add as nodes'}</Button>
          )}
          <Button size="sm" variant="ghost" onClick={pop.toggle}>Choose…</Button>
          <IconButton icon={X} label="Close" size="sm" onClick={close} />
        </div>
      ) : null}
    </>
  );
}

export function ImportFromChat(props: Omit<ImportResultsProps, 'source' | 'canvas'> & { canvas: 'node' | 'designer' }) {
  return <ImportResults {...props} source="Chat" />;
}

export function ImportFromNodes(props: Omit<ImportResultsProps, 'source' | 'canvas' | 'notice'>) {
  return <ImportResults {...props} canvas="chat" source="Nodes" notice={false} />;
}
