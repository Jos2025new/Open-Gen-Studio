import { logEvent } from '../../lib/log';
import type { TurnOutcome } from './turnLog';

export const SILENCE_MS = 60_000;
export const TURN_CAP_MS = 5 * 60_000;
/** Past this, append one warning for this turn (a running stream cannot be interrupted). */
const HURRY_MS = 50_000;
const HURRY_NOTE =
  '<system_warning>For this agent turn only, until the next user request: the user has been waiting over 50 seconds. Be brief. If you have the answer, give it now; if you need a tool, call it now; if you cannot do it, say so in one sentence. Do not deliberate further.</system_warning>';

export interface TurnGuard {
  turnStart: number;
  isDone: () => boolean;
  isCut: () => boolean;
  setOutcome: (next: TurnOutcome) => void;
  armSilence: () => void;
  checkOverCap: () => boolean;
  takeHurryNote: () => string | undefined;
  finish: (say?: () => void) => void;
  cancel: (say: () => void) => void;
  handleAbort: (sayStopped: () => void) => void;
}

/** Manages the silence watchdog, 5-minute turn cap, hurry warning, and once-only turn cleanup. */
export function createTurnGuard(opts: {
  sessionId: string;
  controller: AbortController;
  onSilence: () => void;
  onLimitNote: () => void;
  onFinish: (outcome: TurnOutcome) => void;
}): TurnGuard {
  const turnStart = Date.now();
  let outcome: TurnOutcome = 'text';
  let hurryNoted = false;
  // If nothing comes out for a minute the activity block says so (Stop is in the composer); output re-arms it.
  // The five-minute cap is the only thing that ends a turn by force (T3).
  let silenceTimer: ReturnType<typeof setTimeout> | undefined;
  let armedAt = 0;
  let cutTurn = false;
  let done = false;

  const armSilence = () => {
    const now = Date.now();
    if (done) return;
    if (now - armedAt < 5_000) return; // a stream of deltas must not churn timers
    armedAt = now;
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(opts.onSilence, SILENCE_MS);
  };

  // The end of the turn, once: Stop and the cap call it; the turn's own exit finds it done and leaves a newer turn alone.
  const finish = (say?: () => void) => {
    if (done) return;
    done = true;
    say?.();
    clearTimeout(silenceTimer);
    clearTimeout(capTimer);
    opts.onFinish(outcome);
  };

  const cut = () => {
    cutTurn = true;
    outcome = 'cut';
    logEvent('agent', { session: opts.sessionId, event: 'turn-cut', limit: 'turn', ms: TURN_CAP_MS });
    opts.controller.abort();
    finish(opts.onLimitNote);
  };

  const capTimer = setTimeout(cut, TURN_CAP_MS);

  return {
    turnStart,
    isDone: () => done,
    isCut: () => cutTurn,
    setOutcome: (next) => { outcome = next; },
    armSilence,
    checkOverCap: () => {
      if (!cutTurn && Date.now() - turnStart <= TURN_CAP_MS) return false;
      if (!cutTurn) logEvent('agent', { session: opts.sessionId, event: 'turn-cut', limit: 'turn', ms: Date.now() - turnStart });
      outcome = 'cut';
      opts.onLimitNote();
      return true;
    },
    takeHurryNote: () => {
      if (hurryNoted || Date.now() - turnStart <= HURRY_MS) return undefined;
      hurryNoted = true;
      return HURRY_NOTE;
    },
    finish,
    cancel: (say) => {
      outcome = 'canceled';
      finish(say);
    },
    handleAbort: (sayStopped) => {
      // Stop and the cap already said so and ended the turn; this is an abort from elsewhere.
      outcome = cutTurn ? 'cut' : 'canceled';
      if (!done) (cutTurn ? opts.onLimitNote : sayStopped)();
    },
  };
}
