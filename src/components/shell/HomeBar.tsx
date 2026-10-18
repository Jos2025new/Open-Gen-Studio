import { useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Paperclip, X } from 'lucide-react';
import { setComposer, useStore } from '../../store/store';
import { attachFiles } from '../../engine/actions';
import { sendAgentMessage } from '../../engine/agent/runtime';
import { SPACES, openSpace } from './navModel';

/** The Home prompt: submitting opens Studio and sends the message there. Same guard as the Composer: not while the agent is busy. */
export function HomeBar() {
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const busy = useStore((s) => s.sessions[s.activeSessionId]?.agent.busy ?? false);
  const attachments = useStore((s) => s.composer.attachments);
  const assets = useStore((s) => s.assets);
  const live = attachments.filter((id) => assets[id]);
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
    <div className="home-bar-row">
      <button type="button" className="home-chip" onClick={() => fileRef.current?.click()}><Paperclip size={14} />Attach</button>
      <input ref={fileRef} type="file" hidden multiple accept="image/*,video/mp4,video/webm,audio/*" onChange={(e) => {
        const files = [...(e.target.files ?? [])];
        e.target.value = '';
        if (files.length) void attachFiles(files);
      }} />
      <p className="home-bar-helper">The agent plans it and asks before spending</p>
    </div>
    {live.length > 0 && <ul className="home-bar-files" aria-label="Attached files">
      {live.map((id) => <li key={id}><span>{assets[id].name || assets[id].kind}</span>
        <button type="button" aria-label="Remove" onClick={() => setComposer((c) => ({ attachments: c.attachments.filter((a) => a !== id) }))}><X size={12} /></button>
      </li>)}
    </ul>}
  </form>;
}
