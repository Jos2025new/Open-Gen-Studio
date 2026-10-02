import { create } from 'zustand';
import { uid } from '../lib/id';

/*
 * Warnings shown right above the prompt box until closed: what needs the user now (no credit, a switched model,
 * an agent error). Not saved; the conversation keeps its own record.
 */

export interface AlertAction {
  label: string;
  run: () => void;
}
export interface Alert {
  id: string;
  level: 'info' | 'warn' | 'error';
  text: string;
  actions?: AlertAction[];
}

export const useAlerts = create<{ alerts: Alert[] }>(() => ({ alerts: [] }));

/** Show a warning above the prompt box (the newest three stay; the same text is not repeated). */
export function pushAlert(a: Omit<Alert, 'id'>): string {
  const id = uid('al');
  useAlerts.setState((s) => ({ alerts: [...s.alerts.filter((x) => x.text !== a.text), { ...a, id }].slice(-3) }));
  return id;
}

export function dismissAlert(id: string): void {
  useAlerts.setState((s) => ({ alerts: s.alerts.filter((x) => x.id !== id) }));
}
