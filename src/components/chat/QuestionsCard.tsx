import { useState } from 'react';
import { ArrowRight, Check, FastForward } from 'lucide-react';
import { skipQuestions, submitAnswers } from '../../engine/agent/runtime';
import type { QuestionsFeedItem } from '../../engine/types';
import { Button } from '../ui/primitives';

export function QuestionsCard({ item, sessionId }: { item: QuestionsFeedItem; sessionId: string }) {
  // The agent's recommended options start selected: one click on Continue accepts them.
  const [answers, setAnswers] = useState<Record<string, string[]>>(() => Object.fromEntries(item.questions.flatMap((q) => (q.default ? [[q.id, [q.default]]] : []))));
  const [custom, setCustom] = useState<Record<string, string>>({});
  const pending = item.status === 'pending';

  if (!pending) {
    return (
      <article className="q-card is-done">
        <div className="q-kicker">
          Questions · round {item.round} of {item.maxRounds} · {item.status === 'skipped' ? 'skipped' : 'answered'}
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
    <article className="q-card">
      <div className="q-kicker">
        Round {item.round} of {item.maxRounds}
      </div>
      {item.intro ? <p className="q-intro">{item.intro}</p> : null}
      {item.questions.map((q) => (
        <div key={q.id} className="q-block">
          <div className="q-question">{q.question}</div>
          <div className="q-options">
            {q.options.map((o) => {
              const on = (answers[q.id] ?? []).includes(o);
              return (
                <button key={o} type="button" className={`q-opt ${on ? 'is-on' : ''}`} onClick={() => toggle(q.id, o, q.multi)} aria-pressed={on}>
                  {on ? <Check size={12} /> : null}
                  {o}
                </button>
              );
            })}
          </div>
          {q.allowCustom ? (
            <input
              className="q-custom"
              placeholder="Or type your own…"
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
