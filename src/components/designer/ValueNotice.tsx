import { useValueNotice } from '../../engine/design/valueNotice';

/** Mount once per Designer board: shows the keyboard value notice (valueNotice.ts) for about a second. */
export function ValueNotice() {
  const text = useValueNotice();
  return text ? <div className="value-notice" role="status" aria-live="polite" style={{ position: 'absolute', left: '50%', bottom: 16, transform: 'translateX(-50%)', padding: '4px 10px', borderRadius: 6, background: 'rgba(0,0,0,.75)', color: '#fff', fontSize: 12, pointerEvents: 'none', zIndex: 20 }}>{text}</div> : null;
}
