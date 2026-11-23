// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  availableBudgetUsd,
  createTicket,
  estimatedPrice,
  exactPrice,
  FREE_PRICE,
  markSendInFlight,
  markSendUncertain,
  prepareSend,
  sendStateOf,
  settleSend,
  ticketReservedUsd,
  UNKNOWN_PRICE,
  type ApprovalTicket,
} from '../src/engine/money/ticket';
import {
  defaultClassifySendError,
  evaluateBudgetGate,
  heldSendLocks,
  PAID_SEND_SAVE_TIMEOUT_MS,
  paidSend,
  PaidSendBlockedError,
  resetSendLocks,
  type SpendBooking,
  type TicketAccess,
} from '../src/engine/money/paidSend';
import { removeTicket, upsertTicket, useStore } from '../src/store/store';
import { addSpend } from '../src/store/spend';
import { budgetVerdict, remainingBudget, withOncePass } from '../src/engine/budget';
import {
  budgetSnapshotFor,
  canWriteTicket,
  saveTicketMark,
  slotPriceForGeneration,
  storeTickets,
} from '../src/engine/money/storeBridge';
import { createFakeProvider, simulateReload, snapshotStore, sseResponse, type FakeProvider } from './helpers/fakeProvider';

function createMemoryHarness(initialBudget = { budgetOn: true, budgetUsd: 1.0, spentUsd: 0 }) {
  const map = new Map<string, ApprovalTicket>();
  const bookings: SpendBooking[] = [];
  const budget = { ...initialBudget };
  let saves = 0;

  const tickets: TicketAccess = {
    get: (id) => map.get(id),
    list: () => [...map.values()],
    put: (t) => { map.set(t.id, t); },
  };

  const onBookSpend = (b: SpendBooking) => {
    bookings.push(b);
    if (b.usd != null) budget.spentUsd = Math.round((budget.spentUsd + b.usd) * 10000) / 10000;
  };

  const save = async () => { saves += 1; };

  return {
    map,
    tickets,
    budget,
    bookings,
    getBudget: () => ({ ...budget }),
    onBookSpend,
    save,
    get saves() { return saves; },
  };
}

let fake: FakeProvider;

beforeEach(() => {
  resetSendLocks();
  fake = createFakeProvider({ defaultImageCost: 0.1, defaultLlmCost: 0.01 });
  fake.install();
});

afterEach(() => {
  resetSendLocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('D+ paidSend: puerta unica, presupuesto con reservas, pases, candado y durabilidad', () => {
  it('dos envios concurrentes de $0.10 con tope $0.15: el primero reserva sincrono antes de save y el segundo se bloquea', async () => {
    const h = createMemoryHarness({ budgetOn: true, budgetUsd: 0.15, spentUsd: 0 });
    h.tickets.put(createTicket({ id: 't1', sessionId: 's1', kind: 'node_run', price: exactPrice(0.1) }));
    h.tickets.put(createTicket({ id: 't2', sessionId: 's1', kind: 'node_run', price: exactPrice(0.1) }));

    const held = fake.holdNext('alpha');
    const p1 = paidSend({
      ticketId: 't1',
      prepare: { id: 'snd_1', slotKey: 'n1', price: exactPrice(0.1), nodeId: 'n1' },
      tickets: h.tickets,
      getBudget: h.getBudget,
      save: h.save,
      onBookSpend: h.onBookSpend,
      send: async () => {
        const res = await fetch('https://nano-gpt.com/api/v1/images', { method: 'POST', body: JSON.stringify({ prompt: 'alpha' }) });
        const json = (await res.json()) as { cost: number };
        return { value: json, costUsd: json.cost, estimated: false };
      },
    });

    await held.arrived;
    expect(availableBudgetUsd(0.15, h.budget.spentUsd, h.tickets.list())).toBe(0.05);

    // Concurrent second send must be rejected synchronously before touching save() or fetch():
    await expect(
      paidSend({
        ticketId: 't2',
        prepare: { id: 'snd_2', slotKey: 'n2', price: exactPrice(0.1), nodeId: 'n2' },
        tickets: h.tickets,
        getBudget: h.getBudget,
        save: h.save,
        onBookSpend: h.onBookSpend,
        send: async () => {
          await fetch('https://nano-gpt.com/api/v1/images', { method: 'POST', body: JSON.stringify({ prompt: 'beta' }) });
          return { value: 'beta', costUsd: 0.1 };
        },
      }),
    ).rejects.toMatchObject({ name: 'PaidSendBlockedError', code: 'OVER_LIMIT' });

    held.resolve();
    await p1;

    expect(fake.acceptedCount('/v1/images')).toBe(1);
    expect(h.budget.spentUsd).toBe(0.1);
    expect(h.bookings).toHaveLength(1);
    expect(heldSendLocks()).toEqual([]);
  });

  it('corte tras aceptar (cutAfterAccept) deja el envio uncertain, retiene reserva y bloquea reenvio del mismo sendId', async () => {
    const h = createMemoryHarness({ budgetOn: true, budgetUsd: 0.15, spentUsd: 0 });
    h.tickets.put(createTicket({ id: 't_cut', sessionId: 's1', kind: 'generation', price: exactPrice(0.1) }));
    fake.onNext('cut shot', 'cut-after-accept');

    await expect(
      paidSend({
        ticketId: 't_cut',
        prepare: { id: 'snd_cut', slotKey: 'batch:0', price: exactPrice(0.1) },
        tickets: h.tickets,
        getBudget: h.getBudget,
        save: h.save,
        onBookSpend: h.onBookSpend,
        send: async () => {
          await fetch('https://nano-gpt.com/api/v1/images', { method: 'POST', body: JSON.stringify({ prompt: 'cut shot' }) });
          return { value: 'ok', costUsd: 0.1 };
        },
      }),
    ).rejects.toThrow(TypeError);

    expect(fake.acceptedCount('cut shot')).toBe(1);
    expect(sendStateOf(h.tickets.list(), { sendId: 'snd_cut' })).toMatchObject({ status: 'uncertain', alreadyOut: true, hasUncertain: true });
    expect(ticketReservedUsd(h.tickets.get('t_cut')!)).toBe(0.1);
    expect(availableBudgetUsd(0.15, h.budget.spentUsd, h.tickets.list())).toBe(0.05);

    // Attempting to re-send the same sendId is rejected immediately:
    await expect(
      paidSend({
        ticketId: 't_cut',
        sendId: 'snd_cut',
        tickets: h.tickets,
        getBudget: h.getBudget,
        save: h.save,
        onBookSpend: h.onBookSpend,
        send: async () => ({ value: 'dup', costUsd: 0.1 }),
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_SENT' });

    // A second independent $0.10 send is ALSO blocked while the $0.10 uncertain reservation is held:
    h.tickets.put(createTicket({ id: 't_other', sessionId: 's1', kind: 'generation', price: exactPrice(0.1) }));
    await expect(
      paidSend({
        ticketId: 't_other',
        prepare: { id: 'snd_other', slotKey: 'other', price: exactPrice(0.1) },
        tickets: h.tickets,
        getBudget: h.getBudget,
        save: h.save,
        onBookSpend: h.onBookSpend,
        send: async () => ({ value: 'other', costUsd: 0.1 }),
      }),
    ).rejects.toMatchObject({ code: 'OVER_LIMIT' });
  });

  it('tope acumulado en pase once (Allow this time): aprueba $0.10 y rechaza subida a $0.40 o exceso en 2o paso', async () => {
    const h = createMemoryHarness({ budgetOn: true, budgetUsd: 0.05, spentUsd: 0 });
    h.tickets.put(
      createTicket({
        id: 't_once',
        sessionId: 's1',
        kind: 'commands',
        price: exactPrice(0.1),
        pass: { kind: 'once', maxUsd: 0.1 },
      }),
    );

    // Price jumped from $0.10 to $0.40 before send -> blocked with PASS_EXCEEDED:
    await expect(
      paidSend({
        ticketId: 't_once',
        prepare: { id: 'snd_big', slotKey: 'n1', price: exactPrice(0.4) },
        tickets: h.tickets,
        getBudget: h.getBudget,
        save: h.save,
        onBookSpend: h.onBookSpend,
        send: async () => ({ value: 'nope', costUsd: 0.4 }),
      }),
    ).rejects.toMatchObject({ code: 'PASS_EXCEEDED' });

    // Within $0.10 cap succeeds once:
    await paidSend({
      ticketId: 't_once',
      prepare: { id: 'snd_ok', slotKey: 'n1', price: exactPrice(0.1) },
      tickets: h.tickets,
      getBudget: h.getBudget,
      save: h.save,
      onBookSpend: h.onBookSpend,
      send: async () => ({ value: 'ok', costUsd: 0.1 }),
    });
    expect(h.budget.spentUsd).toBe(0.1);

    // Second $0.05 send on the SAME $0.10 once pass exceeds cumulative cap ($0.10 booked + $0.05 > $0.10):
    await expect(
      paidSend({
        ticketId: 't_once',
        prepare: { id: 'snd_extra', slotKey: 'n2', price: exactPrice(0.05) },
        tickets: h.tickets,
        getBudget: h.getBudget,
        save: h.save,
        onBookSpend: h.onBookSpend,
        send: async () => ({ value: 'extra', costUsd: 0.05 }),
      }),
    ).rejects.toMatchObject({ code: 'PASS_EXCEEDED' });
  });

  it('precio desconocido o lowerBound bloquea bajo limite activo salvo excepcion explicita allowUnknown', async () => {
    const h = createMemoryHarness({ budgetOn: true, budgetUsd: 1.0, spentUsd: 0 });
    const tLower = createTicket({ id: 't_lb', sessionId: 's1', kind: 'generation', price: estimatedPrice(0.08, { lowerBound: true }) });
    const tUnk = createTicket({ id: 't_unk', sessionId: 's1', kind: 'llm', price: UNKNOWN_PRICE });
    const tApprovedUnk = createTicket({
      id: 't_unk_ok', sessionId: 's1', kind: 'llm', price: UNKNOWN_PRICE, pass: { kind: 'once', maxUsd: null, allowUnknown: true },
    });
    h.tickets.put(tLower);
    h.tickets.put(tUnk);
    h.tickets.put(tApprovedUnk);

    expect(evaluateBudgetGate({ ticket: tLower, price: tLower.price, budget: h.getBudget(), allTickets: h.tickets.list() }))
      .toMatchObject({ ok: false, code: 'UNKNOWN_PRICE' });
    expect(evaluateBudgetGate({ ticket: tUnk, price: UNKNOWN_PRICE, budget: h.getBudget(), allTickets: h.tickets.list() }))
      .toMatchObject({ ok: false, code: 'UNKNOWN_PRICE' });

    const out = await paidSend({
      ticketId: 't_unk_ok',
      prepare: { id: 'snd_unk', slotKey: 'llm:1', price: UNKNOWN_PRICE },
      tickets: h.tickets,
      getBudget: h.getBudget,
      save: h.save,
      onBookSpend: h.onBookSpend,
      send: async () => ({ value: 'answered', costUsd: null }),
    });
    expect(out.value).toBe('answered');
    expect(h.bookings).toEqual([{ ticketId: 't_unk_ok', sendId: 'snd_unk', usd: null, estimated: true }]);
  });

  it('fallo o timeout de save() (o perdida de writerLock) revierte a pending y nunca llama a send()', async () => {
    expect(PAID_SEND_SAVE_TIMEOUT_MS).toBe(8000);
    expect(defaultClassifySendError({ name: 'JobFailedError' })).toBe('job_failed');
    expect(defaultClassifySendError({ status: 402, message: 'No credit' })).toBe('refused_before_charge');
    expect(defaultClassifySendError({ status: 400, message: 'Unsupported reasoning_effort' })).toBe('retryable_before_charge');
    expect(defaultClassifySendError({ status: 500, message: 'Upstream access denied' })).toBe('retryable_before_charge');
    expect(defaultClassifySendError(new TypeError('Failed to fetch'))).toBe('uncertain');
    const h = createMemoryHarness({ budgetOn: true, budgetUsd: 1.0, spentUsd: 0 });
    h.tickets.put(createTicket({ id: 't_save', sessionId: 's1', kind: 'generation', price: exactPrice(0.1) }));
    let transportCalls = 0;

    // Timeout during durable save:
    await expect(
      paidSend({
        ticketId: 't_save',
        prepare: { id: 'snd_timeout', slotKey: 's1', price: exactPrice(0.1) },
        tickets: h.tickets,
        getBudget: h.getBudget,
        save: () => new Promise<void>(() => undefined),
        saveTimeoutMs: 25,
        onBookSpend: h.onBookSpend,
        send: async () => { transportCalls++; return { value: 'never', costUsd: 0.1 }; },
      }),
    ).rejects.toMatchObject({ code: 'SAVE_FAILED' });

    expect(transportCalls).toBe(0);
    expect(ticketReservedUsd(h.tickets.get('t_save')!)).toBe(0);
    expect(sendStateOf(h.tickets.list(), { sendId: 'snd_timeout' }).status).toBe('pending');

    // Lost writer lock:
    await expect(
      paidSend({
        ticketId: 't_save',
        sendId: 'snd_timeout',
        tickets: h.tickets,
        getBudget: h.getBudget,
        save: h.save,
        canWrite: () => false,
        onBookSpend: h.onBookSpend,
        send: async () => { transportCalls++; return { value: 'never', costUsd: 0.1 }; },
      }),
    ).rejects.toMatchObject({ code: 'SAVE_FAILED' });
    expect(transportCalls).toBe(0);
  });

  it('reintentos pre-cobro (Atlas Upstream access denied / LLM 400 reasoning) y 402 liberan reserva limpiamente', async () => {
    const h = createMemoryHarness({ budgetOn: true, budgetUsd: 0.15, spentUsd: 0 });
    h.tickets.put(createTicket({ id: 't_llm', sessionId: 's1', kind: 'llm', price: estimatedPrice(0.05) }));

    // 1st attempt: HTTP 400 reasoning -> retryable_before_charge rolls slot back to pending with 0 reservation.
    fake.onNext('/chat/completions', 'http-400-reasoning');
    await expect(
      paidSend({
        ticketId: 't_llm',
        prepare: { id: 'llm_call_1', slotKey: 'llm:1', price: estimatedPrice(0.05) },
        tickets: h.tickets,
        getBudget: h.getBudget,
        save: h.save,
        onBookSpend: h.onBookSpend,
        send: async () => {
          const res = await fetch('https://nano-gpt.com/api/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'paid-llm' }) });
          if (!res.ok) throw Object.assign(new Error('Unsupported reasoning_effort'), { status: res.status });
          return { value: await res.text(), costUsd: 0.04 };
        },
      }),
    ).rejects.toThrow(/reasoning_effort/i);

    expect(sendStateOf(h.tickets.list(), { sendId: 'llm_call_1' }).status).toBe('pending');
    expect(ticketReservedUsd(h.tickets.get('t_llm')!)).toBe(0);

    // 2nd attempt on the SAME sendId succeeds and settles real SSE cost ($0.04):
    fake.onNext('/chat/completions', () => sseResponse([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }, { choices: [], usage: { cost: 0.04 } }]));
    const ok = await paidSend({
      ticketId: 't_llm',
      sendId: 'llm_call_1',
      tickets: h.tickets,
      getBudget: h.getBudget,
      save: h.save,
      onBookSpend: h.onBookSpend,
      send: async () => {
        const res = await fetch('https://nano-gpt.com/api/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'paid-llm' }) });
        return { value: await res.text(), costUsd: 0.04, estimated: false };
      },
    });
    expect(ok.settled?.bookedDeltaUsd).toBe(0.04);
    expect(h.budget.spentUsd).toBe(0.04);

    // 402 refused_before_charge marks failed and releases reservation so a 402 substitute ticket can run:
    h.tickets.put(createTicket({ id: 't_402', sessionId: 's1', kind: 'generation', price: exactPrice(0.1) }));
    fake.onNext('/v1/images', 'http-402');
    await expect(
      paidSend({
        ticketId: 't_402',
        prepare: { id: 'snd_402', slotKey: 'img:0', price: exactPrice(0.1) },
        tickets: h.tickets,
        getBudget: h.getBudget,
        save: h.save,
        onBookSpend: h.onBookSpend,
        send: async () => {
          const res = await fetch('https://nano-gpt.com/api/v1/images', { method: 'POST', body: JSON.stringify({ prompt: 'fail402' }) });
          if (!res.ok) throw Object.assign(new Error('Insufficient credits'), { status: 402 });
          return { value: 'never', costUsd: 0.1 };
        },
      }),
    ).rejects.toThrow(/Insufficient credits/i);

    expect(sendStateOf(h.tickets.list(), { sendId: 'snd_402' }).status).toBe('failed');
    expect(ticketReservedUsd(h.tickets.get('t_402')!)).toBe(0);
    expect(availableBudgetUsd(0.15, h.budget.spentUsd, h.tickets.list())).toBe(0.11);
  });

  it('envio gratis ($0 exacto) o local nunca para ni pasa por la puerta de pago aunque el limite este agotado', async () => {
    const h = createMemoryHarness({ budgetOn: true, budgetUsd: 0.01, spentUsd: 5.0 });
    h.tickets.put(createTicket({ id: 't_free', sessionId: 's1', kind: 'generation', price: FREE_PRICE }));
    let t = h.tickets.get('t_free')!;
    t = prepareSend(t, { id: 'snd_free', slotKey: 'free', price: FREE_PRICE });
    h.tickets.put(t);

    const out = await paidSend({
      ticketId: 't_free',
      sendId: 'snd_free',
      tickets: h.tickets,
      getBudget: h.getBudget,
      save: h.save,
      onBookSpend: h.onBookSpend,
      send: async () => ({ value: 'free-ok', costUsd: 0 }),
    });
    expect(out.free).toBe(true);
    expect(out.value).toBe('free-ok');
    expect(h.saves).toBe(0);
    expect(h.bookings).toHaveLength(0);
  });

  it('candado unico rechaza doble entrada concurrente sobre la misma lockKey (p. ej. mismo nodo)', async () => {
    const h = createMemoryHarness({ budgetOn: true, budgetUsd: 1.0, spentUsd: 0 });
    h.tickets.put(createTicket({ id: 't_lk1', sessionId: 's1', kind: 'node_run', price: exactPrice(0.1) }));
    h.tickets.put(createTicket({ id: 't_lk2', sessionId: 's1', kind: 'node_run', price: exactPrice(0.1) }));

    const held = fake.holdNext('lock shot');
    const first = paidSend({
      ticketId: 't_lk1',
      prepare: { id: 'snd_lk1', slotKey: 'n1', price: exactPrice(0.1), nodeId: 'n1' },
      lockKeys: ['node:n1'],
      tickets: h.tickets,
      getBudget: h.getBudget,
      save: h.save,
      onBookSpend: h.onBookSpend,
      send: async () => {
        await fetch('https://nano-gpt.com/api/v1/images', { method: 'POST', body: JSON.stringify({ prompt: 'lock shot' }) });
        return { value: 'ok', costUsd: 0.1 };
      },
    });
    await held.arrived;

    await expect(
      paidSend({
        ticketId: 't_lk2',
        prepare: { id: 'snd_lk2', slotKey: 'n1', price: exactPrice(0.1), nodeId: 'n1' },
        lockKeys: ['node:n1'],
        tickets: h.tickets,
        getBudget: h.getBudget,
        save: h.save,
        onBookSpend: h.onBookSpend,
        send: async () => ({ value: 'dup', costUsd: 0.1 }),
      }),
    ).rejects.toThrow(PaidSendBlockedError);

    held.resolve();
    await first;
    expect(fake.acceptedCount('lock shot')).toBe(1);
    expect(heldSendLocks()).toEqual([]);
  });

  it('remoteJob recibido antes de desconexion mantiene estado sent y reserva para sondeo/recuperacion', async () => {
    const h = createMemoryHarness({ budgetOn: true, budgetUsd: 0.15, spentUsd: 0 });
    h.tickets.put(createTicket({ id: 't_rem', sessionId: 's1', kind: 'generation', price: exactPrice(0.1) }));

    await expect(
      paidSend({
        ticketId: 't_rem',
        prepare: { id: 'snd_rem', slotKey: 'atlas:0', price: exactPrice(0.1) },
        tickets: h.tickets,
        getBudget: h.getBudget,
        save: h.save,
        onBookSpend: h.onBookSpend,
        send: async ({ onRemoteJob }) => {
          onRemoteJob({ provider: 'atlas', id: 'atlas_j99', meta: {} });
          throw new TypeError('Failed to fetch during poll');
        },
      }),
    ).rejects.toThrow(TypeError);

    const state = sendStateOf(h.tickets.list(), { sendId: 'snd_rem' });
    expect(state.status).toBe('sent');
    expect(state.matches[0].remoteJob?.id).toBe('atlas_j99');
    expect(ticketReservedUsd(h.tickets.get('t_rem')!)).toBe(0.1);
  });
});

describe('D+ store & spend: tickets persistidos y addSpend idempotente por sendId', () => {
  it('tickets sobreviven partialize + merge (recarga) y removeTicket los limpia', () => {
    const sid = useStore.getState().activeSessionId;
    useStore.setState({ tickets: {}, spentUsd: 0, spendLog: [] });
    const t = prepareSend(
      createTicket({ id: 'tkt_pers', sessionId: sid, kind: 'commands', scope: { nodeIds: ['n1'] }, price: exactPrice(0.1) }),
      { id: 'snd_pers', slotKey: 'n1', price: exactPrice(0.1), nodeId: 'n1' },
    );
    upsertTicket(t);
    expect(useStore.getState().tickets.tkt_pers).toEqual(t);

    const saved = snapshotStore();
    useStore.setState({ tickets: {} });
    simulateReload(null, { sessionId: sid, state: saved });
    expect(useStore.getState().tickets.tkt_pers).toEqual(t);

    removeTicket('tkt_pers');
    expect(useStore.getState().tickets.tkt_pers).toBeUndefined();
  });

  it('addSpend deduplica por sendId tanto cobros conocidos como desconocidos sin doblar spentUsd', () => {
    const sid = useStore.getState().activeSessionId;
    useStore.setState({ spentUsd: 0, spendLog: [] });
    const base = { category: 'image' as const, provider: 'nanogpt', model: 'nanogpt::seed', sessionId: sid, estimated: false };

    addSpend(0.1, { ...base, sendId: 'snd_dedup_1' });
    addSpend(0.1, { ...base, sendId: 'snd_dedup_1' });
    expect(useStore.getState().spentUsd).toBe(0.1);
    expect(useStore.getState().spendLog.filter((e) => e.sendId === 'snd_dedup_1')).toHaveLength(1);

    addSpend(null, { ...base, estimated: true, sendId: 'snd_dedup_unk' });
    addSpend(null, { ...base, estimated: true, sendId: 'snd_dedup_unk' });
    expect(useStore.getState().spendLog.filter((e) => e.sendId === 'snd_dedup_unk')).toHaveLength(1);

    // Legacy calls without sendId still sum normally:
    addSpend(0.05, base);
    addSpend(0.05, base);
    expect(useStore.getState().spentUsd).toBe(0.2);
  });

  it('remainingBudget descuenta reservas in_flight/uncertain de tickets y budgetVerdict exige confirmacion ante lowerBound', () => {
    const sid = useStore.getState().activeSessionId;
    const st = useStore.getState();
    useStore.setState({
      tickets: {},
      spentUsd: 0,
      spendLog: [],
      settings: { ...st.settings, budgetOn: true, budgetUsd: 0.15, budgetNoAsk: false, budgetAccepted: null },
      sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], noAskOverLimit: false } },
    });

    let t = createTicket({ id: 'tkt_res', sessionId: sid, kind: 'generation', price: exactPrice(0.1) });
    t = prepareSend(t, { id: 'snd_res', slotKey: 'n1', price: exactPrice(0.1) });
    t = markSendInFlight(t, 'snd_res');
    upsertTicket(t);
    expect(remainingBudget()).toBe(0.05);
    expect(budgetVerdict({ usd: 0.1, approximate: false }, { sessionId: sid }).over).toBe(true);

    // Reservation stays held while uncertain and releases on settle:
    upsertTicket(markSendUncertain(t, 'snd_res', 'cut after accept'));
    expect(remainingBudget()).toBe(0.05);
    upsertTicket(settleSend(useStore.getState().tickets.tkt_res, 'snd_res', { costUsd: 0.1 }).ticket);
    expect(remainingBudget()).toBe(0.15);

    // lowerBound without ceiling asks with truthful copy, and passes when explicitly approved with once pass:
    const lb = { usd: 0.08, approximate: true, lowerBound: true };
    const v = budgetVerdict(lb, { sessionId: sid });
    expect(v.over).toBe(true);
    expect(v.unknownPrice).toBe(true);
    expect(v.text).toMatch(/Only a minimum price/i);
    const approved = withOncePass(sid, (pass) => budgetVerdict(lb, { sessionId: sid, pass }), lb.usd, true);
    expect(approved.over).toBe(false);

    removeTicket('tkt_res');
  });

  it('storeBridge: storeTickets, budgetSnapshotFor, canWriteTicket, saveTicketMark y slotPriceForGeneration', async () => {
    const sid = useStore.getState().activeSessionId;
    const st = useStore.getState();
    useStore.setState({
      tickets: {},
      spentUsd: 0.05,
      spendLog: [],
      settings: { ...st.settings, budgetOn: true, budgetUsd: 0.25, budgetNoAsk: false, budgetAccepted: null },
      sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], noAskOverLimit: false } },
    });

    const t = createTicket({ id: 'tkt_bridge', sessionId: sid, kind: 'llm', price: exactPrice(0.05) });
    storeTickets.put(t);
    expect(storeTickets.get('tkt_bridge')?.id).toBe('tkt_bridge');
    expect(storeTickets.list().some((x) => x.id === 'tkt_bridge')).toBe(true);
    expect(budgetSnapshotFor(sid)).toMatchObject({ budgetOn: true, budgetUsd: 0.25, spentUsd: 0.05, sessionNoAsk: false });
    expect(typeof canWriteTicket()).toBe('boolean');
    await expect(saveTicketMark()).rejects.toThrow();

    expect(slotPriceForGeneration({ provider: 'local', modelRef: 'local::sketch', estimate: { usd: 0.5, approximate: false }, assetIds: [], settings: { count: 1, advanced: {} } })).toEqual(FREE_PRICE);
    expect(slotPriceForGeneration({ provider: 'atlas', modelRef: 'atlas::img', estimate: { usd: 0, approximate: true }, assetIds: [], settings: { count: 1, advanced: {} } }, 1, 0.1)).toEqual(exactPrice(0.1));
    expect(slotPriceForGeneration({ provider: 'nanogpt', modelRef: 'nanogpt::img', estimate: { usd: null, approximate: true }, assetIds: [], settings: { count: 1, advanced: {} } })).toEqual(UNKNOWN_PRICE);

    // Free path still books provider-reported costUsd > 0, and beforeTransport error rolls back in_flight cleanly:
    const h = createMemoryHarness({ budgetOn: true, budgetUsd: 1.0, spentUsd: 0 });
    h.tickets.put(createTicket({ id: 't_free_real', sessionId: sid, kind: 'generation', price: FREE_PRICE }));
    const freeOut = await paidSend({
      ticketId: 't_free_real',
      prepare: { id: 'snd_fr', slotKey: 'fr', price: FREE_PRICE },
      tickets: h.tickets,
      getBudget: h.getBudget,
      save: h.save,
      onBookSpend: h.onBookSpend,
      send: async () => ({ value: 'ok', costUsd: 0.1, estimated: false }),
    });
    expect(freeOut.free).toBe(true);
    expect(h.bookings).toEqual([{ ticketId: 't_free_real', sendId: 'snd_fr', usd: 0.1, estimated: false }]);

    h.tickets.put(createTicket({ id: 't_bt', sessionId: sid, kind: 'generation', price: exactPrice(0.1) }));
    await expect(
      paidSend({
        ticketId: 't_bt',
        prepare: { id: 'snd_bt', slotKey: 'bt', price: exactPrice(0.1) },
        tickets: h.tickets,
        getBudget: h.getBudget,
        save: h.save,
        onBookSpend: h.onBookSpend,
        beforeTransport: () => { throw new Error('price drift'); },
        send: async () => ({ value: 'never', costUsd: 0.1 }),
      }),
    ).rejects.toThrow('price drift');
    expect(sendStateOf(h.tickets.list(), { sendId: 'snd_bt' }).status).toBe('pending');
    expect(ticketReservedUsd(h.tickets.get('t_bt')!)).toBe(0);

    removeTicket('tkt_bridge');
  });
});

