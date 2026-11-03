import { z } from 'zod';
import type { ToolSpec } from '../providers/llm';
import { PROVIDER_LABELS } from '../providers/types';
import { checkJobsNow } from '../providers/shared';
import { traceOf } from '../jobTrace';
import { OPS } from '../ops';
import { useStore } from '../../store/store';
import { formatDuration } from '../../lib/format';
import type { Generation } from '../types';

/*
 * generation_status: the agent's look at what is generating right now, only when the user asks ("¿cómo va?") or it
 * needs to know. Read-only and free: check_now ends the polls' waits (the same as "Check status") so each provider
 * is asked at once, then the answer is the live trace of Details → Trace.
 */

export const JOB_TOOLS: ToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'generation_status',
      description:
        "Live state of this session's generations still queued or running: model, status, progress, elapsed time, provider job id and the latest provider checks (the polling trace). Any canvas, read-only, no charge. check_now (default true) asks the providers again right away and waits a few seconds for their answer. Call it only when the user asks how a generation is going or you need to know before acting; never in a loop.",
      parameters: { type: 'object', properties: { check_now: { type: 'boolean' } } },
    },
  },
];

export const generationStatusSchema = z.object({ check_now: z.boolean().optional() }).strict();

const ACTIVE = new Set<Generation['status']>(['queued', 'running']);
const WAIT_MS = 8000;

function clock(t: number): string {
  return new Date(t).toLocaleTimeString('en-GB', { hour12: false });
}

export function describeRunning(g: Generation, now = Date.now()): string {
  const what = g.op ? OPS[g.op.id].label : `"${g.prompt.length > 80 ? `${g.prompt.slice(0, 79)}…` : g.prompt}"`;
  const head = [
    `generation:${g.id}`,
    `${g.kind} · ${g.modelName}${g.provider !== 'local' ? ` (${PROVIDER_LABELS[g.provider]})` : ''}`,
    what,
    `status ${g.status}${g.statusText ? ` — ${g.statusText}` : ''}`,
    g.progress != null ? `progress ${Math.round(g.progress * (g.progress <= 1 ? 100 : 1))}%` : '',
    `running for ${formatDuration(now - (g.startedAt ?? g.createdAt))}`,
    g.jobId ?? g.remoteJob?.id ? `job ${g.jobId ?? g.remoteJob?.id}` : g.lostJob ? 'no job id came back (the provider may still have it)' : '',
  ].filter(Boolean);
  const trace = traceOf(g.id).slice(-8);
  const last = trace.at(-1);
  const lines = trace.length
    ? `  trace (oldest first): ${trace.map((e) => `${clock(e.at)} ${e.text}`).join(' | ')}\n  last answer from the provider ${formatDuration(now - last!.at)} ago`
    : '  trace: no check recorded since the app opened';
  return `- ${head.join(' · ')}\n${lines}`;
}

/** The text the tool answers with. `until` stops the wait when the turn is stopped. */
export async function generationStatus(sessionId: string, checkNow: boolean, until: <T>(work: Promise<T>) => Promise<T>): Promise<string> {
  const mine = () => Object.values(useStore.getState().generations).filter((g) => g.sessionId === sessionId);
  const running = mine().filter((g) => ACTIVE.has(g.status));
  if (!running.length) {
    const last = mine().sort((a, b) => (b.finishedAt ?? b.createdAt) - (a.finishedAt ?? a.createdAt))[0];
    return `Nothing is queued or running in this session right now.${last ? ` Latest generation: generation:${last.id} · ${last.modelName} · ${last.status}${last.error ? ` (${last.error})` : ''}.` : ''}`;
  }
  let note = '';
  if (checkNow) {
    const before = new Map(running.map((g) => [g.id, traceOf(g.id).at(-1)?.at ?? 0]));
    checkJobsNow();
    const answered = () => running.every((g) => (traceOf(g.id).at(-1)?.at ?? 0) > before.get(g.id)! || !ACTIVE.has(useStore.getState().generations[g.id]?.status));
    const started = Date.now();
    while (!answered() && Date.now() - started < WAIT_MS) await until(new Promise((r) => setTimeout(r, 250)));
    if (!answered()) note = `\n(Some providers had not answered within ${WAIT_MS / 1000}s; their last known state is shown. A job still uploading or submitting is not polled yet.)`;
  }
  const now = Date.now();
  const st = useStore.getState().generations;
  return `${running.length} in progress:\n${running.map((g) => describeRunning(st[g.id] ?? g, now)).join('\n')}${note}`;
}
