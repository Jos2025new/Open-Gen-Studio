/**
 * An input a model cannot take, found before anything is sent. The code is stable and shown in the message
 * (e.g. "[VIDEO_DURATION]") so a failure can be traced to the rule that raised it.
 */
export class InputError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${message} [${code}]`);
    this.name = 'InputError';
    this.code = code;
  }
}
