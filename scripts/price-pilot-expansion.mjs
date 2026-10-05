import { lstat, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { environmentKey, estimatePilot, readPilot, reserveCall, sampleRequest, settleCall } from './price-pilot.mjs';

export const LIMIT_MICRO_USD = 1_000_000;
export const MODELS = Object.freeze([
  { id: 'xiaomi/mimo-v2.6-flash', input: 0.14, output: 0.28, rejectionFeeMicroUsd: 0, mediumAdvertised: false, subscriptionIncluded: true },
  { id: 'x-ai/grok-4.7', input: 1.6, output: 4.8, rejectionFeeMicroUsd: 55_000, mediumAdvertised: true, subscriptionIncluded: false },
  { id: 'openai/gpt-6-luna', input: 0.1, output: 0.5, rejectionFeeMicroUsd: 0, mediumAdvertised: true, subscriptionIncluded: false },
  { id: 'z-ai/glm-5.3-flash', input: 0.1, output: 0.3, rejectionFeeMicroUsd: 0, mediumAdvertised: false, subscriptionIncluded: true },
].map(Object.freeze));
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const IDS = ['first-control', 'first-notice', 'continuation-continue-control', 'continuation-continue-notice',
  'continuation-cancel-control', 'continuation-cancel-notice'];

async function safeFile(dir, name) {
  const path = resolve(dir, name);
  const info = await lstat(path).catch((e) => { if (e.code !== 'ENOENT') throw e; });
  if (info && (info.isSymbolicLink() || !info.isFile())) throw new Error('Unsafe expansion file');
  return path;
}
async function expansionDirectory(pilotDir) {
  const dir = resolve(pilotDir, 'expansion');
  const info = await lstat(dir).catch((e) => { if (e.code !== 'ENOENT') throw e; });
  if (info && (info.isSymbolicLink() || !info.isDirectory())) throw new Error('Unsafe expansion directory');
  await mkdir(dir, { recursive: true });
  return dir;
}

export function buildExpansion(fixtures, previousLedger) {
  const original = estimatePilot(fixtures);
  if (fixtures.some((f, i) => f.id !== IDS[i])) throw new Error('Unexpected original fixtures');
  if (previousLedger.approvalHash !== original.approvalHash || previousLedger.stopped || previousLedger.calls?.length !== 6 ||
      new Set(previousLedger.calls.map((c) => c.id)).size !== 6 || previousLedger.calls.some((c) =>
        !IDS.includes(c.id) || c.status !== 'finished' || !Number.isSafeInteger(c.chargedMicroUsd) || c.chargedMicroUsd < 0)) {
    throw new Error('Completed original pilot ledger required');
  }
  const previousMicroUsd = previousLedger.calls.reduce((sum, c) => sum + c.chargedMicroUsd, 0);
  if (previousMicroUsd !== previousLedger.chargedMicroUsd || previousMicroUsd > 50_000) throw new Error('Invalid original accounting');
  const requests = [];
  // Interleave models within each case; reverse the pair order in the second case.
  for (const [a, b] of [[0, 1], [3, 2], [4, 5]]) {
    for (const model of MODELS) {
      for (const index of [a, b]) {
        const f = fixtures[index];
        requests.push({ id: `${model.id}/${f.id}`, case: f.case, arm: f.arm,
          body: { ...f.body, model: model.id, reasoning_effort: 'medium' } });
      }
    }
  }
  const rows = requests.map((r) => {
    const model = MODELS.find((m) => m.id === r.body.model);
    const serialized = JSON.stringify(r.body);
    const characters = [...serialized].length;
    const inputTokensEstimate = Math.ceil(characters / 3 * 1.5);
    const tokenMicroUsd = Math.ceil(inputTokensEstimate * model.input + 500 * model.output);
    const maximumMicroUsd = tokenMicroUsd + model.rejectionFeeMicroUsd;
    return { id: r.id, case: r.case, arm: r.arm, model: model.id, requestedReasoningEffort: 'medium',
      effectiveReasoningEffort: 'desconocido', mediumAdvertised: model.mediumAdvertised, serializedCharacters: characters,
      inputTokensEstimate, maxOutputTokens: 500, tokenMicroUsd, rejectionFeeMicroUsd: model.rejectionFeeMicroUsd,
      maximumMicroUsd, requestSha256: sha(r.body) };
  });
  const additionalMicroUsd = rows.reduce((sum, r) => sum + r.maximumMicroUsd, 0);
  const totalMicroUsd = previousMicroUsd + additionalMicroUsd;
  if (totalMicroUsd > LIMIT_MICRO_USD) throw new Error('Expansion exceeds approved global USD 1.00');
  const report = { catalogDate: '2026-10-05', method: 'ceil(unicodeCharacters(JSON.stringify(body)) / 3 * 1.5)',
    models: MODELS, requestedReasoningEffort: 'medium', effectiveReasoningEffort: 'desconocido', calls: 24,
    hardLimitUsd: 1, previousLedgerSha256: sha(previousLedger), previousMicroUsd, previousUsd: previousMicroUsd / 1e6,
    additionalMaximumUsd: additionalMicroUsd / 1e6, globalMaximumUsd: totalMicroUsd / 1e6, rows };
  return { requests, report: { ...report, approvalHash: sha(report) } };
}

export function newExpansionLedger(report) {
  return { approvalHash: report.approvalHash, previousLedgerSha256: report.previousLedgerSha256,
    previousMicroUsd: report.previousMicroUsd, chargedMicroUsd: report.previousMicroUsd, stopped: false, calls: [] };
}
function validateLedger(ledger, report) {
  const sum = ledger.calls?.reduce((s, c) => s + c.chargedMicroUsd, ledger.previousMicroUsd);
  if (ledger.approvalHash !== report.approvalHash || ledger.previousLedgerSha256 !== report.previousLedgerSha256 ||
      ledger.previousMicroUsd !== report.previousMicroUsd || sum !== ledger.chargedMicroUsd ||
      ledger.calls.some((c) => !Number.isSafeInteger(c.chargedMicroUsd) || c.chargedMicroUsd < 0)) throw new Error('Invalid expansion accounting');
  if (ledger.stopped || ledger.calls.length) throw new Error('Already attempted expansion; no resume or retry');
}
export function expansionResults(ledger) {
  return { limitUsd: 1, approvalHash: ledger.approvalHash, previousLedgerSha256: ledger.previousLedgerSha256,
    previousAccountedUsd: ledger.previousMicroUsd / 1e6, additionalAccountedUsd: (ledger.chargedMicroUsd - ledger.previousMicroUsd) / 1e6,
    globalAccountedUsd: ledger.chargedMicroUsd / 1e6, status: ledger.stopped ? 'stopped' :
      ledger.calls.length === 24 && ledger.calls.every((c) => c.status === 'finished') ? 'finished' : 'running', calls: ledger.calls };
}

export async function runExpansion(fixtures, previousLedger, ledger, save, env = process.env, fetcher = fetch) {
  const key = environmentKey(env);
  const { requests, report } = buildExpansion(fixtures, previousLedger);
  if (env.PRICE_PILOT_APPROVAL !== report.approvalHash) throw new Error('Approval of this exact expansion required');
  validateLedger(ledger, report);
  for (let i = 0; i < requests.length; i++) {
    const row = report.rows[i];
    try { reserveCall(ledger, row, LIMIT_MICRO_USD); }
    catch { ledger.stopped = true; await save(ledger); throw new Error('Global USD 1.00 budget blocked send'); }
    Object.assign(ledger.calls.at(-1), { case: row.case, arm: row.arm, model: row.model, requestedReasoningEffort: 'medium',
      effectiveReasoningEffort: 'desconocido', mediumAdvertised: row.mediumAdvertised, reasoningTokens: 'desconocido', finishReason: 'desconocido' });
    await save(ledger); // No network call until both the reservation and results are written.
    const start = performance.now();
    try {
      const result = await sampleRequest(requests[i].body, key, fetcher);
      settleCall(ledger, row, result.reportedUsd, LIMIT_MICRO_USD);
      Object.assign(ledger.calls.at(-1), result);
      await save(ledger);
      if (ledger.stopped) throw new Error('Reported cost exceeded reservation');
    } catch {
      ledger.stopped = true;
      if (ledger.calls.at(-1).status === 'reserved') Object.assign(ledger.calls.at(-1), {
        status: 'uncertain', costSource: 'highest-estimate', totalMs: performance.now() - start });
      await save(ledger);
      throw new Error('Expansion stopped; no automatic retry');
    }
  }
  return ledger;
}

async function main() {
  const execute = process.argv.includes('--execute');
  if (execute) environmentKey();
  const { fixtures, dir: pilotDir } = await readPilot(ROOT);
  const previousLedger = JSON.parse(await readFile(await safeFile(pilotDir, 'ledger.json'), 'utf8'));
  const { report } = buildExpansion(fixtures, previousLedger);
  const dir = await expansionDirectory(pilotDir);
  await writeFile(await safeFile(dir, 'estimate.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  if (!execute) { console.log(JSON.stringify(report, null, 2)); return; }
  if (process.env.PRICE_PILOT_APPROVAL !== report.approvalHash) throw new Error('Approval of this exact expansion required');
  const lock = await open(await safeFile(dir, 'execution.lock'), 'wx');
  await lock.close(); // Keep this lock permanently; the completed DeepSeek lock also remains untouched.
  const ledgerPath = await safeFile(dir, 'ledger.json');
  const existing = await readFile(ledgerPath, 'utf8').catch((e) => { if (e.code !== 'ENOENT') throw e; });
  const ledger = existing ? JSON.parse(existing) : newExpansionLedger(report);
  validateLedger(ledger, report);
  const resultsPath = await safeFile(dir, 'results.json');
  const save = async (state) => {
    await writeFile(ledgerPath, JSON.stringify(state, null, 2), { mode: 0o600 });
    await writeFile(resultsPath, JSON.stringify(expansionResults(state), null, 2), { mode: 0o600 });
  };
  await runExpansion(fixtures, previousLedger, ledger, save);
  console.log('Expansion finished. Results: .sandbox/pilot/expansion/results.json');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message === 'NANOGPT_API_KEY is required; no request sent' ? e.message :
      'Expansion aborted. No retry. Review .sandbox/pilot/expansion/results.json if created.');
    process.exitCode = 1;
  });
}
