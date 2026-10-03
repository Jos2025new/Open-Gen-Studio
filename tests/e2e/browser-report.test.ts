import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, vi } from 'vitest';

/*
 * Report of real sessions, from what the app itself saved (data/state.json): the browser tests of e2e/BROWSER_TESTS.md
 * and any earlier session. Nothing is called or spent. Run on demand:
 *
 *   E2E_REPORT=1 E2E_SINCE=2026-10-03T10:00 npx vitest run tests/e2e/browser-report.test.ts
 *   (or E2E_SESSIONS=ses_a,ses_b; E2E_STATE=<other state.json>; E2E_OUT=<folder>, default e2e-runs/<date>)
 *
 * Per session: a timeline (requests, questions and answers, confirmed settings, plans with their steps, models and
 * refs, the agent's replies, notices) and automatic checks of the flows that broke before (AGENTS.md F1–F30).
 */

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));

import { lineKey, variantRoute } from '../../src/engine/variants';
import { sectionsOf } from '../../src/engine/agent/settingsCard';
import type { FeedItem, Generation, LlmMessage, ModelSummary, PlanFeedItem, PlanStep, Session, SettingsChoice, SettingsFeedItem } from '../../src/engine/types';

type Saved = { sessions: Record<string, Session>; generations: Record<string, Generation> };
type Check = { check: string; ok: boolean; detail: string };

const model = (ref: string, kind: string): Pick<ModelSummary, 'provider' | 'id' | 'kind' | 'ref' | 'needsVideo' | 'acceptsImage'> => {
  const [provider, ...rest] = ref.split('::');
  return { provider: provider as ModelSummary['provider'], id: rest.join('::'), kind: kind as ModelSummary['kind'], ref, needsVideo: false, acceptsImage: false };
};
const name = (ref?: string) => (ref ? ref.split('::').slice(1).join('::') : '—');
const usd = (n?: number | null) => (n == null ? '—' : `$${n.toFixed(3)}`);
const clip = (t: string | undefined, n = 160) => (t ? (t.length > n ? `${t.slice(0, n)}…` : t).replace(/\n+/g, ' ') : '');
const text = (c: LlmMessage['content']) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => (p.type === 'text' ? p.text : '[image]')).join(' ') : '');

/** A prompt that cites an input image ("image 1", "@Image1", "<Picture 1>", "<IMAGE_REF_0>"). */
const CITES = /@image\s*\d|<picture\s*\d>|<image_(ref_)?\d>|\b(image|picture)\s*\d\b/i;
/** What the harness answered when the agent went out of order or wrote an invalid plan. */
const REFUSALS: Array<[string, RegExp]> = [
  ['plan before settings', /^Not shown: call confirm_settings first/],
  ['guide before settings', /^Not loaded: the (video model is not confirmed|confirmed video model is)/],
  ['plan rejected', /^Plan rejected by the validator/],
  ['invalid plan', /^Invalid propose_plan input/],
  ['questions used up', /^Question rounds are used up/],
  ['invalid settings', /^Invalid confirm_settings input/],
];

function stepDeps(st: PlanStep): string[] {
  const s = st as unknown as Record<string, unknown>;
  const list = [s.input, s.firstFrame, s.lastFrame, s.promptFrom, s.lyricsFrom, ...((s.refs as string[]) ?? []), ...((s.more as string[]) ?? [])];
  return list.filter((r): r is string => typeof r === 'string' && !r.startsWith('asset:') && !r.startsWith('layer:')).map((r) => r.split('#')[0]);
}

function reportSession(s: Session, gens: Record<string, Generation>) {
  const feed = s.feed;
  const history = s.agent?.history ?? [];
  const checks: Check[] = [];
  const lines: string[] = [];
  const add = (check: string, ok: boolean, detail: string) => checks.push({ check, ok, detail });

  // Comments on a waiting plan reach the agent as a tool result, not as a new request.
  const comments = new Set(history.flatMap((m) => (m.role === 'tool' && /^The user replied instead of approving/.test(text(m.content)) ? [/<user_message[^>]*>\n?([\s\S]*?)\n?<\/user_message>/.exec(text(m.content))?.[1]?.trim() ?? ''] : [])));
  // Harness refusals, in order, with the request they belong to (each fresh request opens a user message in the history).
  let req = 0;
  const refusals: Array<{ req: number; kind: string; text: string }> = [];
  for (const m of history) {
    if (m.role === 'user' && /<user_message/.test(text(m.content))) req++;
    if (m.role === 'tool') for (const [kind, re] of REFUSALS) if (re.test(text(m.content))) refusals.push({ req, kind, text: clip(text(m.content), 220) });
  }

  let request = 0;
  let lastSettings: SettingsFeedItem | undefined;
  let settingsSinceRequest = false;
  for (const [i, f] of feed.entries()) {
    switch (f.type) {
      case 'user': {
        const isComment = comments.has(f.text.trim());
        if (!isComment) {
          request++;
          settingsSinceRequest = false;
        }
        lines.push(`\n**${isComment ? 'Comment on the plan' : `Request ${request}`}:** ${clip(f.text, 300)}${f.attachments.length ? ` _(+${f.attachments.length} attached)_` : ''}`);
        break;
      }
      case 'questions':
        lines.push(`- Questions (${f.status}): ${f.questions.map((q) => `${q.question} → **${f.answers?.[q.id] ?? '—'}**`).join(' · ')}`);
        break;
      case 'settings': {
        const sections = sectionsOf(f);
        lines.push(`- Settings card (${f.status}): ${sections.map((x) => { const c: SettingsChoice = x.chosen ?? x.recommended; return `${x.kind}: ${name(c.modelRef)} · ${c.resolution ?? '—'}${c.duration ? ` · ${c.duration}s` : ''}${c.aspect ? ` · ${c.aspect}` : ''}${c.count ? ` · ×${c.count}` : ''}${c.modelRef !== x.recommended.modelRef ? ` (recommended ${name(x.recommended.modelRef)})` : ''}`; }).join(' | ')}`);
        if (f.status === 'confirmed') {
          lastSettings = f;
          settingsSinceRequest = true;
        }
        break;
      }
      case 'plan':
        reportPlan(f, i);
        break;
      case 'assistant':
        if (f.text.trim()) lines.push(`- Agent: ${clip(f.text, 400)}`);
        break;
      case 'notice':
        lines.push(`- ⚠️ Notice: ${clip(f.text, 300)}`);
        break;
      default:
        break;
    }
  }

  function reportPlan(p: PlanFeedItem, index: number) {
    const steps = p.plan.steps;
    const media = steps.filter((st) => st.kind === 'image' || st.kind === 'video');
    lines.push(`- Plan "${p.plan.title}" (${p.status}${p.revised ? ', revised' : ''}) · est ${usd(p.estimate.usd)}`);
    for (const st of steps) {
      const g = gens[p.stepGenerations[st.id]];
      const refs = 'refs' in st ? (st.refs ?? []) : [];
      const settings = 'settings' in st ? st.settings : undefined;
      lines.push(`  - ${st.id} ${st.kind}${st.kind === 'op' ? `(${st.op})` : ''} "${st.title}" · ${'modelRef' in st ? name(st.modelRef) : '—'}${settings ? ` · ${settings.resolution ?? '—'}${settings.duration ? ` · ${settings.duration}s` : ''} · ×${settings.count}` : ''}${refs.length ? ` · refs ${refs.join(', ')}` : ''}${'firstFrame' in st && st.firstFrame ? ` · start ${st.firstFrame}` : ''}${'variations' in st && st.variations?.length ? ` · ${st.variations.length} variations` : ''}${g ? ` → ${g.status}${g.error ? ` (${clip(g.error, 120)})` : ''} · ${usd(g.actualUsd ?? null)} charged / ${usd(g.estimate?.usd ?? null)} est${g.startedAt && g.finishedAt ? ` · ${Math.round((g.finishedAt - g.startedAt) / 1000)} s` : ''}` : ''}`);
      if ('prompt' in st && st.prompt) lines.push(`    > ${clip(st.prompt, 260)}`);
    }
    if (p.plan.adjustments.length) lines.push(`  - Adjustments: ${p.plan.adjustments.map((a) => clip(a, 140)).join(' · ')}`);
    const where = `request ${request}, plan "${p.plan.title}"`;

    // Phase 2 before any plan that generates.
    if (media.length && !p.nodeRun) add('settings card before the plan', settingsSinceRequest || Boolean(p.revised), where);
    // What was confirmed is what ran.
    const sections = lastSettings ? sectionsOf(lastSettings) : [];
    for (const st of media) {
      const g = gens[p.stepGenerations[st.id]];
      const conf = sections.find((x) => x.kind === st.kind)?.chosen;
      if (!g || !conf) continue;
      const same = lineKey(model(g.modelRef, g.kind) as ModelSummary) === lineKey(model(conf.modelRef, st.kind) as ModelSummary);
      add('confirmed model line ran', same, `${where} ${st.id}: ran ${name(g.modelRef)} (${variantRoute(model(g.modelRef, g.kind) as ModelSummary)}), confirmed ${name(conf.modelRef)}`);
      if (conf.resolution) add('confirmed resolution ran', String(g.settings.resolution ?? '').toLowerCase() === conf.resolution.toLowerCase(), `${where} ${st.id}: ${g.settings.resolution ?? '—'} vs ${conf.resolution}`);
      if (st.kind === 'video' && conf.duration) add('confirmed duration ran', g.settings.duration === conf.duration, `${where} ${st.id}: ${g.settings.duration ?? '—'}s vs ${conf.duration}s`);
      if (st.kind === 'image' && conf.count && media.filter((x) => x.kind === 'image').length === 1) add('confirmed image count ran', (g.variants?.length || g.settings.count) === conf.count, `${where} ${st.id}: ${g.variants?.length || g.settings.count} vs ${conf.count}`);
      // A prompt citing an image the request did not carry would invent it (the new girl on the sofa).
      if (CITES.test(g.prompt)) add('cited image is sent', g.inputs.refs.length > 0 || Boolean(g.inputs.firstFrame), `${where} ${st.id}: cites "${CITES.exec(g.prompt)?.[0]}", refs ${g.inputs.refs.length}`);
      if (st.kind === 'video') lines.push(`  - Video inputs ${st.id}: ${g.inputs.refs.length} refs${g.inputs.firstFrame ? ' + start frame' : ''}`);
    }
    // Candidates end a plan: no step of the same plan may use a step that makes several.
    const several = new Set(steps.filter((st) => ('settings' in st && (st.settings?.count ?? 1) > 1) || (st.kind === 'op' && Number(st.params?.count ?? 1) > 1)).map((st) => st.id));
    for (const st of steps) for (const d of stepDeps(st)) if (several.has(d)) add('candidates end the plan', false, `${where}: ${st.id} uses ${d}, which makes several`);
    // A comment that got a text answer must leave the plan waiting (it was cancelled before F30).
    const after = feed.slice(index + 1);
    const commentedAfter = after.findIndex((f) => f.type === 'user' && comments.has(f.text.trim()));
    if (commentedAfter >= 0 && p.status === 'canceled') {
      const replaced = after.slice(commentedAfter).some((f) => f.type === 'plan');
      add('comment keeps the plan', replaced, `${where}: canceled after a comment${replaced ? ', replaced by a new plan' : ' with no new plan'}`);
    }
    for (const st of media) {
      const g = gens[p.stepGenerations[st.id]];
      if (g?.status === 'error') add('provider error', false, `${where} ${st.id}: ${clip(g.error, 200)}`);
    }
  }

  for (const r of refusals) add(`harness: ${r.kind}`, false, `request ${r.req}: ${r.text}`);
  // Prompt tokens are the cost that grew with the history (T6): the total and how many the provider served from cache.
  const metrics = (s.agentMetrics ?? []).map((m) => ({ request: clip(m.request, 60), engine: m.engine, calls: m.llmCalls, seconds: +(m.agentMs / 1000).toFixed(1), llmUsd: +m.llmUsd.toFixed(4), questionRounds: m.questionRounds, rejected: m.rejectedPlans, outcome: m.outcome, inputTokens: m.inputTokens, cachedTokens: (m.callTimings ?? []).reduce((a, c) => a + (c.cachedTokens ?? 0), 0), firstOutputS: m.callTimings?.[0] ? +(((m.callTimings[0].outputMs ?? m.callTimings[0].toolMs ?? m.callTimings[0].totalMs) / 1000).toFixed(1)) : null, calls_ms: m.callTimings ?? [] }));
  const generations = Object.values(gens).filter((g) => g.sessionId === s.id);
  const charged = generations.reduce((a, g) => a + (g.actualUsd ?? 0), 0);
  const estimated = generations.reduce((a, g) => a + (g.estimate?.usd ?? 0), 0);
  return { id: s.id, title: s.title, createdAt: new Date(s.createdAt).toISOString(), checks, metrics, lines, generations: generations.length, failedGenerations: generations.filter((g) => g.status === 'error').length, charged, estimated, agentUsd: metrics.reduce((a, m) => a + m.llmUsd, 0) };
}

describe.skipIf(!process.env.E2E_REPORT)('report of real sessions (from data/state.json)', () => {
  it('writes the timeline and the checks', () => {
    const statePath = process.env.E2E_STATE ?? 'data/state.json';
    const saved = (JSON.parse(readFileSync(statePath).toString('utf8')) as { state: Saved }).state;
    const since = process.env.E2E_SINCE ? new Date(/^\d+$/.test(process.env.E2E_SINCE) ? Number(process.env.E2E_SINCE) : process.env.E2E_SINCE).getTime() : 0;
    const only = process.env.E2E_SESSIONS?.split(',');
    const sessions = Object.values(saved.sessions)
      .filter((s) => (only ? only.includes(s.id) : s.createdAt >= since && s.feed.some((f: FeedItem) => f.type === 'user')))
      .sort((a, b) => a.createdAt - b.createdAt);
    const reports = sessions.map((s) => reportSession(s, saved.generations));

    const commit = (() => { try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'unknown'; } })();
    const date = new Date().toISOString().slice(0, 16).replace(':', '');
    const out = process.env.E2E_OUT ?? join('e2e-runs', date);
    mkdirSync(out, { recursive: true });
    const failed = reports.flatMap((r) => r.checks.filter((c) => !c.ok).map((c) => ({ session: r.title, ...c })));
    const md = [
      `# Real sessions report · ${date} · commit ${commit}`,
      '',
      `Sessions: ${reports.length} · generations ${reports.reduce((a, r) => a + r.generations, 0)} (${reports.reduce((a, r) => a + r.failedGenerations, 0)} failed) · charged ${usd(reports.reduce((a, r) => a + r.charged, 0))} (est ${usd(reports.reduce((a, r) => a + r.estimated, 0))}) · agent ${usd(reports.reduce((a, r) => a + r.agentUsd, 0))}`,
      '',
      '## Checks that failed',
      '',
      ...(failed.length ? ['| Session | Check | Detail |', '|---|---|---|', ...failed.map((c) => `| ${clip(c.session, 40)} | ${c.check} | ${c.detail.replace(/\|/g, '/')} |`)] : ['None.']),
      '',
      ...reports.flatMap((r) => [
        `## ${r.title} (${r.id}, ${r.createdAt})`,
        '',
        `Checks: ${r.checks.filter((c) => c.ok).length} passed, ${r.checks.filter((c) => !c.ok).length} failed. Generations ${r.generations} · charged ${usd(r.charged)} / est ${usd(r.estimated)} · agent ${usd(r.agentUsd)}.`,
        '',
        '| Request | Agent model | LLM calls | Seconds | First output s | Input tokens | Cached | Agent $ | Question rounds | Rejected plans | Outcome |',
        '|---|---|---|---|---|---|---|---|---|---|---|',
        ...r.metrics.map((m) => `| ${m.request.replace(/\|/g, '/')} | ${m.engine} | ${m.calls} | ${m.seconds} | ${m.firstOutputS ?? '—'} | ${m.inputTokens} | ${m.cachedTokens} | ${m.llmUsd} | ${m.questionRounds} | ${m.rejected} | ${m.outcome ?? '—'} |`),
        '',
        '### Timeline',
        ...r.lines,
        '',
        '### Checks',
        '',
        ...r.checks.map((c) => `- ${c.ok ? '✅' : '❌'} ${c.check} — ${c.detail}`),
        '',
      ]),
    ].join('\n');
    writeFileSync(join(out, 'report.md'), md);
    writeFileSync(join(out, 'report.json'), JSON.stringify({ date, commit, since: since ? new Date(since).toISOString() : null, reports }, null, 2));
    // The sessions themselves (history, feed, metrics) and their generations, without settings or keys: the run can be
    // read again (or replayed) even if the app's state is later overwritten, as happened on 2026-10-03.
    const gensOf = Object.fromEntries(Object.entries(saved.generations).filter(([, g]) => sessions.some((x) => x.id === g.sessionId)));
    writeFileSync(join(out, 'sessions.json'), JSON.stringify({ sessions, generations: gensOf }));
    console.log(`Report: ${join(out, 'report.md')} · ${reports.length} sessions · ${failed.length} failed checks`);
  });
});
