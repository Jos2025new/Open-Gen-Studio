/** Static, fail-closed inspection of the command convention. No TypeScript is executed. */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ID = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/;
const factories = new Set(['defineCommand', 'docCommand', 'nodeCommand']);
const line = (text, at) => text.slice(0, at).split('\n').length;
function tokens(text) {
  const out = [];
  const re = /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|[A-Za-z_$][\w$]*|\.\.\.|./gy;
  for (let m; (m = re.exec(text));) {
    const v = m[0];
    if (/^\s|^\/\//.test(v) || v.startsWith('/*')) continue;
    out.push({ v, at: m.index });
  }
  return out;
}
function end(ts, start) {
  const opens = { '(': ')', '[': ']', '{': '}' }, stack = [];
  for (let i = start; i < ts.length; i++) {
    const v = ts[i].v;
    if (opens[v]) stack.push(opens[v]);
    else if (v === stack.at(-1)) { stack.pop(); if (!stack.length) return i; }
  }
  return -1;
}
function parts(ts, start, stop) {
  const result = []; let begin = start;
  for (let i = start; i < stop; i++) {
    if (['(', '[', '{'].includes(ts[i].v)) { const j = end(ts, i); if (j < 0 || j >= stop) return []; i = j; }
    else if (ts[i].v === ',') { if (i > begin) result.push(ts.slice(begin, i)); begin = i + 1; }
  }
  if (begin < stop) result.push(ts.slice(begin, stop));
  return result;
}
function stringValue(token) {
  if (!token || !/^['"]/.test(token.v)) return null;
  try { return JSON.parse(token.v[0] === '"' ? token.v : '"' + token.v.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"') + '"'); } catch { return null; }
}
function strictObject(ts) {
  return ts[0]?.v === 'z' && ts[1]?.v === '.' && ts[2]?.v === 'object' && ts[3]?.v === '(' && (() => {
    const j = end(ts, 3); return j >= 0 && ts[j + 1]?.v === '.' && ts[j + 2]?.v === 'strict' && ts[j + 3]?.v === '(' && ts[j + 4]?.v === ')' && j + 5 === ts.length;
  })();
}
function inspect(files, baseline = {}) {
  const errors = [], debt = {}, counts = {}, names = new Map();
  const fail = (file, text, at, message) => errors.push(`${file}:${line(text, at)}: ${message}`);
  const addDebt = (area, id, text, file, at, source) => (debt[area] ??= []).push({ id, text, file, line: line(source, at) });
  for (const [file, source] of Object.entries(files)) {
    const ts = tokens(source), constants = new Map();
    for (let i = 0; i < ts.length - 3; i++) if (ts[i].v === 'const' && ts[i+2]?.v === '=') {
      let j = i + 3;
      while (j < ts.length && ts[j].v !== ';') { if (['(', '[', '{'].includes(ts[j].v)) { const k = end(ts, j); if (k < 0) break; j = k; } j++; }
      constants.set(ts[i+1].v, ts.slice(i+3, j));
    }
    let exported = false;
    for (let i = 0; i < ts.length; i++) if (ts[i].v === 'export' && ts[i+1]?.v === 'const' && ts[i+2]?.v === 'commands' && ts[i+3]?.v === '=') {
      exported = true;
      if (ts[i+4]?.v !== '[') { fail(file, source, ts[i].at, 'Export a readable commands array; teach the check any new factory.'); continue; }
      const last = end(ts, i+4);
      if (last < 0) { fail(file, source, ts[i].at, 'Close the commands array.'); continue; }
      for (const entry of parts(ts, i+5, last)) if (!factories.has(entry[0]?.v) || entry[1]?.v !== '(' || end(entry, 1) !== entry.length - 1)
        fail(file, source, entry[0]?.at ?? ts[i].at, 'Teach check-commands this factory or use a known command factory.');
    }
    if (!exported) { const area = file.split('/').at(-2); addDebt(area, file, 'File exports no commands array.', file, 0, source); }
    for (let i = 0; i < ts.length; i++) {
      if (!factories.has(ts[i].v) || ts[i+1]?.v !== '(') continue;
      if (ts[i+2]?.v !== '{') { fail(file, source, ts[i].at, 'Pass a readable object to the command factory.'); continue; }
      const last = end(ts, i+2); if (last < 0) { fail(file, source, ts[i].at, 'Close the command object.'); continue; }
      const fields = new Map();
      for (const part of parts(ts, i+3, last)) if (part[1]?.v === ':') fields.set(part[0].v, part.slice(2));
      for (const field of ['id', 'title', 'args', 'effect']) if (!fields.has(field)) fail(file, source, ts[i].at, `Add ${field} to this command.`);
      const id = stringValue(fields.get('id')?.[0]);
      if (!id) { fail(file, source, ts[i].at, 'Use a literal command id.'); continue; }
      const area = id.split('.')[0]; counts[area] = (counts[area] ?? 0) + 1;
      const aliases = fields.get('aliases');
      let identifiers = [id];
      if (aliases) {
        if (aliases[0]?.v !== '[' || end(aliases, 0) !== aliases.length - 1) fail(file, source, aliases[0].at, 'Use a literal aliases array.');
        else for (const item of parts(aliases, 1, aliases.length-1)) { const alias = item.length === 1 && stringValue(item[0]); if (!alias) fail(file, source, item[0].at, 'Use a literal alias.'); else identifiers.push(alias); }
      }
      for (const name of identifiers) {
        if (!ID.test(name)) fail(file, source, ts[i].at, `Fix invalid id or alias ${name}.`);
        if (names.has(name)) fail(file, source, ts[i].at, `Remove duplicate id or alias ${name} (first at ${names.get(name)}).`);
        else names.set(name, `${file}:${line(source, ts[i].at)}`);
      }
      let args = fields.get('args');
      if (args?.length === 1 && constants.has(args[0].v)) args = constants.get(args[0].v);
      if (args && !strictObject(args)) fail(file, source, fields.get('args')[0].at, 'Use an inline or same-file z.object(...).strict() schema.');
      const debtField = fields.get('debt');
      if (debtField) { const value = debtField.length === 1 && stringValue(debtField[0]); if (!value) fail(file, source, debtField[0].at, 'Use literal debt text.'); else addDebt(area, id, value, file, ts[i].at, source); }
      const body = source.slice(ts[i+2].at, ts[last].at + 1);
      if (/\bactiveDoc\s*\(|\bactiveDocId\b|\bactiveSessionId\b|\bgetState\s*\(\s*\)\s*\.\s*ui\b/.test(body) && !debtField && !/\/\/\s*check-commands:\s*reads-active\s+\S/.test(body))
        fail(file, source, ts[i].at, 'Declare debt or add a nearby check-commands: reads-active reason.');
      i = last;
    }
  }
  for (const area of new Set([...Object.keys(debt), ...Object.keys(baseline)])) {
    const current = debt[area] ?? [], old = baseline[area] ?? [];
    for (const d of current) if (!old.some((x) => x.id === d.id && x.text === d.text)) errors.push(`${d.file}:${d.line}: New or changed debt ${d.id}; remove it or update the baseline intentionally.`);
    for (const d of old) if (!current.some((x) => x.id === d.id && x.text === d.text)) errors.push(`scripts/commands-debt/${area}.json:1: Debt ${d.id} disappeared or changed; run node scripts/check-commands.mjs --update.`);
  }
  return { errors, debt, counts };
}
function walk(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(dir, e.name)) : /(^commands|\.commands)\.ts$/.test(e.name) ? [join(dir, e.name)] : []); }
function selfTest() {
  const base = "export const commands = [defineCommand({ id: 'x.one', title: 'One', args: z.object({}).strict(), effect: 'read', run: () => 1 })];";
  const cases = [
    ['missing args', base.replace('args: z.object({}).strict(), ', '')],
    ['non-strict', base.replace('.strict()', '')],
    ['duplicate', base.replace('];', ", defineCommand({ id: 'x.one', title: 'Two', args: z.object({}).strict(), effect: 'read' })];")],
    ['active read', base.replace('() => 1', '() => activeDoc()')],
    ['new debt', base.replace("effect: 'read'", "effect: 'read', debt: 'new'")],
  ];
  let failed = false;
  for (const [name, source] of cases) { const errors = inspect({ 'fixture/commands.ts': source }).errors; if (!errors.some((e) => /^fixture\/commands\.ts:\d+:/.test(e))) { console.error(`self-test FAIL: ${name}`); failed = true; } else console.log(`self-test ${name}: ${errors[0]}`); }
  if (failed) process.exitCode = 1;
}
if (process.argv.includes('--self-test')) selfTest();
else {
  const files = Object.fromEntries(walk('src').sort().map((f) => [f, readFileSync(f, 'utf8')]));
  const dir = 'scripts/commands-debt';
  const baseline = Object.fromEntries((existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : []).map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(dir, f), 'utf8'))]));
  const result = inspect(files, baseline);
  for (const area of [...new Set([...Object.keys(result.counts), ...Object.keys(result.debt), ...Object.keys(baseline)])].sort()) {
    console.log(`${area}: ${result.counts[area] ?? 0} commands`);
    for (const d of result.debt[area] ?? []) console.log(`  ${d.id}: ${d.text}`);
  }
  if (process.argv.includes('--update')) {
    const structural = result.errors.filter((e) => !/New or changed debt|disappeared or changed/.test(e));
    if (structural.length) { console.error(structural.join('\n')); process.exitCode = 1; }
    else { mkdirSync(dir, { recursive: true }); for (const area of new Set([...Object.keys(result.debt), ...Object.keys(baseline)])) writeFileSync(join(dir, `${area}.json`), JSON.stringify((result.debt[area] ?? []).map(({ id, text }) => ({ id, text })), null, 2) + '\n'); console.log('check-commands: baselines updated'); }
  } else if (result.errors.length) { console.error(result.errors.join('\n')); process.exitCode = 1; }
  else console.log('check-commands: PASS');
}
