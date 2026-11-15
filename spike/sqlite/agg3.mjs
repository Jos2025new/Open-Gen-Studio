// SPIKE round 3: median [min-max] over the rounds in /tmp/ogs-sqlite-spike-data/r3/<variant>-<round>.json
import { readdirSync, readFileSync } from 'node:fs';
const D = '/tmp/ogs-sqlite-spike-data/r3';
const files = readdirSync(D).filter((f) => /^(v2|base|a|b|c)-\d\.json$/.test(f));
const by = {};
for (const f of files) (by[f.split('-')[0]] ??= []).push(JSON.parse(readFileSync(`${D}/${f}`, 'utf8')));
const med = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const fmt = (a, d = 1) => `${med(a).toFixed(d)} [${Math.min(...a).toFixed(d)}-${Math.max(...a).toFixed(d)}]`;
const rows = [
  ['import ms', (d) => d.importMs],
  ['small edit p50', (d) => d.smallEditMs.p50],
  ['small edit p95', (d) => d.smallEditMs.p95],
  ['gen edit p50', (d) => d.genEditMs.p50],
  ['gesture p50', (d) => d.gestureMs.p50],
  ['startup p50', (d) => d.startup.ms.p50],
  ['startup bytes MB', (d) => d.startup.bytes / 1048576],
  ['RSS steady MB', (d) => d.memSteady.rssMB],
  ['heap steady MB', (d) => d.memSteady.heapMB],
  ['RSS peak MB', (d) => d.memSteady.peakRssMB],
  ['RSS after startup MB', (d) => d.startup.rssAfterFirst.rssMB],
  ['idle ms', (d) => d.idle.ms],
  ['idle after edit ms', (d) => d.idleAfterEdit.ms],
  ['disk data MB (after idle)', (d) => d.diskAfterIdle.dataBytes / 1048576],
  ['disk w/ backups MB', (d) => d.diskAfterIdle.withBackups / 1048576],
  ['wire body KB (small edit)', (d) => d.wire.editBodyBytes / 1024],
  ['wire parse ms', (d) => d.wire.parseMs],
];
const vs = ['v2', 'base', 'a', 'b', 'c'].filter((v) => by[v]);
console.log(`rounds: ${vs.map((v) => `${v}=${by[v].length}`).join(' ')}`);
console.log(['measure', ...vs].join(' | '));
for (const [name, f] of rows) console.log([name, ...vs.map((v) => fmt(by[v].map(f), name.includes('ms') || name.includes('MB') ? 1 : 0))].join(' | '));
const shas = new Set(vs.filter((v) => v !== 'v2').flatMap((v) => by[v].map((d) => d.startup.sha)));
console.log('state sha across base/a/b/c:', [...shas].join(','));
const pg = by.c?.map((d) => d.startup.page);
if (pg) console.log('c page: one', fmt(pg.map((p) => p.oneMs), 2), 'all', fmt(pg.map((p) => p.allMs)), 'pages', pg[0].pages, 'records', pg[0].records);
