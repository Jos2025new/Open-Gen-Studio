import { useState } from 'react';
import { ArrowRight, Check, FastForward } from 'lucide-react';
import { EditAnswerButton } from './EditAnswerButton';
import { ClampText } from './PlanParts';
import { skipQuestions, submitAnswers } from '../../engine/agent/runtime';
import type { QuestionsFeedItem } from '../../engine/types';
import { Button } from '../ui/primitives';

/** An option the agent wrote as "label: what it means" shows the label first and the rest as a quiet line. Its value is unchanged. */
export function optionParts(o: string): { label: string; detail?: string } {
  const i = o.indexOf(': ');
  return i > 0 && i <= 40 ? { label: o.slice(0, i), detail: o.slice(i + 2) } : { label: o };
}
/** The agent's intro: its last question reads as the card's title; what comes before is a quiet context line. */
export function introParts(text: string): { title?: string; context?: string } {
  const sentences = text.trim().split(/(?<=[.!?])\s+/);
  const last = sentences.at(-1) ?? '';
  if (!last.endsWith('?') || last.length > 120) return { context: text.trim() };
  const context = sentences.slice(0, -1).join(' ').trim();
  return { title: last, ...(context ? { context } : {}) };
}
/** Long options go one per row, aligned, instead of chips of uneven width. */
const LONG_OPTION = 28;

export function QuestionsCard({ item, sessionId }: { item: QuestionsFeedItem; sessionId: string }) {
  // The agent's recommended options start selected: one click on Continue accepts them.
  // A reopened card starts from the user's earlier answers (an option, or their own words); else the recommended ones.
  const earlier = (q: (typeof item.questions)[number]) => item.answers?.[q.id];
  const [answers, setAnswers] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(item.questions.flatMap((q) => {
      const a = earlier(q);
      if (a != null) return [[q.id, q.options.filter((o) => a.split(', ').includes(o))]];
      return q.default ? [[q.id, [q.default]]] : [];
    })),
  );
  const [custom, setCustom] = useState<Record<string, string>>(() =>
    Object.fromEntries(item.questions.flatMap((q) => {
      const a = earlier(q);
      const own = a?.split(', ').filter((x) => !q.options.includes(x)).join(', ');
      return own ? [[q.id, own]] : [];
    })),
  );
  const pending = item.status === 'pending';
  // "Another answer" is a quiet link until used; a reopened card with the user's own words shows the field.
  const [typing, setTyping] = useState<Record<string, boolean>>({});

  if (!pending) {
    return (
      <article className="q-card is-done">
        <div className="q-kicker">
          <Check size={13} className="q-ok" aria-hidden />
          {`Questions · round ${item.round} of ${item.maxRounds}`} · {item.status === 'skipped' ? 'skipped' : 'answered'}
          <EditAnswerButton sessionId={sessionId} itemId={item.id} />
        </div>
        {item.answers ? (
          <ul className="q-summary">
            {item.questions.map((q) => (item.answers?.[q.id] ? <li key={q.id}><span className="faint">{q.question}</span> {item.answers[q.id]}</li> : null))}
            {item.answers.note ? <li><span className="faint">Note</span> {item.answers.note}</li> : null}
          </ul>
        ) : null}
      </article>
    );
  }

  const toggle = (qid: string, opt: string, multi: boolean) => {
    setAnswers((a) => {
      const cur = a[qid] ?? [];
      if (multi) return { ...a, [qid]: cur.includes(opt) ? cur.filter((o) => o !== opt) : [...cur, opt] };
      return { ...a, [qid]: cur[0] === opt ? [] : [opt] };
    });
    if (!multi) setCustom((c) => ({ ...c, [qid]: '' }));
  };

  const final = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const q of item.questions) {
      const parts = [...(answers[q.id] ?? [])];
      const c = custom[q.id]?.trim();
      if (c) parts.push(c);
      if (parts.length) out[q.id] = parts.join(', ');
    }
    return out;
  };
  const answered = Object.keys(final()).length;

  return (
    <article className="q-card q-ask">
      {item.maxRounds > 1 ? <div className="q-kicker">{`Round ${item.round} of ${item.maxRounds}`}</div> : null}
      {item.intro ? (() => {
        const { title, context } = introParts(item.intro);
        return (
          <header className="q-head">
            {title ? <h3 className="q-title">{title}</h3> : null}
            {context ? <ClampText className="q-intro">{context}</ClampText> : null}
          </header>
        );
      })() : null}
      {item.questions.map((q) => (
        <div key={q.id} className="q-block">
          <div className="q-question">{q.question}</div>
          <div className={`q-options${q.options.some((o) => o.length > LONG_OPTION) ? ' is-list' : ''}`}>
            {q.options.map((o) => {
              const on = (answers[q.id] ?? []).includes(o);
              const { label, detail } = optionParts(o);
              return (
                <button key={o} type="button" className={`q-opt ${on ? 'is-on' : ''}`} onClick={() => toggle(q.id, o, q.multi)} aria-pressed={on} aria-label={o} data-tip={detail ? o : undefined}>
                  {on ? <Check size={12} /> : null}
                  <span className="q-opt-text">
                    <span className="q-opt-label">{label}</span>
                    {detail ? <span className="q-opt-detail">{detail}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
          {q.allowCustom && !typing[q.id] && !custom[q.id] ? (
            <button type="button" className="q-other" onClick={() => setTyping((t) => ({ ...t, [q.id]: true }))}>Otra respuesta…</button>
          ) : q.allowCustom ? (
            <input
              autoFocus={typing[q.id]}
              className="q-custom"
              placeholder="Escribe tu respuesta…"
              value={custom[q.id] ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                setCustom((c) => ({ ...c, [q.id]: v }));
                if (v && !q.multi) setAnswers((a) => ({ ...a, [q.id]: [] }));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && answered) void submitAnswers(sessionId, item.id, final());
              }}
            />
          ) : null}
        </div>
      ))}
      <footer className="q-foot">
        <Button variant="ghost" size="sm" icon={FastForward} onClick={() => void skipQuestions(sessionId, item.id)} data-tip="Let the agent decide the rest">
          Skip, plan now
        </Button>
        <Button variant="primary" size="sm" disabled={!answered} onClick={() => void submitAnswers(sessionId, item.id, final())}>
          Continue <ArrowRight size={13} />
        </Button>
      </footer>
    </article>
  );
}
