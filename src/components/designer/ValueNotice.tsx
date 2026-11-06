import { useValueNotice } from '../../engine/design/valueNotice';

/** Mount once per Designer board: shows the keyboard value notice (valueNotice.ts) for about a second. */
export function ValueNotice() {
  const text = useValueNotice();
  return text ? <div className="value-notice" role="status" aria-live="polite">{text}</div> : null;
}
