import { pushAlert } from './alerts';
import { logged } from '../lib/log';

const shown = new Set<string>();

/**
 * A result could not be copied to this computer (it stays only at the provider, whose links expire): said once per
 * reason, not only in the log, so a later step that needs its bytes (a reference for a video) does not fail unexplained.
 */
export function notKept(what: string): (err: unknown) => undefined {
  const log = logged(what);
  return (err) => {
    log(err);
    const reason = err instanceof Error ? err.message : String(err);
    if (!shown.has(reason)) {
      shown.add(reason);
      pushAlert({ level: 'warn', text: `A result could not be saved on this computer and stays only at the provider (its link expires). ${reason}. The app tries again on the next start.` });
    }
    return undefined;
  };
}
