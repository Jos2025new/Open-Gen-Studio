// SPIKE round 4: median [min-max] over the rounds in /tmp/ogs-sqlite-spike-data/r4/<variant>-<round>.json
import { readdirSync, readFileSync } from 'node:fs';
const D = '/tmp/ogs-sqlite-spike-data/r4';
const files = readdirSync(D).filter((f) => /^(v2|a|b|ba)-\d\.json$/.test(f));
const by = {};
for (const f of files) (by[f.split('-')[0]] ??= []).push(JSON.parse(readFileSync(`${D}/${f}`, 'utf8')));
const med = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const fmt = (a, d = 1) => `${med(a).toFixed(d)} [${Math.min(...a).toFixed(d)}-${Math.max(...a).toFixed(d)}]`;
const rows = [
  ['startup p50 ms', (d) => d.startup.ms.p50],
  ['small edit p50 ms', (d) => d.smallEditMs.p50],
  ['small edit p95 ms', (d) => d.smallEditMs.p95],
  ['gen edit p50 ms', (d) => d.genEditMs.p50],
  ['gesture p50 ms', (d) => d.gestureMs.p50],
  ['import ms', (d) => d.importMs],
  ['RSS after import MB', (d) => d.memAfterImport.rssMB],
  ['heap after import MB', (d) => d.memAfterImport.heapMB],
  ['RSS steady MB', (d) => d.memSteady.rssMB],
  ['heap steady MB', (d) => d.memSteady.heapMB],
  ['RSS after idle MB', (d) => d.memAfterIdle.rssMB],
  ['heap after idle MB', (d) => d.memAfterIdle.heapMB],
  ['RSS peak MB', (d) => d.memAfterIdle.peakRssMB],
  ['RSS after startup MB', (d) => d.startup.rssAfterFirst.rssMB],
  ['idle ms', (d) => d.idle.ms],
  ['idle after edit ms', (d) => d.idleAfterEdit.ms],
  ['disk data MB (after idle)', (d) => d.diskAfterIdle.dataBytes / 1048576],
  ['disk w/ backups MB', (d) => d.diskAfterIdle.withBackups / 1048576],
  ['wire body KB (small edit)', (d) => d.wire.editBodyBytes / 1024],
  ['wire parse ms', (d) => d.wire.parseMs],
];
const vs = ['v2', 'a', 'b', 'ba'].filter((v) => by[v]);
console.log(`rounds: ${vs.map((v) => `${v}=${by[v].length}`).join(' ')}`);
console.log(['measure', ...vs].join(' | '));
for (const [name, f] of rows) console.log([name, ...vs.map((v) => fmt(by[v].map(f), name.includes('ms') || name.includes('MB') ? 1 : 0))].join(' | '));
const shas = new Set(vs.filter((v) => v !== 'v2').flatMap((v) => by[v].map((d) => d.startup.sha)));
console.log('state sha across a/b/ba:', [...shas].join(','));
const sources = new Set((by.ba ?? []).map((d) => d.startup.source));
console.log('ba startup source:', [...sources].join(','));
