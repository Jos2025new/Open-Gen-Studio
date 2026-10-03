// @ts-nocheck -- Node fs in a test; the project has no @types/node (see tests/bench/node.d.ts).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';

/*
 * A browser run beside its automatic twin (or any two reference runs), scenario by scenario, from their report.json:
 *   E2E_COMPARE=e2e-runs/2026-10-03-0013,e2e-runs/<date>-twin [E2E_OUT=<folder>] npx vitest run tests/e2e/compare.test.ts
 * Scenarios are matched by their first request. Per request: the cards and plans in order (the flow), what the
 * harness refused, the steps (kind, model, count, variations, refs), the agent's calls and seconds; then the checks
 * that failed in one run and not in the other. Writes compare.md in the first folder (or E2E_OUT).
 */

interface Report { title: string; checks: Array<{ check: string; ok: boolean; detail: string }>; metrics: Array<{ request: string; calls: number; seconds: number; firstOutputS?: number | null }>; lines: string[]; generations: number; failedGenerations: number; charged: number; estimated: number; agentUsd: number }

const norm = (t: string) => t.toLowerCase().replace(/[^a-záéíóúñ0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
const short = (ref: string) => ref.split('/').pop() ?? ref;

/** One request as a few comparable lines: flow, steps and refusals, read from the report's timeline. */
function requests(r: Report) {
  const out: Array<{ request: string; flow: string[]; steps: string[] }> = [];
  for (const raw of r.lines) {
    const line = raw.replace(/^\n+/, "");
    const req = /^\*\*(Request \d+|Comment on the plan):\*\* (.*)$/.exec(line);
    if (req) { out.push({ request: `${req[1] === 'Comment on the plan' ? '💬 ' : ''}${req[2].replace(/ _\(\+\d attached\)_/, '')}`, flow: [], steps: [] }); continue; }
    const cur = out.at(-1);
    if (!cur) continue;
    if (/^- Questions/.test(line)) cur.flow.push(`questions(${(line.match(/ → \*\*/g) ?? []).length})`);
    else if (/^- Settings card/.test(line)) cur.flow.push(`settings[${line.replace(/^- Settings card \(\w+\): /, '').replace(/[\w.-]+\/[\w./-]+/g, short)}]`);
    else if (/^- Plan /.test(line)) cur.flow.push(`plan(${/\((done|error|partial|canceled|awaiting|running|superseded)\b/.exec(line)?.[1] ?? '?'})`);
    else if (/^- Agent:/.test(line)) cur.flow.push('reply');
    else if (/^ {2}- s\d+ /.test(line)) cur.steps.push(line.trim().replace(/[\w.-]+\/[\w./-]+/g, short).replace(/ → .*$/, '').replace(/ · refs [^·]*/, (m) => ` · refs ${m.split(',').length}`));
  }
  return out;
}

describe.skipIf(!process.env.E2E_COMPARE)('compare two reference runs', () => {
  it('writes compare.md', () => {
    const [a, b] = process.env.E2E_COMPARE!.split(',');
    const load = (dir: string) => JSON.parse(readFileSync(join(dir, 'report.json')).toString('utf8')) as { commit: string; reports: Report[] };
    const A = load(a);
    const B = load(b);
    const md: string[] = [`# ${a} (A) vs ${b} (B)`, '', `A commit ${A.commit} · B commit ${B.commit}`, ''];
    const summary: string[][] = [];
    for (const ra of A.reports) {
      const rb = B.reports.find((x) => norm(x.title) === norm(ra.title));
      md.push(`## ${ra.title}`, '');
      if (!rb) { md.push('Only in A.', ''); continue; }
      const qa = requests(ra);
      const qb = requests(rb);
      // The shape of the flow (which cards and plans, in order), not their contents.
      const shape = (qs: typeof qa) => JSON.stringify(qs.map((q) => q.flow.map((f) => f.replace(/[[(].*$/, ''))));
      const flowSame = shape(qa) === shape(qb);
      md.push('| Request | A flow | B flow | A steps | B steps |', '|---|---|---|---|---|');
      for (let i = 0; i < Math.max(qa.length, qb.length); i++) {
        const x = qa[i];
        const y = qb[i];
        md.push(`| ${(x ?? y)!.request.slice(0, 50)} | ${x?.flow.join(' → ') ?? '—'} | ${y?.flow.join(' → ') ?? '—'} | ${x?.steps.join('<br>') ?? '—'} | ${y?.steps.join('<br>') ?? '—'} |`);
      }
      const fa = ra.checks.filter((c) => !c.ok).map((c) => `${c.check}: ${c.detail}`);
      const fb = rb.checks.filter((c) => !c.ok).map((c) => `${c.check}: ${c.detail}`);
      md.push('', `Failed checks — A: ${fa.length ? fa.map((f) => `\n  - ${f}`).join('') : 'none'}`, `Failed checks — B: ${fb.length ? fb.map((f) => `\n  - ${f}`).join('') : 'none'}`);
      const secs = (r: Report) => r.metrics.map((m) => `${m.seconds} s/${m.calls} calls`).join(', ');
      md.push('', `Agent — A: ${secs(ra)} · B: ${secs(rb)}`, `Generations — A: ${ra.generations} (${ra.failedGenerations} failed) · B: ${rb.generations} (${rb.failedGenerations} failed)`, '');
      summary.push([ra.title.slice(0, 40), flowSame ? 'same' : 'differs', `${fa.length} / ${fb.length}`, `${ra.metrics.reduce((s, m) => s + m.seconds, 0).toFixed(0)} / ${rb.metrics.reduce((s, m) => s + m.seconds, 0).toFixed(0)}`]);
    }
    for (const rb of B.reports) if (!A.reports.some((x) => norm(x.title) === norm(rb.title))) md.push(`## ${rb.title}`, '', 'Only in B.', '');
    md.splice(4, 0, '| Scenario | Flow | Failed checks A / B | Agent s A / B |', '|---|---|---|---|', ...summary.map((r) => `| ${r.join(' | ')} |`), '');
    const out = process.env.E2E_OUT ?? a;
    writeFileSync(join(out, 'compare.md'), md.join('\n'));
    console.log(`Compare: ${join(out, 'compare.md')}`);
  });
});
