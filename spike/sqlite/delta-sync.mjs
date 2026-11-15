// SPIKE round 4, part 2: resilient delta client for store-b / store-ba.
// Handles:
// 1. Network failure / killed server / aborted request mid-commit:
//    `acked` and `baseAt` only advance on a confirmed 204. If a request fails before or after the server commits,
//    the pending delta remains staged against the last confirmed state and is resent idempotently.
// 2. Stale `baseAt` -> 409 conflict:
//    The client reads the new server state, computes its own pending changes relative to its last `acked` baseline
//    (created/updated/deleted records by id in generations/assets/library, changed scalar globals, newly appended
//    spend entries, and changed/added/removed sessions), rebases them onto the server state without losing or
//    duplicating records, updates `acked`/`baseAt` to the server state, and retries the commit.
import { splitText } from '../../server/store-v2.js';

const COLLS = ['generations', 'assets', 'library'];
const SMALL_SKIP = new Set([...COLLS, 'spendLog']);
const json = (v) => JSON.stringify(v);

function extractSmallObj(g) {
  return Object.fromEntries(Object.entries(g).filter(([k]) => !SMALL_SKIP.has(k)));
}

function collToMap(coll, g) {
  const m = new Map();
  if (coll === 'library') {
    for (let i = 0; i < (g.library ?? []).length; i++) {
      const r = g.library[i];
      const id = String(r.id ?? `#${i}`);
      m.set(id, { ref: r, text: json(r) });
    }
  } else {
    const obj = g[coll] ?? {};
    for (const id of Object.keys(obj)) {
      m.set(id, { ref: obj[id], text: json(obj[id]) });
    }
  }
  return m;
}

function snapshotFromGlobals(g, prevRecords = null) {
  const records = {};
  for (const coll of COLLS) {
    if (!prevRecords) {
      records[coll] = collToMap(coll, g);
    } else {
      const cur = coll === 'library'
        ? Object.fromEntries((g.library ?? []).map((r, i) => [String(r.id ?? `#${i}`), r]))
        : (g[coll] ?? {});
      const prev = prevRecords[coll];
      const next = new Map();
      for (const id of Object.keys(cur)) {
        const p = prev.get(id);
        if (p && p.ref === cur[id]) next.set(id, p);
        else next.set(id, { ref: cur[id], text: json(cur[id]) });
      }
      records[coll] = next;
    }
  }
  const smallObj = extractSmallObj(g);
  const smallProps = Object.fromEntries(Object.entries(smallObj).map(([k, v]) => [k, json(v)]));
  const smallText = json(smallObj);
  const spendTexts = (g.spendLog ?? []).map((e) => json(e));
  return { records, smallText, smallProps, spendTexts, spendSet: new Set(spendTexts) };
}

export function createResilientDeltaClient({ initialServerText = null, spendCap = Infinity } = {}) {
  let baseAt = 0;
  let version = 1;
  let acked = null; // { records, smallText, smallProps, spendTexts, spendSet, order, sessions: Map<id, text> }
  let inFlight = null;

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

    const delta = {
      ...(first ? { full: true } : {}),
      ...(smallChanged ? { small: snap.smallText } : {}),
      up,
      del,
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
   * Rebases the client's unacknowledged local changes (from `acked` to `local`) onto the new `serverText`
   * read from the server after a 409 conflict. Updates `acked` and `baseAt` to match the server state, and
   * updates `local` to the merged state so the next `prepareCommit()` produces only the rebased delta.
   */
  function rebaseOnServer(serverText) {
    if (!serverText) throw new Error('cannot rebase on empty server state');
    const prevAcked = acked;
    const curSnap = snapshotFromGlobals(local.globals, prevAcked?.records ?? null);

    // 1. Compute local pending changes relative to prevAcked before updating acked to serverText.
    const localUp = { generations: new Map(), assets: new Map(), library: new Map() };
    const localDel = { generations: new Set(), assets: new Set(), library: new Set() };

    for (const coll of COLLS) {
      const curMap = curSnap.records[coll];
      const oldMap = prevAcked?.records[coll];
      for (const [id, entry] of curMap.entries()) {
        const old = oldMap?.get(id);
        if (!old || old.text !== entry.text) {
          localUp[coll].set(id, JSON.parse(entry.text));
        }
      }
      if (oldMap) {
        for (const id of oldMap.keys()) {
          if (!curMap.has(id)) localDel[coll].add(id);
        }
      }
    }

    const changedSmallKeys = {};
    for (const [k, text] of Object.entries(curSnap.smallProps)) {
      if (!prevAcked || prevAcked.smallProps[k] !== text) {
        changedSmallKeys[k] = JSON.parse(text);
      }
    }

    const pendingSpendTexts = prevAcked
      ? curSnap.spendTexts.filter((t) => !prevAcked.spendSet.has(t))
      : curSnap.spendTexts;

    const localSessUp = new Map();
    const localSessDel = new Set();
    const curSessSet = new Set(local.order);
    for (const id of local.order) {
      const s = local.sessions[id];
      const text = typeof s === 'string' ? s : json(s);
      if (!prevAcked || prevAcked.sessions.get(id) !== text) {
        localSessUp.set(id, JSON.parse(text));
      }
    }
    if (prevAcked) {
      for (const id of prevAcked.sessions.keys()) {
        if (!curSessSet.has(id)) localSessDel.add(id);
      }
    }

    // 2. Parse server state and set `acked` + `baseAt` to the server state.
    const srv = setAckedFromServerText(serverText);
    const srvG = srv.globals;

    // 3. Merge collections onto server state: preserve server order for existing records, apply localDel and localUp.
    const mergedGenerations = {};
    for (const [id, val] of Object.entries(srvG.generations ?? {})) {
      if (localDel.generations.has(id)) continue;
      mergedGenerations[id] = localUp.generations.has(id) ? localUp.generations.get(id) : val;
    }
    for (const [id, val] of localUp.generations.entries()) {
      if (!(id in mergedGenerations)) mergedGenerations[id] = val;
    }

    const mergedAssets = {};
    for (const [id, val] of Object.entries(srvG.assets ?? {})) {
      if (localDel.assets.has(id)) continue;
      mergedAssets[id] = localUp.assets.has(id) ? localUp.assets.get(id) : val;
    }
    for (const [id, val] of localUp.assets.entries()) {
      if (!(id in mergedAssets)) mergedAssets[id] = val;
    }

    const mergedLibrary = [];
    const seenLib = new Set();
    for (let i = 0; i < (srvG.library ?? []).length; i++) {
      const r = srvG.library[i];
      const id = String(r.id ?? `#${i}`);
      if (localDel.library.has(id)) continue;
      seenLib.add(id);
      mergedLibrary.push(localUp.library.has(id) ? localUp.library.get(id) : r);
    }
    for (const [id, val] of localUp.library.entries()) {
      if (!seenLib.has(id)) mergedLibrary.push(val);
    }

    // 4. Merge spendLog: deduplicate against server's spendSet so post-commit aborts never duplicate spend rows.
    const mergedSpend = [...(srvG.spendLog ?? [])];
    for (const t of pendingSpendTexts) {
      if (!acked.spendSet.has(t)) {
        mergedSpend.push(JSON.parse(t));
      }
    }
    const cappedSpend = Number.isFinite(spendCap) && mergedSpend.length > spendCap
      ? mergedSpend.slice(-spendCap)
      : mergedSpend;

    // 5. Merge scalar globals.
    const mergedSmall = { ...extractSmallObj(srvG), ...changedSmallKeys };
    if ('spentUsd' in mergedSmall) {
      mergedSmall.spentUsd = cappedSpend.reduce((a, e) => a + (e.usd ?? 0), 0);
    }

    // 6. Merge sessions and order.
    const mergedOrder = srv.order.filter((id) => !localSessDel.has(id));
    const orderSet = new Set(mergedOrder);
    for (const id of local.order) {
      if (!localSessDel.has(id) && !orderSet.has(id)) {
        mergedOrder.push(id);
        orderSet.add(id);
      }
    }
    const mergedSessions = {};
    for (const id of mergedOrder) {
      if (localSessUp.has(id)) mergedSessions[id] = localSessUp.get(id);
      else if (srv.sessions[id] != null) mergedSessions[id] = JSON.parse(srv.sessions[id]);
      else mergedSessions[id] = local.sessions[id];
    }

    local = {
      globals: {
        ...mergedSmall,
        spendLog: cappedSpend,
        generations: mergedGenerations,
        assets: mergedAssets,
        library: mergedLibrary,
      },
      order: mergedOrder,
      sessions: mergedSessions,
    };
    inFlight = null;
    return local;
  }

  /**
   * Synchronizes `local` to the server using `sendCommit(body)` and `readServer()`, automatically retrying on
   * network aborts and rebasing on 409 conflict until confirmed (204).
   */
  async function sync({ sendCommit, readServer, nextSavedAt, maxAttempts = 20 }) {
    let attempts = 0;
    let rebases = 0;
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
        return { status: 204, savedAt: lastAt, attempts, rebases, aborts };
      }
      if (res.status === 409 && res.reason === 'conflict') {
        rebases++;
        const serverText = await readServer();
        rebaseOnServer(serverText);
        lastAt = Math.max(lastAt, baseAt + 1000);
        continue;
      }
      throw new Error(`unexpected commit response: ${JSON.stringify(res)}`);
    }
    throw new Error(`sync exceeded maxAttempts (${maxAttempts})`);
  }

  return {
    get baseAt() { return baseAt; },
    get hasPending() { return inFlight !== null; },
    setLocalState,
    getLocalState,
    prepareCommit,
    ack,
    rebaseOnServer,
    sync,
  };
}
