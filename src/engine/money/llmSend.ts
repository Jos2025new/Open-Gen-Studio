import { storeTickets } from './storeBridge';

export { sendLlmViaPaidGate, type LlmPaidSendOpts, type LlmPaidSendOutcome } from './transport';
export function hasLlmPossibleCharge(runId: string | undefined): boolean {
  const status = runId && storeTickets.get(`llm:${runId}`)?.sends.at(-1)?.status;
  return status === 'in_flight' || status === 'uncertain';
}

export { reconcileUnknownCharge as reconcileLlmCharge } from './storeBridge';
