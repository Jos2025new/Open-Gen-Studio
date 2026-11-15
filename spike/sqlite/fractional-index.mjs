// Fractional indexing (base-62 lexicographical position keys) and minimal LIS order diffing.
// Keys sort in standard ASCII / SQLite BINARY order: '0'..'9' < 'A'..'Z' < 'a'..'z'.

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;
const INTEGER_ZERO = 'a0';
const SMALLEST_INTEGER = 'A00000000000000000000000000';

function getIntegerLength(head) {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 97 + 2;
  if (head >= 'A' && head <= 'Z') return 90 - head.charCodeAt(0) + 2;
  throw new Error(`invalid order key head: ${head}`);
}

function getIntegerPart(key) {
  const len = getIntegerLength(key[0]);
  if (len > key.length) throw new Error(`invalid order key: ${key}`);
  return key.slice(0, len);
}

function validateOrderKey(key) {
  if (key === SMALLEST_INTEGER) throw new Error(`invalid order key: ${key}`);
  const intPart = getIntegerPart(key);
  const frac = key.slice(intPart.length);
  if (frac.slice(-1) === '0') throw new Error(`invalid order key trailing zero: ${key}`);
}

function incrementInteger(x) {
  const head = x[0];
  const digs = x.slice(1).split('');
  let carry = true;
  for (let i = digs.length - 1; i >= 0 && carry; i--) {
    const d = DIGITS.indexOf(digs[i]) + 1;
    if (d === BASE) {
      digs[i] = '0';
    } else {
      digs[i] = DIGITS[d];
      carry = false;
    }
  }
  if (!carry) return head + digs.join('');
  if (head === 'Z') return INTEGER_ZERO;
  if (head === 'z') return null;
  const h = String.fromCharCode(head.charCodeAt(0) + 1);
  if (h > 'a') digs.push('0');
  else digs.pop();
  return h + digs.join('');
}

function decrementInteger(x) {
  const head = x[0];
  const digs = x.slice(1).split('');
  let borrow = true;
  for (let i = digs.length - 1; i >= 0 && borrow; i--) {
    const d = DIGITS.indexOf(digs[i]) - 1;
    if (d === -1) {
      digs[i] = 'z';
    } else {
      digs[i] = DIGITS[d];
      borrow = false;
    }
  }
  if (!borrow) return head + digs.join('');
  if (head === 'a') return 'Zz';
  if (head === 'A') return null;
  const h = String.fromCharCode(head.charCodeAt(0) - 1);
  if (h < 'Z') digs.push('z');
  else digs.pop();
  return h + digs.join('');
}

function midpoint(a, b) {
  if (b !== null) {
    let n = 0;
    while ((a[n] || '0') === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? DIGITS.indexOf(a[0]) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b[0]) : BASE;
  if (digitB - digitA > 1) {
    return DIGITS[Math.round(0.5 * (digitA + digitB))];
  }
  if (b !== null && b.length > 1) {
    return b.slice(0, 1);
  }
  return DIGITS[digitA] + midpoint(a.slice(1), null);
}

/** Generates a key strictly between `a` and `b` (`null` means unbounded). */
export function generateKeyBetween(a, b) {
  if (a != null) validateOrderKey(a);
  if (b != null) validateOrderKey(b);
  if (a != null && b != null && a >= b) throw new Error(`${a} >= ${b}`);
  if (a == null && b == null) return INTEGER_ZERO;
  if (a == null) {
    const ib = getIntegerPart(b);
    const fb = b.slice(ib.length);
    if (ib === SMALLEST_INTEGER) return ib + midpoint('', fb);
    if (ib < b) return ib;
    const dec = decrementInteger(ib);
    if (dec === null) throw new Error('order key underflow');
    return dec;
  }
  if (b == null) {
    const ia = getIntegerPart(a);
    const fa = a.slice(ia.length);
    const inc = incrementInteger(ia);
    return inc === null ? ia + midpoint(fa, null) : inc;
  }
  const ia = getIntegerPart(a);
  const fa = a.slice(ia.length);
  const ib = getIntegerPart(b);
  const fb = b.slice(ib.length);
  if (ia === ib) return ia + midpoint(fa, fb);
  const inc = incrementInteger(ia);
  if (inc === null) throw new Error('order key overflow');
  if (inc < b) return inc;
  return ia + midpoint(fa, null);
}

/** Generates `n` evenly spaced keys strictly between `a` and `b`. */
export function generateNKeysBetween(a, b, n) {
  if (n <= 0) return [];
  if (n === 1) return [generateKeyBetween(a, b)];
  if (b == null) {
    const out = new Array(n);
    let c = generateKeyBetween(a, null);
    out[0] = c;
    for (let i = 1; i < n; i++) {
      c = generateKeyBetween(c, null);
      out[i] = c;
    }
    return out;
  }
  if (a == null) {
    const out = new Array(n);
    let c = generateKeyBetween(null, b);
    out[n - 1] = c;
    for (let i = n - 2; i >= 0; i--) {
      c = generateKeyBetween(null, c);
      out[i] = c;
    }
    return out;
  }
  const mid = n >> 1;
  const c = generateKeyBetween(a, b);
  return [
    ...generateNKeysBetween(a, c, mid),
    c,
    ...generateNKeysBetween(c, b, n - mid - 1),
  ];
}

function longestIncreasingSubsequence(nums) {
  const n = nums.length;
  if (n === 0) return [];
  const tails = [];
  const tailIdx = [];
  const parent = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const x = nums[i];
    let lo = 0, hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = x;
    tailIdx[lo] = i;
    if (lo > 0) parent[i] = tailIdx[lo - 1];
  }
  const res = new Array(tails.length);
  let k = tailIdx[tails.length - 1];
  for (let i = tails.length - 1; i >= 0; i--) {
    res[i] = k;
    k = parent[k];
  }
  return res;
}

function sameSequence(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function runMatchesUpOrder(run, upKeysOrder) {
  if (!upKeysOrder || upKeysOrder.length < run.length) return false;
  const set = new Set(run);
  let idx = 0;
  for (let i = 0; i < upKeysOrder.length; i++) {
    const id = upKeysOrder[i];
    if (set.has(id)) {
      if (run[idx] !== id) return false;
      idx++;
    }
  }
  return idx === run.length;
}

/**
 * Computes minimal order placement runs `[{ after, before, ids }]` to transform `prevIds` into `curIds`,
 * leaving the longest increasing subsequence of surviving records at their existing positions.
 * Returns `null` when no order data needs to be sent (order unchanged and any new records already follow `upKeysOrder`).
 */
export function computeOrderDiff(prevIds, curIds, upKeysOrder = []) {
  if (curIds.length === 0) return null;
  if (prevIds.length === 0) {
    return sameSequence(upKeysOrder, curIds) ? null : [{ after: null, before: null, ids: curIds }];
  }
  if (sameSequence(prevIds, curIds)) return null;

  const prevIdx = new Map();
  for (let i = 0; i < prevIds.length; i++) prevIdx.set(prevIds[i], i);

  const keptCur = [];
  const keptIndices = [];
  let sorted = true;
  let last = -1;
  for (let i = 0; i < curIds.length; i++) {
    const id = curIds[i];
    const idx = prevIdx.get(id);
    if (idx !== undefined) {
      keptCur.push(id);
      keptIndices.push(idx);
      if (idx <= last) sorted = false;
      last = idx;
    }
  }

  if (keptCur.length === 0) {
    return sameSequence(upKeysOrder, curIds) ? null : [{ after: null, before: null, ids: curIds }];
  }

  const hasNew = keptCur.length < curIds.length;
  if (sorted && !hasNew) return null;

  let anchorSet;
  if (sorted) {
    anchorSet = new Set(keptCur);
  } else {
    const lisPos = longestIncreasingSubsequence(keptIndices);
    anchorSet = new Set();
    for (let i = 0; i < lisPos.length; i++) anchorSet.add(keptCur[lisPos[i]]);
  }

  const runs = [];
  let lastAnchor = null;
  let run = [];
  for (let i = 0; i < curIds.length; i++) {
    const id = curIds[i];
    if (anchorSet.has(id)) {
      if (run.length > 0) {
        runs.push({ after: lastAnchor, before: id, ids: run });
        run = [];
      }
      lastAnchor = id;
    } else {
      run.push(id);
    }
  }
  if (run.length > 0) {
    const allNew = run.every((id) => !prevIdx.has(id));
    if (!allNew || !runMatchesUpOrder(run, upKeysOrder)) {
      runs.push({ after: lastAnchor, before: null, ids: run });
    }
  }

  return runs.length > 0 ? runs : null;
}
