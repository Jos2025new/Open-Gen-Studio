import { lstat, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const MODEL = 'deepseek/deepseek-v4.1-flash';
export const LIMIT_MICRO_USD = 50_000;
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

export function reserveCall(ledger, row) {
  if (ledger.stopped || ledger.calls.some((c) => c.id === row.id)) throw new Error('Stopped pilot or already attempted request; no retry');
  if (ledger.chargedMicroUsd + row.maximumMicroUsd > LIMIT_MICRO_USD) throw new Error('Insufficient remaining USD 0.05 budget');
  ledger.chargedMicroUsd += row.maximumMicroUsd;
  ledger.calls.push({ id: row.id, reservedMicroUsd: row.maximumMicroUsd, status: 'reserved' });
}

export function settleCall(ledger, row, reportedUsd) {
  const call = ledger.calls.find((c) => c.id === row.id);
  if (!call || call.status !== 'reserved') throw new Error('No outstanding reservation');
  const known = typeof reportedUsd === 'number' && Number.isFinite(reportedUsd) && reportedUsd >= 0;
  const charge = known ? Math.ceil(reportedUsd * 1e6) : row.maximumMicroUsd;
  ledger.chargedMicroUsd += charge - call.reservedMicroUsd;
  Object.assign(call, { status: 'finished', chargedMicroUsd: charge, costSource: known ? 'provider' : 'highest-estimate' });
  if (ledger.chargedMicroUsd > LIMIT_MICRO_USD || charge > row.maximumMicroUsd) ledger.stopped = true;
}

export async function readPilot(root) {
  const dir = await safePilot(root);
  const fixtures = JSON.parse(await readFile(await safeFile(dir, 'requests.json'), 'utf8'));
  return { fixtures, report: estimatePilot(fixtures), dir };
}

// One POST per sample. Never invokes the runtime's reasoning/credit retries or tools.
export async function sampleRequest(body, key, fetcher = fetch) {
  const start = performance.now();
  let firstTextMs;
  let usage;
  const response = await fetcher('https://nano-gpt.com/api/v1/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok || !response.body) throw new Error('Request failed; no retry');
  let buffer = '';
  const decoder = new TextDecoder();
  const consume = (line) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    const chunk = JSON.parse(data);
    if (chunk.error) throw new Error('Provider error; no retry');
    if (chunk.usage) usage = chunk.usage;
    const text = chunk.choices?.[0]?.delta?.content;
    if (typeof text === 'string' && text.length && firstTextMs == null) firstTextMs = performance.now() - start;
  };
  for await (const bytes of response.body) {
    buffer += decoder.decode(bytes, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, end).trimEnd()); buffer = buffer.slice(end + 1); }
  }
  buffer += decoder.decode();
  if (buffer.trim()) consume(buffer.trimEnd());
  const numeric = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 'desconocido';
  return { firstTextMs: firstTextMs ?? 'desconocido', totalMs: performance.now() - start,
    inputTokens: numeric(usage?.prompt_tokens), outputTokens: numeric(usage?.completion_tokens),
    cachedTokens: numeric(usage?.prompt_tokens_details?.cached_tokens), reportedUsd: numeric(usage?.cost) };
}

async function main() {
  const { fixtures, report, dir } = await readPilot(process.cwd());
  await writeFile(await safeFile(dir, 'estimate.json'), JSON.stringify(report, null, 2));
  if (!process.argv.includes('--execute')) { console.log(JSON.stringify(report, null, 2)); return; }
  if (process.env.PRICE_PILOT_APPROVAL !== report.approvalHash) throw new Error('Explicit approval of this exact manifest required');
  const key = process.env.NANOGPT_API_KEY;
  if (!key) throw new Error('No authorized sandbox credential');
  const lock = await open(await safeFile(dir, 'execution.lock'), 'wx');
  await lock.close(); // Retained after completion/interruption: a second process cannot send the pilot again.
  const ledgerPath = await safeFile(dir, 'ledger.json');
  const raw = await readFile(ledgerPath, 'utf8').catch((e) => { if (e.code !== 'ENOENT') throw e; });
  const ledger = raw ? JSON.parse(raw) : { approvalHash: report.approvalHash, chargedMicroUsd: 0, stopped: false, calls: [] };
  if (ledger.approvalHash !== report.approvalHash) throw new Error('Ledger belongs to another manifest');
  const order = [0, 1, 3, 2, 4, 5]; // control/notice, notice/control, control/notice
  for (const index of order) {
    const row = report.rows[index];
    reserveCall(ledger, row);
    await writeFile(ledgerPath, JSON.stringify(ledger, null, 2)); // Persist reservation BEFORE sending.
    try {
      const result = await sampleRequest(fixtures[index].body, key);
      settleCall(ledger, row, result.reportedUsd);
      Object.assign(ledger.calls.at(-1), result);
      await writeFile(ledgerPath, JSON.stringify(ledger, null, 2));
      console.log(JSON.stringify({ id: row.id, ...result, accountedUsd: ledger.calls.at(-1).chargedMicroUsd / 1e6 }));
      if (ledger.stopped) throw new Error('Cost exceeded reservation; stopped');
    } catch {
      ledger.stopped = true; // Keep highest reservation when the submission/result is uncertain.
      await writeFile(ledgerPath, JSON.stringify(ledger, null, 2));
      throw new Error('Pilot stopped; no automatic retry');
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exitCode = 1; });
}
