import { useState } from 'react';
import { BookOpen, ChevronDown, Clock, ChevronRight, ClipboardList, LoaderCircle, MessageCircleQuestion, MessageSquare, Search, Wrench } from 'lucide-react';
import type { ActivityEntry, ActivityFeedItem } from '../../engine/types';
import { useStore } from '../../store/store';
import { useNow } from '../ui/hooks';

const ICONS = { guide: BookOpen, search: Search, questions: MessageCircleQuestion, plan: ClipboardList, fix: Wrench } as const;
const PHASE = { working: 'Working', drafting: 'Drafting the plan', checking: 'Checking the plan' } as const;

const seconds = (ms: number) => `${Math.max(1, Math.round(ms / 1000))}s`;

function Thinking({ entry, live }: { entry: Extract<ActivityEntry, { kind: 'thinking' }>; live: boolean }) {
  const [open, setOpen] = useState(false);
  const text = entry.text.trim();
  // While it thinks, the preview follows the newest lines; afterwards it starts at the beginning.
  const preview = live && !open && text.length > 240 ? `…${text.slice(-240)}` : text;
  return (
    <li className="act-entry act-thinking">
      <button type="button" className="act-line" onClick={() => setOpen((v) => !v)} aria-expanded={open} disabled={!text}>
        <MessageSquare size={13} />
        <span>{live ? 'Thinking…' : entry.ms != null ? `Thought for ${seconds(entry.ms)}` : 'Thought it through'}</span>
        {text ? open ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : null}
      </button>
      {text ? <p className={`act-thought ${open ? 'is-open' : ''}`}>{preview}</p> : null}
    </li>
  );
}

/** One agent turn: how long it worked, its reasoning (when streamed) and what it did (L3). */
export function ActivityBlock({ item, sessionId }: { item: ActivityFeedItem; sessionId: string }) {
  const busy = useStore((s) => s.sessions[sessionId]?.agent.busy ?? false);
  const phase = useStore((s) => s.sessions[sessionId]?.agent.phase ?? 'working');
  const running = !item.endedAt && busy;
  const now = useNow(1000, running);
  const [open, setOpen] = useState(true);
  const elapsed = (item.endedAt ?? now) - item.startedAt;
  return (
    <section className={`activity ${running ? 'is-running' : ''}`} aria-live="polite">
      <button type="button" className="act-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {running ? <LoaderCircle size={13} className="spin" /> : !item.entries.length ? <Clock size={13} /> : open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span>{running ? `${PHASE[phase]}… ${seconds(elapsed)}` : item.endedAt ? `Worked for ${seconds(elapsed)}` : 'Worked'}</span>
      </button>
      {open && item.entries.length ? (
        <ol className="act-list">
          {item.entries.map((e, i) =>
            e.kind === 'thinking' ? (
              <Thinking key={i} entry={e} live={running && i === item.entries.length - 1 && e.ms == null} />
            ) : (
              <li key={i} className="act-entry">
                <span className="act-line">
                  {(() => {
                    const Icon = ICONS[e.icon];
                    return <Icon size={13} />;
                  })()}
                  <span>{e.label}</span>
                  {e.detail ? <span className="act-detail faint">{e.detail}</span> : null}
                </span>
              </li>
            ),
          )}
        </ol>
      ) : null}
    </section>
  );
}
