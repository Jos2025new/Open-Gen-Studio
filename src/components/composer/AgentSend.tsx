import { ArrowUp, CircleStop } from 'lucide-react';
import { stopAgent } from '../../engine/agent/runtime';

export function AgentSend({ busy, canSend, submit }: { busy: boolean; canSend: boolean; submit: () => void }) {
  return busy ? (
    <button type="button" className="send-btn is-stop" onClick={() => stopAgent()} aria-label="Stop" data-tip="Stop the agent"><CircleStop size={16} /></button>
  ) : (
    <button type="button" className="send-btn is-agent" disabled={!canSend} onClick={submit} aria-label="Send" data-tip="Send (Enter)"><ArrowUp size={16} strokeWidth={2.2} /></button>
  );
}
