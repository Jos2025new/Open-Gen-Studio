import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { failureSummary } from './price-pilot.mjs';
import { prepareOrRunExpansion2 } from './price-pilot-expansion.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const execute = process.argv.includes('--execute');
prepareOrRunExpansion2(root, execute).then((result) => {
  console.log(execute ? `Expansion-2 ${result.status}. Results: .sandbox/pilot/expansion-2/results.json` : JSON.stringify(result, null, 2));
}).catch((error) => {
  console.error(error.message === 'NANOGPT_API_KEY is required; no request sent' ? error.message :
    `Expansion-2 aborted. No retry. ${failureSummary(error)} Review .sandbox/pilot/expansion-2/results.json if created.`);
  process.exitCode = 1;
});
