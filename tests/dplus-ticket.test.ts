import { describe, expect, it } from 'vitest';
import {
  attachGenerationToSend,
  availableBudgetUsd,
  createTicket,
  estimatedPrice,
  exactPrice,
  FREE_PRICE,
  isFreePrice,
  isHeldStatus,
  isSendOut,
  markSendFailed,
  markSendInFlight,
  markSendSent,
  markSendUncertain,
  prepareSend,
  priceFromEstimate,
  reservationForPrice,
  rollbackSendToPending,
  roundUsd,
  sendStateOf,
  SendTransitionError,
  settleSend,
  sumPrices,
  ticketBookedUsd,
  ticketCommittedUsd,
  ticketReservedUsd,
  totalReservedUsd,
  UNKNOWN_PRICE,
} from '../src/engine/money/ticket';

describe('D+ ticket: precios (exacto / estimado / desconocido y maxVerifiableUsd)', () => {
  it('convierte Estimate a MoneyPrice distinguiendo exacto, estimado, lowerBound y desconocido', () => {
    expect(priceFromEstimate({ usd: 0, approximate: false })).toEqual(FREE_PRICE);
    expect(isFreePrice(priceFromEstimate({ usd: 0, approximate: false }))).toBe(true);

    const exact = priceFromEstimate({ usd: 0.1, approximate: false });
    expect(exact).toEqual({ kind: 'exact', usd: 0.1, maxVerifiableUsd: 0.1 });

    const est = priceFromEstimate({ usd: 0.12, approximate: true });
    expect(est).toEqual({ kind: 'estimated', usd: 0.12, maxVerifiableUsd: 0.12 });

    const lower = priceFromEstimate({ usd: 0.08, approximate: true, lowerBound: true, note: 'base' });
    expect(lower).toEqual({ kind: 'estimated', usd: 0.08, maxVerifiableUsd: null, lowerBound: true, note: 'base' });

    const unk = priceFromEstimate({ usd: null, approximate: true, note: 'unpriced' });
    expect(unk).toEqual({ kind: 'unknown', usd: null, maxVerifiableUsd: null, note: 'unpriced' });
  });

  it('sumPrices elimina maxVerifiableUsd si cualquier parte es unknown o lowerBound', () => {
    expect(sumPrices([exactPrice(0.1), exactPrice(0.2)])).toEqual({ kind: 'exact', usd: 0.3, maxVerifiableUsd: 0.3 });
    expect(sumPrices([exactPrice(0.1), estimatedPrice(0.05)])).toEqual({ kind: 'estimated', usd: 0.15, maxVerifiableUsd: 0.15 });
    expect(sumPrices([exactPrice(0.1), estimatedPrice(0.08, { lowerBound: true })])).toEqual({
      kind: 'estimated', usd: 0.18, maxVerifiableUsd: null, lowerBound: true,
    });
    expect(sumPrices([exactPrice(0.1), UNKNOWN_PRICE])).toEqual({
      kind: 'estimated', usd: 0.1, maxVerifiableUsd: null, lowerBound: true,
    });
    expect(sumPrices([UNKNOWN_PRICE])).toEqual(UNKNOWN_PRICE);
  });

  it('reservationForPrice devuelve 0 para gratis/desconocido y conserva la cota inferior como reserva minima', () => {
    expect(roundUsd(0.1 + 0.2)).toBe(0.3);
    expect(isHeldStatus('in_flight') && isHeldStatus('sent') && isHeldStatus('uncertain')).toBe(true);
    expect(isHeldStatus('pending') || isHeldStatus('done') || isHeldStatus('failed')).toBe(false);
    expect(isSendOut('done') && isSendOut('uncertain') && !isSendOut('pending') && !isSendOut('failed')).toBe(true);
    expect(reservationForPrice(FREE_PRICE)).toBe(0);
    expect(reservationForPrice(UNKNOWN_PRICE)).toBe(0);
    expect(reservationForPrice(exactPrice(0.1))).toBe(0.1);
    expect(reservationForPrice(estimatedPrice(0.08, { lowerBound: true }))).toBe(0.08);
  });
});

describe('D+ ticket: transiciones de estado, reservas y liquidacion idempotente', () => {
  it('recorre pending -> in_flight -> sent -> done liberando reserva y liquidando una sola vez por sendId', () => {
    let t = createTicket({
      id: 'tkt_1',
      sessionId: 'ses_1',
      kind: 'node_run',
      scope: { nodeIds: ['n1', 'n2'], steps: [{ cmd: 'nodes.node.rename' }, { cmd: 'nodes.run.start' }], signature: 'sig_1' },
      price: exactPrice(0.2),
    });
    t = prepareSend(t, { id: 'snd_1', slotKey: 'n1', price: exactPrice(0.1), nodeId: 'n1', now: 10 });
    t = prepareSend(t, { id: 'snd_2', slotKey: 'n2', price: exactPrice(0.1), nodeId: 'n2', now: 10 });
    // Idempotent re-prepare while pending:
    expect(prepareSend(t, { id: 'snd_1', slotKey: 'n1', price: exactPrice(0.1) })).toBe(t);
    expect(ticketReservedUsd(t)).toBe(0);

    t = markSendInFlight(t, 'snd_1', 20);
    expect(ticketReservedUsd(t)).toBe(0.1);
    expect(availableBudgetUsd(0.15, 0, [t])).toBe(0.05);

    t = attachGenerationToSend(t, 'snd_1', 'gen_1', 21);
    t = markSendSent(t, 'snd_1', { provider: 'atlas', id: 'j_1', meta: {} }, 25);
    expect(ticketReservedUsd(t)).toBe(0.1);
    expect(sendStateOf([t], { nodeId: 'n1' })).toMatchObject({ status: 'sent', alreadyOut: true, hasUncertain: false });
    expect(sendStateOf([t], { generationId: 'gen_1' })).toMatchObject({ status: 'sent', alreadyOut: true });

    const firstSettle = settleSend(t, 'snd_1', { costUsd: 0.08, estimated: false, now: 30 });
    expect(firstSettle.alreadyBooked).toBe(false);
    expect(firstSettle.bookedDeltaUsd).toBe(0.08);
    expect(firstSettle.bookedUnknown).toBe(false);
    expect(ticketReservedUsd(firstSettle.ticket)).toBe(0);
    expect(ticketBookedUsd(firstSettle.ticket)).toBe(0.08);

    // Calling settleSend again on the same sendId is strictly idempotent:
    const secondSettle = settleSend(firstSettle.ticket, 'snd_1', { costUsd: 0.08, estimated: false, now: 40 });
    expect(secondSettle.alreadyBooked).toBe(true);
    expect(secondSettle.bookedDeltaUsd).toBe(0);
    expect(secondSettle.ticket).toBe(firstSettle.ticket);
  });

  it('mantiene la reserva en uncertain hasta conciliacion o fallo confirmado y prohibe reenviar un slot ya salido', () => {
    let t = createTicket({ id: 'tkt_u', sessionId: 'ses_1', kind: 'generation', price: exactPrice(0.1) });
    t = prepareSend(t, { id: 'snd_u', slotKey: 'batch:0', price: exactPrice(0.1), nodeId: 'n1' });
    t = markSendInFlight(t, 'snd_u');
    t = markSendUncertain(t, 'snd_u', 'connection dropped after accept');

    expect(ticketReservedUsd(t)).toBe(0.1);
    expect(totalReservedUsd([t])).toBe(0.1);
    expect(availableBudgetUsd(0.15, 0, [t])).toBe(0.05);
    expect(sendStateOf([t], { nodeId: 'n1' })).toMatchObject({ status: 'uncertain', alreadyOut: true, hasUncertain: true });

    // Cannot re-prepare or re-enter in_flight for an uncertain send:
    expect(() => prepareSend(t, { id: 'snd_u', slotKey: 'batch:0', price: exactPrice(0.1) })).toThrow(SendTransitionError);
    expect(() => markSendInFlight(t, 'snd_u')).toThrow(SendTransitionError);

    // Adopting a recovered remote job transitions uncertain -> sent keeping reservation:
    const adopted = markSendSent(t, 'snd_u', { provider: 'nanogpt', id: 'j_rec', meta: {} });
    expect(ticketReservedUsd(adopted)).toBe(0.1);
    expect(sendStateOf([adopted], { sendId: 'snd_u' }).status).toBe('sent');

    // Confirming failure releases the reservation:
    const failed = markSendFailed(t, 'snd_u', 'confirmed not received');
    expect(ticketReservedUsd(failed)).toBe(0);
    expect(availableBudgetUsd(0.15, 0, [failed])).toBe(0.15);
    expect(sendStateOf([failed], { sendId: 'snd_u' })).toMatchObject({ status: 'failed', alreadyOut: false });
  });

  it('rollbackSendToPending libera reserva limpiamente y permite reintento sobre el mismo sendId', () => {
    let t = createTicket({ id: 'tkt_r', sessionId: 'ses_1', kind: 'llm', price: estimatedPrice(0.04) });
    t = prepareSend(t, { id: 'llm_1', slotKey: 'llm:iter-1', price: estimatedPrice(0.04) });
    t = markSendInFlight(t, 'llm_1');
    expect(ticketCommittedUsd(t)).toBe(0.04);

    t = rollbackSendToPending(t, 'llm_1');
    expect(ticketReservedUsd(t)).toBe(0);
    expect(ticketCommittedUsd(t)).toBe(0);
    expect(sendStateOf([t], { sendId: 'llm_1' })).toMatchObject({ status: 'pending', alreadyOut: false });

    // Can re-enter in_flight after rollback (e.g. Atlas Upstream access denied / LLM 400 reasoning):
    t = markSendInFlight(t, 'llm_1');
    expect(ticketReservedUsd(t)).toBe(0.04);
    const settled = settleSend(t, 'llm_1', { costUsd: null });
    expect(settled.bookedUnknown).toBe(true);
    expect(settled.bookedDeltaUsd).toBe(0);
    expect(ticketReservedUsd(settled.ticket)).toBe(0);
  });

  it('un solo registro cubre LLM (sin Generation), lotes dinamicos y tickets de comandos', () => {
    let llmTicket = createTicket({ id: 'tkt_llm', sessionId: 'ses_1', kind: 'llm', price: estimatedPrice(0.05) });
    llmTicket = prepareSend(llmTicket, { id: 'llm_iter_1', slotKey: 'llm:1', price: estimatedPrice(0.02) });
    llmTicket = prepareSend(llmTicket, { id: 'llm_iter_2', slotKey: 'llm:2', price: estimatedPrice(0.02) });
    llmTicket = markSendInFlight(llmTicket, 'llm_iter_1');
    llmTicket = settleSend(llmTicket, 'llm_iter_1', { costUsd: 0.03 }).ticket;
    llmTicket = markSendInFlight(llmTicket, 'llm_iter_2');

    expect(ticketBookedUsd(llmTicket)).toBe(0.03);
    expect(ticketReservedUsd(llmTicket)).toBe(0.02);
    expect(ticketCommittedUsd(llmTicket)).toBe(0.05);
    expect(sendStateOf([llmTicket], { ticketId: 'tkt_llm' })).toMatchObject({ status: 'in_flight', alreadyOut: true });
    expect(sendStateOf([llmTicket], { slotKey: 'llm:1' }).status).toBe('done');
    expect(sendStateOf([llmTicket], { slotKey: 'llm:2' }).status).toBe('in_flight');
    expect(sendStateOf([llmTicket], { nodeId: 'missing' })).toMatchObject({ status: 'none', alreadyOut: false });
  });
});
