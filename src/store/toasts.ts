import { uid } from '../lib/id';
import { useStore, type Toast } from './store';

/** Short notices at the bottom (Toasts.tsx); the same text is never shown twice at once. An action is one button that fixes what it is about. */
export function toast(text: string, level: Toast['level'] = 'info', ms?: number, action?: Toast['action']): void {
  if (useStore.getState().ui.toasts.some((t) => t.text === text)) return;
  const id = uid('tst');
  useStore.setState((st) => ({ ui: { ...st.ui, toasts: [...st.ui.toasts.slice(-3), { id, text, level, action }] } }));
  window.setTimeout(() => dismissToast(id), ms ?? (level === 'error' ? 6500 : 3200));
}

export function dismissToast(id: string): void {
  useStore.setState((st) => ({ ui: { ...st.ui, toasts: st.ui.toasts.filter((t) => t.id !== id) } }));
}
