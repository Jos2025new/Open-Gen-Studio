import { runEngine, refExport } from './harness';

/* One build per engine (BENCH_ENGINE). The page runs the gestures at ?zoom= and writes the JSON into #result. */
const params = new URLSearchParams(location.search);
const zoom = Number(params.get('zoom') ?? 0.365);
const only = params.get('only')?.split(',');
const mode = params.get('mode') ?? 'run';
const w = window as unknown as Record<string, unknown>;
(mode === 'ref' ? refExport() : runEngine(zoom, only)).then((result) => {
  w.__RESULT__ = result;
  const pre = document.createElement('pre');
  pre.id = 'result';
  pre.textContent = JSON.stringify(result);
  document.body.appendChild(pre);
  document.body.dataset.done = '1';
}).catch((e) => {
  w.__ERROR__ = String((e as Error)?.stack ?? e);
  document.body.dataset.error = String(e);
});
