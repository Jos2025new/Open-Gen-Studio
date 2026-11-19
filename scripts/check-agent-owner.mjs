/**
 * ADR 0031 (agents in parallel): an agent's state is written by id. A hand-built write of `session.agent` (`agent: { ...s.agent, … }`
 * put into the session) lands in whichever agent is on screen, not in the agent whose turn, card or plan it belongs to.
 * The only ways in are `patchAgent(sessionId, patch, owner)` / `patchLane(sessionId, owner, patch)`; the compiler already
 * demands an owner from them (and from pushHistory, flushToolResults, messageMeta, engineLabel). Static; fails with file:line.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

// lanes.ts and the store define the by-id write itself.
const ALLOWED = new Set(['src/engine/agent/lanes.ts', 'src/store/store.ts']);
const HAND_WRITE = /\.\.\.\w+,\s*agent:\s*\{\s*\.\.\.\w+\.agent\b/; // `{ ...session, agent: { ...session.agent, … } }`
const HINT = 'write it by id: `patchAgent(sessionId, patch, owner)` (agent/runtimeShared.ts) or `patchLane(sessionId, owner, patch)` (agent/lanes.ts); `owner` is the agent the turn, card or plan belongs to.';

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** Problems under `root`, as `file:line: message` strings. */
export function check(root = '.') {
  const errors = [];
  for (const file of walk(join(root, 'src'))) {
    const rel = relative(root, file).split('\\').join('/');
    if (ALLOWED.has(rel)) continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (HAND_WRITE.test(line.replace(/\/\/.*$/, ''))) errors.push(`${rel}:${i + 1}: writes an agent's state by hand (it lands in the agent on screen). ${HINT}`);
    });
  }
  return errors;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const errors = check('.');
  if (errors.length) { console.error(`check-agent-owner: ${errors.length} write(s) without an owner\n${errors.map((e) => `  ${e}`).join('\n')}`); process.exit(1); }
  console.log('check-agent-owner: an agent is written only by id.');
}
