#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const HELP = `ogs — Open Gen Studio sandbox CLI
Start npm run dev:sandbox and open http://127.0.0.1:5183.
Click "Link CLI to this tab" when the sandbox is ready.

  ogs find [--area <area>] [--text <words>] [--schema <id>]
  ogs run [<json> | --file <path>]  (otherwise reads stdin)
  ogs status
  ogs --help

  ogs find --area designer --text document
  ogs find --schema designer.doc.new
  ogs run '{"cmd":"sessions.list"}'
  ogs run '{"cmd":"designer.doc.new","args":{"width":320,"height":240,"name":"CLI pilot"}}'

Find returns signatures and active context. Run uses that session by
default and accepts {cmd,args?,on?} or {seq:[...],on?}.
Approve changes, spending and deletions in the linked tab.
Use --url, --token or --timeout <ms> to override the local session
(or OGS_CLI_URL, OGS_CLI_TOKEN, OGS_CLI_TIMEOUT). Exit 0 on ok, 1 on error.
`;

function output(value) {
  process.stdout.write(JSON.stringify(value) + '\n');
  process.exitCode = value.ok ? 0 : 1;
}

const fail = (code, message) => output({ ok: false, error: { code, message } });

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      area: { type: 'string' }, text: { type: 'string' }, schema: { type: 'string' },
      file: { type: 'string' }, url: { type: 'string' }, token: { type: 'string' }, timeout: { type: 'string' },
    },
  });
  const [operation, inline, ...rest] = positionals;
  if (values.help) return process.stdout.write(HELP);
  if (!['find', 'run', 'status'].includes(operation)) return fail('usage', 'Use ogs --help.');
  const { area, text, schema, file } = values;
  if (rest.length || (operation !== 'run' && (inline !== undefined || file !== undefined)) ||
      (operation === 'run' && inline !== undefined && file !== undefined) ||
      (operation !== 'find' && [area, text, schema].some((value) => value !== undefined))) {
    return fail('usage', 'Invalid arguments. Use ogs --help.');
  }

  let payload;
  if (operation === 'run') {
    if (inline === undefined && file === undefined && process.stdin.isTTY) return fail('usage', 'Supply JSON inline, through --file, or on stdin.');
    const chunks = [];
    if (inline === undefined && file === undefined) {
      for await (const chunk of process.stdin) chunks.push(chunk);
    }
    const json = inline ?? (file === undefined ? Buffer.concat(chunks).toString('utf8') : await readFile(file, 'utf8'));
    try { payload = JSON.parse(json); }
    catch { return fail('invalid', 'Run input must be valid JSON.'); }
  }

  let address = values.url ?? process.env.OGS_CLI_URL;
  let token = values.token ?? process.env.OGS_CLI_TOKEN;
  if (!address || !token) {
    let session;
    try { session = JSON.parse(await readFile(new URL('../.sandbox/external-cli.json', import.meta.url), 'utf8')); }
    catch { return fail('disconnected', 'No sandbox session file. Start npm run dev:sandbox first.'); }
    address ??= session?.url;
    token ??= session?.token;
  }
  const base = URL.parse(address ?? '');
  if (!base || base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.username || base.password ||
      base.pathname !== '/' || base.search || base.hash || typeof token !== 'string' || !token) {
    return fail('invalid', 'Expected an HTTP origin on 127.0.0.1 and a sandbox token.');
  }

  const timeout = Number(values.timeout ?? process.env.OGS_CLI_TIMEOUT ?? 65_000);
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2_147_483_647) {
    return fail('invalid', 'Timeout must be a positive integer in milliseconds.');
  }
  const url = new URL(`/x/ext/${operation}`, base);
  for (const [key, value] of Object.entries({ area, text, schema })) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  const signal = AbortSignal.timeout(timeout);
  try {
    const response = await fetch(url, {
      method: operation === 'run' ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(operation === 'run' ? { body: JSON.stringify(payload) } : {}),
      redirect: 'error',
      signal,
    });
    const value = await response.json();
    if (typeof value?.ok !== 'boolean') return fail('protocol', 'Invalid bridge response.');
    output(value);
  } catch {
    fail(signal.aborted ? 'timeout' : 'disconnected',
      signal.aborted ? 'Timed out waiting for the sandbox bridge.' : 'Could not reach the sandbox bridge.');
  }
}

main().catch((error) => fail('invalid', error.code === 'ENOENT' ? 'Input file was not found.' : 'Invalid CLI arguments or input. Use ogs --help.'));
