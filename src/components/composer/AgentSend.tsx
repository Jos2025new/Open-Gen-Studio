import { ArrowUp, CircleStop } from '../ui/icons';

export function AgentSend({ busy, canSend, submit, stop }: { busy: boolean; canSend: boolean; submit: () => void; stop: () => void }) {
  return busy ? (
    <button type="button" className="send-btn is-stop" onClick={stop} aria-label="Stop" data-tip="Stop the agent"><CircleStop size={16} /></button>
  ) : (
    <button type="button" className="send-btn is-agent" disabled={!canSend} onClick={submit} aria-label="Send" data-tip="Send (Enter)"><ArrowUp size={16} strokeWidth={2.2} /></button>
  );
}
