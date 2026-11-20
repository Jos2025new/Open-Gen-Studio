// Runs every project check in order and writes one log: .checks/last.log (rule · file:line · problem · fix, as each check prints it).
import { spawnSync } from 'node:child_process'; import fs from 'node:fs';
const steps = [['tsc', 'npx', ['tsc', '-b', '--noEmit']], ['safeguards', 'node', ['scripts/check-safeguards.mjs']], ['protected', 'node', ['scripts/check-protected.mjs']],
  ['docs', 'node', ['scripts/check-docs.mjs']], ['sizes', 'node', ['scripts/check-sizes.mjs']], ['engine-structure', 'node', ['scripts/check-engine-structure.mjs']], ['css-units', 'node', ['scripts/px-to-rem.mjs', '--check']], ['gui', 'node', ['scripts/check-gui.mjs']], ['functions', 'node', ['scripts/check-functions.mjs']], ['commands', 'node', ['scripts/check-commands.mjs']], ['node-descriptors', 'node', ['scripts/check-node-descriptors.mjs']], ['graph-writes', 'node', ['scripts/check-graph-writes.mjs']], ['agent-owner', 'node', ['scripts/check-agent-owner.mjs']], ['map', 'node', ['scripts/map.mjs']]];
fs.mkdirSync('.checks', { recursive: true });
let log = `checks ${new Date().toISOString()}\n`, failed = 0;
for (const [name, cmd, args] of steps) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  const ok = r.status === 0; if (!ok) failed++;
  log += `\n## ${name}: ${ok ? 'PASS' : 'FAIL'}\n${ok ? '' : (r.stdout + r.stderr).trim() + '\n'}`;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
}
fs.writeFileSync('.checks/last.log', log);
console.log(`${failed ? failed + ' failed' : 'all passed'}; details in .checks/last.log`);
process.exit(failed ? 1 : 0);
