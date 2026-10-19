import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { History, Star } from 'lucide-react';
import { loadPromptHistory, promptHistoryDirection, recordPrompt, subscribePromptHistory, toggleFavorite, type PromptHistory as HistoryData } from '../../lib/promptHistory';
import { setComposer, toast } from '../../store/store';
import { Popover, usePopover } from '../ui/Popover';
import { Button, IconButton, Segmented } from '../ui/primitives';
import './prompt-history.css';

const failed = () => toast('Prompt history could not be saved or loaded in this browser.', 'error');
export const recordCreatePrompt = (text: string) => { void recordPrompt(text).catch(failed); };

export function usePromptHistory(text: string) {
  const [history, setHistory] = useState<HistoryData>({ recents: [], favorites: [] });
  const cursor = useRef({ index: -1, draft: '', value: '' });
  useEffect(() => {
    let alive = true;
    const load = () => { void loadPromptHistory().then((h) => { if (alive) setHistory(h); }).catch(() => { if (alive) failed(); }); };
    load();
    const stop = subscribePromptHistory(load);
    return () => { alive = false; stop(); };
  }, []);
  const choose = (value: string) => { cursor.current = { index: -1, draft: '', value }; setComposer({ text: value }); };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.nativeEvent.isComposing) return;
    const dir = promptHistoryDirection(text, e.currentTarget.selectionStart, e.currentTarget.selectionEnd, e.key);
    if (!dir || !history.recents.length) return;
    const cur = cursor.current;
    if (text !== cur.value) cur.index = -1;
    if (cur.index === -1 && dir === 1) return;
    if (cur.index === -1) cur.draft = text;
    const index = Math.max(-1, Math.min(history.recents.length - 1, cur.index - dir));
    const value = index < 0 ? cur.draft : history.recents[index];
    cursor.current = { index, value, draft: cur.draft };
    e.preventDefault();
    setComposer({ text: value });
  };
  return { history, choose, onKeyDown };
}

export function PromptHistory({ history, onChoose }: { history: HistoryData; onChoose: (text: string) => void }) {
  const pop = usePopover();
  const [tab, setTab] = useState<'recents' | 'favorites'>('recents');
  return <>
    <Button ref={pop.ref} size="sm" variant="ghost" icon={History} aria-expanded={pop.open} onClick={pop.toggle}>Prompt history</Button>
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={360} label="Prompt history">
      <div className="prompt-history">
        <Segmented value={tab} onChange={setTab} size="sm" options={[{ value: 'recents', label: 'Recent' }, { value: 'favorites', label: 'Favorites' }]} />
        {history.favorites.length >= 1000 ? <p role="status">1000 or more favorites. Nothing is removed automatically; you can unstar prompts you no longer need.</p> : null}
        {history[tab].length ? history[tab].map((text) => <div key={text} className="prompt-history-row">
          <button type="button" className="prompt-history-text" onClick={() => { onChoose(text); pop.close(); }}>{text}</button>
          <IconButton icon={Star} label={history.favorites.includes(text) ? 'Unstar prompt' : 'Star prompt'} active={history.favorites.includes(text)} aria-pressed={history.favorites.includes(text)} onClick={() => void toggleFavorite(text).catch(failed)} />
        </div>) : <p className="faint">{tab === 'recents' ? 'Prompts appear after Generate.' : 'Star a recent prompt to keep it here.'}</p>}
      </div>
    </Popover>
  </>;
}
