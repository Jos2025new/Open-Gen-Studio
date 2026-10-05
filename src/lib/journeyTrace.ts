export type JourneyName =
  | 'settings-response'
  | 'settings-correction'
  | 'variant-inputs'
  | 'plan-revision'
  | 'price-approval-execution';

export interface JourneyEvent {
  at: number;
  journeyId: string;
  journey: JourneyName;
  event: string;
  reason: string;
  sessionId?: string;
  planId?: string;
  stepId?: string;
  generationId?: string;
  approvalId?: string;
  before?: unknown;
  after?: unknown;
  prices?: { storedEstimateUsd?: number | null; liveEstimateUsd?: number | null; acceptedEstimateUsd?: number | null; currentEstimateUsd?: number | null; simulatedRequestUsd?: number | null };
}

const MAX_EVENTS = 300;
const journeys = new Map<string, string>();
let events: JourneyEvent[] = [];
let sequence = 0;

function active(): boolean {
  return import.meta.env.MODE === 'test' || (import.meta.env.DEV && typeof location !== 'undefined' && location.port === '5183');
}

export function beginJourney(sessionId: string, journey: JourneyName): string | undefined {
  if (!active()) return undefined;
  const id = `${sessionId}:${Date.now()}:${++sequence}`;
  journeys.set(sessionId, id);
  recordJourneyEvent({ journeyId: id, journey, event: 'request.started', reason: 'journey capture started', sessionId });
  return id;
}

export function journeyIdFor(sessionId: string): string | undefined {
  return active() ? journeys.get(sessionId) : undefined;
}

export function approvalEstimateForPlan(planId: string | undefined): { approvalId?: string; acceptedEstimateUsd?: number | null } {
  if (!planId || !active()) return {};
  const approval = [...events].reverse().find((event) => event.event === 'plan.approved' && event.planId === planId);
  return approval ? { approvalId: approval.approvalId, acceptedEstimateUsd: approval.prices?.acceptedEstimateUsd } : {};
}

export function recordJourneyEvent(event: Omit<JourneyEvent, 'at'>): void {
  if (!active()) return;
  try {
    const copy = structuredClone({ ...event, at: Date.now() }) as JourneyEvent;
    events.push(copy);
    if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS);
  } catch {
    // Diagnostic capture must never affect the decision or the request.
  }
}

/** Explicit diagnostic read for tests and the sandbox console; it has no UI or persistence. */
export function lastJourneyTrace(): JourneyEvent[] {
  return active() ? structuredClone(events) : [];
}

export function clearJourneyTrace(): void {
  if (!active()) return;
  events = [];
  journeys.clear();
}
