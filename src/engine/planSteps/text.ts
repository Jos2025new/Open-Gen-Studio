import type { TextStep } from '../types';
import type { RawStep } from '../plan';
import type { StepEnv } from './env';

export async function normalizeText(s: RawStep, env: StepEnv): Promise<void> {
  const { errors, steps } = env;
  const where = `Step ${s.id}`;
  const title = (s.title ?? '').trim() || s.id!;
  if (!s.text?.trim()) errors.push(`${where}: text steps need "text".`);
  steps.push({ id: s.id!, kind: 'text', title, text: s.text?.trim() ?? '' } satisfies TextStep);
}
