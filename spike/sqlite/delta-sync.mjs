// SPIKE round 4, part 2: resilient delta client for store-b / store-ba.
// Handles:
// 1. Network failure / killed server / aborted request mid-commit:
//    `acked` and `baseAt` only advance on a confirmed 204. If a request fails before or after the server commits,
//    the pending delta remains staged against the last confirmed state and is resent idempotently.
// 2. Stale `baseAt` -> 409 conflict (same rule as src/lib/idb.ts hold):
//    The client does NOT rebase and does NOT send again. It keeps a copy of the local state and stays held
//    until the user decides. A later sync() sends nothing. Same-id edits are never overwritten with the local copy.
import { splitText } from '../../server/store-v2.js';
import { computeOrderDiff } from './fractional-index.mjs';

const COLLS = ['generations', 'assets', 'library'];
const SMALL_SKIP = new Set([...COLLS, 'spendLog']);
const json = (v) => JSON.stringify(v);

function sameMapOrder(a, b) {
  if (!a || a.size !== b.size) return false;
  const itA = a.keys();
  const itB = b.keys();
  for (let i = 0; i < a.size; i++) {
    if (itA.next().value !== itB.next().value) return false;
  }
  return true;
}

function extractSmallObj(g) {
  return Object.fromEntries(Object.entries(g).filter(([k]) => !SMALL_SKIP.has(k)));
}

function collToMap(coll, g, prevMap = null) {
  const m = new Map();
  if (coll === 'library') {
    const list = g.library ?? [];
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      const id = String(r.id ?? `#${i}`);
      const p = prevMap?.get(id);
      if (p && p.ref === r) m.set(id, p);
      else m.set(id, { ref: r, text: json(r) });
    }
  } else {
    const obj = g[coll] ?? {};
    for (const id of Object.keys(obj)) {
      const p = prevMap?.get(id);
      if (p && p.ref === obj[id]) m.set(id, p);
      else m.set(id, { ref: obj[id], text: json(obj[id]) });
    }
  }
  return m;
}

function snapshotFromGlobals(g, prevRecords = null) {
  const records = {};
  for (const coll of COLLS) {
    records[coll] = collToMap(coll, g, prevRecords?.[coll] ?? null);
  }
  const smallObj = extractSmallObj(g);
  const smallProps = Object.fromEntries(Object.entries(smallObj).map(([k, v]) => [k, json(v)]));
  const smallText = json(smallObj);
  const spendTexts = (g.spendLog ?? []).map((e) => json(e));
  return { records, smallText, smallProps, spendTexts, spendSet: new Set(spendTexts) };
}

export function createResilientDeltaClient({ initialServerText = null } = {}) {
  let baseAt = 0;
  let version = 1;
  let acked = null; // { records, smallText, smallProps, spendTexts, spendSet, order, sessions: Map<id, text> }
  let inFlight = null;
  let held = null; // { copy } once a 409 conflict has stopped sending

  // Working local state held by the client: { globals, order, sessions: { id: obj } }
  let local = {
    globals: {
      settings: { theme: 'dark', tick: 0, keysMigrated: true, language: 'es' },
      spentUsd: 0,
      spendLog: [],
      generations: {},
      assets: {},
      library: [],
      composer: { text: '', refs: [] },
      ui: { panel: 'sessions', zoom: 1 },
      activeSessionId: null,
    },
    order: [],
    sessions: {},
  };

  function setAckedFromServerText(text) {
    const parts = splitText(text);
    const g = JSON.parse(parts.globals);
    const snap = snapshotFromGlobals(g, null);
    baseAt = parts.savedAt;
    version = parts.version;
    acked = {
      ...snap,
      order: [...parts.order],
      sessions: new Map(Object.entries(parts.sessions)),
    };
    return { savedAt: parts.savedAt, version: parts.version, globals: g, order: parts.order, sessions: parts.sessions };
  }

  if (initialServerText) {
    const parsed = setAckedFromServerText(initialServerText);
    local = {
      globals: parsed.globals,
      order: [...parsed.order],
      sessions: Object.fromEntries(Object.entries(parsed.sessions).map(([id, t]) => [id, JSON.parse(t)])),
    };
  }

  /** Replace or mutate the client's working state. */
  function setLocalState(nextState) {
    local = nextState;
  }

  function getLocalState() {
    return local;
  }

  /**
   * Builds a commit body for `local` at timestamp `savedAt` against the last confirmed `acked` state.
   * Does NOT advance `acked` or `baseAt` until `ack()` is called.
   */
  function prepareCommit(savedAt) {
    const g = local.globals;
    const snap = snapshotFromGlobals(g, acked?.records ?? null);
    const up = {}, del = {};
    const first = acked === null;

    for (const coll of COLLS) {
      up[coll] = {};
      del[coll] = [];
      const curMap = snap.records[coll];
      const prevMap = acked?.records[coll];
      for (const [id, entry] of curMap.entries()) {
        const p = prevMap?.get(id);
        if (!p || p.text !== entry.text) up[coll][id] = entry.text;
      }
      if (prevMap) {
        for (const id of prevMap.keys()) {
          if (!curMap.has(id)) del[coll].push(id);
        }
      }
    }

    const smallChanged = first || snap.smallText !== acked.smallText;
    const appendSpend = first
      ? snap.spendTexts
      : snap.spendTexts.filter((t) => !acked.spendSet.has(t));

    let recordOrder = null;
    for (const coll of COLLS) {
      const prevMap = acked?.records[coll];
      const curMap = snap.records[coll];
      if (!sameMapOrder(prevMap, curMap)) {
        const moves = computeOrderDiff(prevMap ? [...prevMap.keys()] : [], [...curMap.keys()], Object.keys(up[coll]));
        if (moves) (recordOrder ??= {})[coll] = moves;
      }
    }
    const delta = {
      ...(first ? { full: true } : {}),
      ...(smallChanged ? { small: snap.smallText } : {}),
      up,
      del,
      ...(recordOrder ? { order: recordOrder } : {}),
      spend: { append: appendSpend, len: snap.spendTexts.length },
    };

    const sessTexts = new Map();
    const changedSessions = {};
    for (const id of local.order) {
      const s = local.sessions[id];
      const text = typeof s === 'string' ? s : json(s);
      sessTexts.set(id, text);
      if (first || acked.sessions.get(id) !== text) {
        changedSessions[id] = text;
      }
    }

    const body = {
      savedAt,
      baseAt,
      version,
      order: [...local.order],
      sessions: changedSessions,
      delta,
    };

    inFlight = {
      savedAt,
      version,
      snap,
      order: [...local.order],
      sessions: sessTexts,
    };
    return body;
  }

  /** Marks the prepared commit as confirmed by the server (204). */
  function ack() {
    if (!inFlight) throw new Error('ack() called with no prepared commit');
    baseAt = inFlight.savedAt;
    version = inFlight.version;
    acked = {
      ...inFlight.snap,
      order: inFlight.order,
      sessions: inFlight.sessions,
    };
    inFlight = null;
  }

  /**
   * Synchronizes `local` to the server using `sendCommit(body)`. Retries when the request fails before a decision.
   * A 409 conflict keeps the local copy and stops: nothing is rebased and nothing is sent again until the user decides.
   */
  async function sync({ sendCommit, nextSavedAt, maxAttempts = 20 }) {
    if (held) return { status: 409, reason: 'conflict', held: true, attempts: 0, rebases: 0, aborts: 0, copy: held.copy };
    let attempts = 0;
    let aborts = 0;
    let lastAt = typeof nextSavedAt === 'function' ? nextSavedAt(baseAt) : nextSavedAt;

    while (attempts < maxAttempts) {
      attempts++;
      if (lastAt <= baseAt) lastAt = baseAt + 1000;
      const body = prepareCommit(lastAt);
      let res;
      try {
        res = await sendCommit(body);
      } catch (err) {
        aborts++;
        // Pending delta remains intact (ack() was not called). Retry on next iteration.
        continue;
      }
      if (res.status === 204) {
        ack();
        return { status: 204, savedAt: lastAt, attempts, rebases: 0, aborts };
      }
      if (res.status === 409 && res.reason === 'conflict') {
        held = { copy: JSON.parse(JSON.stringify(local)) };
        inFlight = null;
        return { status: 409, reason: 'conflict', held: true, attempts, rebases: 0, aborts, copy: held.copy };
      }
      throw new Error(`unexpected commit response: ${JSON.stringify(res)}`);
    }
    throw new Error(`sync exceeded maxAttempts (${maxAttempts})`);
  }

  return {
    get baseAt() { return baseAt; },
    get hasPending() { return inFlight !== null; },
    get held() { return held !== null; },
    setLocalState,
    getLocalState,
    prepareCommit,
    ack,
    sync,
  };
}
