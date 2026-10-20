import { useState } from 'react';
import { BookOpen, Braces, ChevronDown, Clock, ChevronRight, ClipboardList, LoaderCircle, MessageCircleQuestion, MessageSquare, Search, Wrench } from 'lucide-react';
import type { ActivityEntry, ActivityFeedItem, AgentState } from '../../engine/types';
import { useStore } from '../../store/store';
import { useNow } from '../ui/hooks';
import { seconds, waitDetail } from '../../engine/agent/schemaWait';

const ICONS = { guide: BookOpen, search: Search, questions: MessageCircleQuestion, plan: ClipboardList, fix: Wrench, schema: Braces } as const;
/** One shared empty list: a selector that returns a fresh [] each time makes the store re-render forever. */
const NO_WAITS: NonNullable<AgentState['waiting']> = [];
const PHASE = { working: 'Working', drafting: 'Drafting the plan', checking: 'Checking the plan' } as const;

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
      {/* Finished reasoning stays behind its line until opened; while it thinks, the newest lines show. */}
      {text && (open || live) ? <p className={`act-thought ${open ? 'is-open' : ''}`}>{preview}</p> : null}
    </li>
  );
}

/** What a finished turn did, in one line: its action labels, thinking left out (ADR 0024 M). */
function summary(entries: ActivityEntry[]): string {
  const labels = [...new Set(entries.flatMap((e) => (e.kind === 'thinking' ? [] : [e.label])))];
  return labels.length > 3 ? `${labels.slice(0, 3).join(', ')} +${labels.length - 3}` : labels.join(', ');
}

/** One agent turn: how long it worked, its reasoning (when streamed) and what it did (L3). Open while it runs, folded to one line once it ends. */
export function ActivityBlock({ item, sessionId }: { item: ActivityFeedItem; sessionId: string }) {
  const busy = useStore((s) => s.sessions[sessionId]?.agent.busy ?? false);
  const phase = useStore((s) => s.sessions[sessionId]?.agent.phase ?? 'working');
  const waiting = useStore((s) => s.sessions[sessionId]?.agent.waiting ?? NO_WAITS);
  const running = !item.endedAt && busy;
  const now = useNow(1000, running);
  const [userOpen, setOpen] = useState<boolean | null>(null);
  const open = userOpen ?? running;
  const elapsed = (item.endedAt ?? now) - item.startedAt;
  return (
    <section className={`activity ${running ? 'is-running' : ''}`} aria-live="polite">
      <button type="button" className="act-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        {running ? <LoaderCircle size={13} className="spin" /> : !item.entries.length ? <Clock size={13} /> : open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span>{running ? `${PHASE[phase]}… ${seconds(elapsed)}` : item.endedAt ? `Worked for ${seconds(elapsed)}` : 'Worked'}</span>
        {!open && !running && summary(item.entries) ? <span className="act-sum">{summary(item.entries)}</span> : null}
      </button>
      {open && (item.entries.length || (running && waiting.length)) ? (
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
          {running ? waiting.map((w) => (
            <li key={`${w.key}-${w.since}`} className="act-entry">
              <span className="act-line">
                <LoaderCircle size={13} className="spin" />
                <span>Loading schema</span>
                <span className="act-detail faint">{waitDetail(w.name, now - w.since)}</span>
              </span>
            </li>
          )) : null}
        </ol>
      ) : null}
    </section>
  );
}
