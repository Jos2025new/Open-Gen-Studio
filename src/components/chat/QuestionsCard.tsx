import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, FastForward } from 'lucide-react';
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
  // One question at a time (2026-10-25): Continue goes to the next, "Skip question" leaves this one out, Plan now skips all.
  const [step, setStep] = useState(0);
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set());

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
      if (skipped.has(q.id)) continue;
      const parts = [...(answers[q.id] ?? [])];
      const c = custom[q.id]?.trim();
      if (c) parts.push(c);
      if (parts.length) out[q.id] = parts.join(', ');
    }
    return out;
  };

  const total = item.questions.length;
  const q = item.questions[Math.min(step, total - 1)];
  const last = step >= total - 1;
  const has = (id: string) => Boolean((answers[id] ?? []).length || custom[id]?.trim());
  const finish = (out: Record<string, string>) => void (Object.keys(out).length ? submitAnswers(sessionId, item.id, out) : skipQuestions(sessionId, item.id));
  const next = () => (last ? finish(final()) : setStep(step + 1));
  const skipOne = () => {
    const now = new Set(skipped).add(q.id);
    setSkipped(now);
    if (!last) return setStep(step + 1);
    const out = final();
    for (const id of now) delete out[id];
    finish(out);
  };
  const back = () => { setSkipped((x) => { const n = new Set(x); n.delete(item.questions[step - 1].id); return n; }); setStep(step - 1); };

  return (
    <article className="q-card q-ask card-m">
      {total > 1 || item.maxRounds > 1 ? (
        <div className="q-kicker">
          {total > 1 ? <span className="q-count">{step + 1}/{total}</span> : null}
          {item.maxRounds > 1 ? <span>{`Round ${item.round} of ${item.maxRounds}`}</span> : null}
        </div>
      ) : null}
      {item.intro && step === 0 ? <ClampText className="q-intro">{item.intro}</ClampText> : null}
      <div key={q.id} className="q-block">
        <div className="q-question">{q.question}</div>
        {(() => {
          const list = q.options.some((o) => optionParts(o).label.length > LONG_OPTION);
          // Short options are one segmented control, like Borrador / Alta calidad; long ones are rows with their detail.
          if (!list) {
            const said = (answers[q.id] ?? []).map((o) => optionParts(o).detail).filter(Boolean);
            return (
              <>
                <span className="q-options cc-seg" role="group" aria-label={q.question}>
                  {q.options.map((o) => {
                    const on = (answers[q.id] ?? []).includes(o);
                    return <button key={o} type="button" className={on ? 'is-on' : ''} onClick={() => toggle(q.id, o, q.multi)} aria-pressed={on} aria-label={o}>{on ? <Check size={12} /> : null}{optionParts(o).label}</button>;
                  })}
                </span>
                {said.length ? <p className="q-opt-note">{said.join(' · ')}</p> : null}
              </>
            );
          }
          return (
            <div className="q-options is-list">
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
          );
        })()}
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
              if (e.key === 'Enter' && has(q.id)) next();
            }}
          />
        ) : null}
      </div>
      <footer className="q-foot">
        {step > 0 ? <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={back} aria-label="Previous question" data-tip="Previous question" /> : null}
        {total > 1 ? <Button variant="ghost" size="sm" onClick={skipOne} data-tip="Leave this question out">Skip question</Button> : null}
        <span className="q-foot-gap" />
        <Button variant="ghost" size="sm" icon={FastForward} onClick={() => void skipQuestions(sessionId, item.id)} data-tip="Skip the questions; the agent decides the rest">
          Plan now
        </Button>
        <Button variant="primary" size="sm" disabled={!has(q.id)} onClick={next}>
          Continue <ArrowRight size={13} />
        </Button>
      </footer>
    </article>
  );
}
