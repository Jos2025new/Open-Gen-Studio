import { runEngine, refExport } from './harness';
import { runParity, runSequence } from './parity';
import { runCacheOracle } from './cacheoracle';

/* One build per engine (BENCH_ENGINE). The page runs the gestures at ?zoom= and writes the JSON into #result. */
const params = new URLSearchParams(location.search);
const zoom = Number(params.get('zoom') ?? 0.365);
const only = params.get('only')?.split(',');
const mode = params.get('mode') ?? 'run';
const w = window as unknown as Record<string, unknown>;
(mode === 'ref' ? refExport() : mode === 'cache' ? runCacheOracle(Number(params.get('ops') ?? 200), Number(params.get('seed') ?? 20260412), params.get('raster') !== '0', params.get('tone') !== '0', params.get('nofx') === '1') : mode === 'parity' ? runParity() : mode === 'sequence' ? runSequence(Number(params.get('ops') ?? 200), Number(params.get('seed') ?? 20260412), params.get('raster') !== '0', params.get('tone') !== '0') : runEngine(zoom, only)).then((result) => {
  w.__RESULT__ = result;
  const report = params.get('report');
  if (report) void fetch(report, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) });
  const pre = document.createElement('pre');
  pre.id = 'result';
  pre.textContent = JSON.stringify(result);
  document.body.appendChild(pre);
  document.body.dataset.done = '1';
}).catch((e) => {
  w.__ERROR__ = String((e as Error)?.stack ?? e);
  document.body.dataset.error = String(e);
});
