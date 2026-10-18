import { useState, type FormEvent } from 'react';
import { ArrowRight } from 'lucide-react';
import { useStore } from '../../store/store';
import { sendAgentMessage } from '../../engine/agent/runtime';
import { SPACES, openSpace } from './navModel';

/** The Home prompt: submitting opens Studio and sends the message there. Same guard as the Composer: not while the agent is busy. */
export function HomeBar() {
  const [text, setText] = useState('');
  const busy = useStore((s) => s.sessions[s.activeSessionId]?.agent.busy ?? false);
  const canSend = !busy && text.trim().length > 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    const message = text.trim();
    setText('');
    openSpace(SPACES[0]);
    void sendAgentMessage(message);
  };

  return <form className="home-bar-wrap" onSubmit={submit}>
    <div className="home-bar">
      <input className="home-bar-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Describe what you want to make..." aria-label="Describe what you want to make" />
      <button type="submit" className="home-bar-go" disabled={!canSend} aria-label="Send to Studio"><ArrowRight size={18} /></button>
    </div>
    <p className="home-bar-helper">The agent plans it and asks before spending</p>
  </form>;
}
