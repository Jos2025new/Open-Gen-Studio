import { runCacheOracle } from './cacheoracle';

/* Bisection entry: runs the cache oracle and posts the JSON to ?report= (bench/engines/resultserver.py). */
const params = new URLSearchParams(location.search);
const report = params.get('report');
runCacheOracle(Number(params.get('ops') ?? 200), Number(params.get('seed') ?? 20260412), params.get('raster') !== '0', params.get('tone') !== '0').then((result) => {
  const body = JSON.stringify(result);
  document.body.dataset.done = '1';
  if (report) return fetch(report, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
}).catch((e) => { document.body.dataset.error = String(e); });
