import { lstat, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const MODEL = 'deepseek/deepseek-v4.1-flash';
export const LIMIT_MICRO_USD = 50_000;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inputPrice = 0.13;
const outputPrice = 0.52;
const sha = (text) => createHash('sha256').update(text).digest('hex');

async function safePilot(root) {
  for (const p of ['.sandbox', '.sandbox/pilot']) {
    const path = resolve(root, p);
    const info = await lstat(path).catch((e) => { if (e.code !== 'ENOENT') throw e; });
    if (info && (info.isSymbolicLink() || !info.isDirectory())) throw new Error('Unsafe sandbox');
  }
  await mkdir(resolve(root, '.sandbox/pilot'), { recursive: true });
  return resolve(root, '.sandbox/pilot');
}
async function safeFile(directory, name) {
  const path = resolve(directory, name);
  const info = await lstat(path).catch((e) => { if (e.code !== 'ENOENT') throw e; });
  if (info && (info.isSymbolicLink() || !info.isFile())) throw new Error('Unsafe pilot file');
  return path;
}

export async function savePilotFixtures(root, fixtures) {
  const dir = await safePilot(root);
  await writeFile(await safeFile(dir, 'requests.json'), JSON.stringify(fixtures, null, 2), { mode: 0o600 });
}

export function estimatePilot(fixtures) {
  if (fixtures.length !== 6 || new Set(fixtures.map((f) => f.id)).size !== 6) throw new Error('Exactly six distinct requests required');
  const rows = fixtures.map((f) => {
    if (f.body.model !== MODEL || f.body.max_tokens !== 500 || JSON.stringify(f.body).includes('cache_control')) throw new Error('Unapproved model/configuration');
    const serialized = JSON.stringify(f.body);
    const characters = [...serialized].length;
    const inputTokensEstimate = Math.ceil(characters / 3 * 1.5);
    const maximumMicroUsd = Math.ceil(inputTokensEstimate * inputPrice + 500 * outputPrice);
    return { id: f.id, case: f.case, arm: f.arm, serializedCharacters: characters, inputTokensEstimate,
      maxOutputTokens: 500, maximumMicroUsd, maximumUsd: maximumMicroUsd / 1e6, requestSha256: sha(serialized) };
  });
  const maximumMicroUsd = rows.reduce((sum, r) => sum + r.maximumMicroUsd, 0);
  if (maximumMicroUsd > LIMIT_MICRO_USD) throw new Error('Pilot exceeds USD 0.05 before any send');
  return { model: MODEL, method: 'ceil(unicodeCharacters(JSON.stringify(body)) / 3 * 1.5)', inputUsdPerMillion: inputPrice,
    outputUsdPerMillion: outputPrice, calls: 6, gptLunaEnabled: false, hardLimitUsd: 0.05,
    maximumUsd: maximumMicroUsd / 1e6, rows, approvalHash: sha(JSON.stringify(rows)) };
}

export function reserveCall(ledger, row, limitMicroUsd = LIMIT_MICRO_USD) {
  if (!Number.isSafeInteger(limitMicroUsd) || limitMicroUsd <= 0 || limitMicroUsd > 1_000_000) throw new Error('Invalid budget limit');
  if (!Number.isSafeInteger(ledger.chargedMicroUsd) || ledger.chargedMicroUsd < 0 ||
      !Number.isSafeInteger(row.maximumMicroUsd) || row.maximumMicroUsd < 0) throw new Error('Invalid budget');
  if (ledger.stopped || ledger.calls.some((c) => c.id === row.id)) throw new Error('Stopped pilot or already attempted request; no retry');
  if (ledger.chargedMicroUsd + row.maximumMicroUsd > limitMicroUsd) throw new Error('Insufficient remaining budget');
  ledger.chargedMicroUsd += row.maximumMicroUsd;
  ledger.calls.push({ id: row.id, reservedMicroUsd: row.maximumMicroUsd, chargedMicroUsd: row.maximumMicroUsd,
    costSource: 'reservation', status: 'reserved', firstTextMs: 'desconocido', totalMs: 'desconocido',
    inputTokens: 'desconocido', outputTokens: 'desconocido', cachedTokens: 'desconocido', reportedUsd: 'desconocido' });
}

export function settleCall(ledger, row, reportedUsd, limitMicroUsd = LIMIT_MICRO_USD) {
  const call = ledger.calls.find((c) => c.id === row.id);
  if (!call || call.status !== 'reserved') throw new Error('No outstanding reservation');
  const known = typeof reportedUsd === 'number' && Number.isFinite(reportedUsd) && reportedUsd >= 0;
  const charge = known ? Math.ceil(reportedUsd * 1e6) : row.maximumMicroUsd;
  ledger.chargedMicroUsd += charge - call.reservedMicroUsd;
  Object.assign(call, { status: 'finished', chargedMicroUsd: charge, costSource: known ? 'provider' : 'highest-estimate' });
  if (ledger.chargedMicroUsd > limitMicroUsd || charge > row.maximumMicroUsd) ledger.stopped = true;
}

export async function readPilot(root) {
  const dir = await safePilot(root);
  const fixtures = JSON.parse(await readFile(await safeFile(dir, 'requests.json'), 'utf8'));
  return { fixtures, report: estimatePilot(fixtures), dir };
}

export function environmentKey(env = process.env) {
  const key = env.NANOGPT_API_KEY;
  if (typeof key !== 'string' || !key.trim()) throw new Error('NANOGPT_API_KEY is required; no request sent');
  return key.trim();
}

const FAILURE_KINDS = ['http_error', 'missing_stream', 'transport_error', 'timeout', 'invalid_stream', 'provider_error', 'stream_error', 'local_error'];
class PilotRequestError extends Error {
  constructor(kind, httpStatus) {
    super('Request failed; no retry');
    this.failureKind = kind;
    this.httpStatus = httpStatus;
  }
}
export function requestFailure(error) {
  return { failureKind: error instanceof PilotRequestError ? error.failureKind : 'local_error',
    httpStatus: error instanceof PilotRequestError && Number.isInteger(error.httpStatus) &&
      error.httpStatus >= 100 && error.httpStatus <= 599 ? error.httpStatus : 'desconocido' };
}
export function failureSummary(error) {
  const kind = FAILURE_KINDS.includes(error?.failureKind) ? error.failureKind : 'local_error';
  const status = Number.isInteger(error?.httpStatus) && error.httpStatus >= 100 && error.httpStatus <= 599 ? error.httpStatus : 'desconocido';
  return `Failure: ${kind}; HTTP: ${status}.`;
}

// One POST per sample. Never invokes the runtime's reasoning/credit retries or tools.
export async function sampleRequest(body, key, fetcher = fetch) {
  const start = performance.now();
  let firstTextMs;
  let usage;
  let finishReason;
  let response;
  try {
    response = await fetcher('https://nano-gpt.com/api/v1/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(120_000), redirect: 'error', credentials: 'omit',
    });
  } catch (error) {
    throw new PilotRequestError(['TimeoutError', 'AbortError'].includes(error?.name) ? 'timeout' : 'transport_error');
  }
  if (!response.ok) throw new PilotRequestError('http_error', response.status);
  if (!response.body) throw new PilotRequestError('missing_stream', response.status);
  let buffer = '';
  const decoder = new TextDecoder();
  const consume = (line) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let chunk;
    try { chunk = JSON.parse(data); } catch { throw new PilotRequestError('invalid_stream', response.status); }
    if (chunk.error) throw new PilotRequestError('provider_error', response.status);
    if (chunk.usage) usage = chunk.usage;
    const finish = chunk.choices?.[0]?.finish_reason;
    if (['stop', 'length', 'tool_calls', 'function_call', 'content_filter', 'error'].includes(finish)) finishReason = finish;
    const text = chunk.choices?.[0]?.delta?.content;
    if (typeof text === 'string' && text.length && firstTextMs == null) firstTextMs = performance.now() - start;
  };
  try {
    for await (const bytes of response.body) {
      buffer += decoder.decode(bytes, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, end).trimEnd()); buffer = buffer.slice(end + 1); }
    }
  } catch (error) {
    if (error instanceof PilotRequestError) throw error;
    throw new PilotRequestError(['TimeoutError', 'AbortError'].includes(error?.name) ? 'timeout' : 'stream_error', response.status);
  }
  buffer += decoder.decode();
  if (buffer.trim()) consume(buffer.trimEnd());
  const numeric = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 'desconocido';
  return { firstTextMs: firstTextMs ?? 'desconocido', totalMs: performance.now() - start,
    inputTokens: numeric(usage?.prompt_tokens), outputTokens: numeric(usage?.completion_tokens),
    cachedTokens: numeric(usage?.prompt_tokens_details?.cached_tokens), reportedUsd: numeric(usage?.cost),
    reasoningTokens: numeric(usage?.completion_tokens_details?.reasoning_tokens), finishReason: finishReason ?? 'desconocido' };
}

export async function runPilot(fixtures, ledger, save, env = process.env, fetcher = fetch) {
  const key = environmentKey(env); // The sole source of the credential, including in tests.
  const report = estimatePilot(fixtures);
  if (env.PRICE_PILOT_APPROVAL !== report.approvalHash) throw new Error('Explicit approval of this exact manifest required');
  if (ledger.approvalHash !== report.approvalHash) throw new Error('Ledger belongs to another manifest');
  const order = [0, 1, 3, 2, 4, 5]; // control/notice, notice/control, control/notice
  for (const index of order) {
    const row = report.rows[index];
    reserveCall(ledger, row);
    await save(ledger); // Reservation is persisted BEFORE the only POST.
    try {
      const result = await sampleRequest(fixtures[index].body, key, fetcher);
      settleCall(ledger, row, result.reportedUsd);
      Object.assign(ledger.calls.at(-1), result);
      await save(ledger);
      if (ledger.stopped) throw new Error('Cost exceeded reservation; stopped');
    } catch (error) {
      ledger.stopped = true;
      Object.assign(ledger.calls.at(-1), requestFailure(error));
      if (ledger.calls.at(-1)?.status === 'reserved') Object.assign(ledger.calls.at(-1), { status: 'uncertain', costSource: 'highest-estimate' });
      await save(ledger);
      throw Object.assign(new Error('Pilot stopped; no automatic retry'), requestFailure(error));
    }
  }
  return ledger;
}

async function main() {
  const execute = process.argv.includes('--execute');
  if (execute) environmentKey(); // Missing key aborts before reading/writing any pilot files.
  const { fixtures, report, dir } = await readPilot(ROOT);
  await writeFile(await safeFile(dir, 'estimate.json'), JSON.stringify(report, null, 2));
  if (!execute) { console.log(JSON.stringify(report, null, 2)); return; }
  if (process.env.PRICE_PILOT_APPROVAL !== report.approvalHash) throw new Error('Explicit approval of this exact manifest required');
  const lock = await open(await safeFile(dir, 'execution.lock'), 'wx');
  await lock.close(); // Retained after completion/interruption: a second process cannot send the pilot again.
  const ledgerPath = await safeFile(dir, 'ledger.json');
  const raw = await readFile(ledgerPath, 'utf8').catch((e) => { if (e.code !== 'ENOENT') throw e; });
  const ledger = raw ? JSON.parse(raw) : { approvalHash: report.approvalHash, chargedMicroUsd: 0, stopped: false, calls: [] };
  if (ledger.approvalHash !== report.approvalHash) throw new Error('Ledger belongs to another manifest');
  const resultsPath = await safeFile(dir, 'results.json');
  const save = async (state) => {
    await writeFile(ledgerPath, JSON.stringify(state, null, 2), { mode: 0o600 });
    await writeFile(resultsPath, JSON.stringify({ model: MODEL, limitUsd: 0.05, approvalHash: report.approvalHash,
      status: state.stopped ? 'stopped' : state.calls.length === 6 && state.calls.every((c) => c.status === 'finished') ? 'finished' : 'running',
      accountedUsd: state.chargedMicroUsd / 1e6, calls: state.calls }, null, 2), { mode: 0o600 });
  };
  await runPilot(fixtures, ledger, save);
  console.log('Pilot finished. Results: .sandbox/pilot/results.json');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    // Print only our fixed messages; never echo provider bodies, fetch errors or credential values.
    console.error(e.message === 'NANOGPT_API_KEY is required; no request sent' ? e.message :
      `Pilot aborted. No automatic retry. ${failureSummary(e)} Review .sandbox/pilot/results.json if created.`);
    process.exitCode = 1;
  });
}
