/**
 * ADR 0031 point 5: the graph is written in one place. Anything outside `src/engine/nodecore/edit.ts` (and the store's own
 * definition) that calls `setGraph`, `writeGraph`, `editGraph`, or writes `graph:` into the session by hand is a second path
 * that skips the revisions, the cable rules and the trace. Static; fails with file:line and a fix hint.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

// dropResults is the one held exception: a reducer inside the store's own atomic asset deletion (generations and indices change
// in one `set`), it only rewrites result indices of nodes and cables. Moving it into the layer needs the layer to join that transaction.
const ALLOWED = new Set(['src/engine/nodecore/edit.ts', 'src/store/store.ts', 'src/engine/flow/dropResults.ts']);
const CALL = /\b(setGraph|writeGraph|editGraph)\s*\(/;
const SESSION_WRITE = /\.\.\.\w+,\s*graph:/; // `{ ...session, graph: … }` put into the store by hand
const HINT = 'write the graph through `applyEdit` (src/engine/nodecore/edit.ts): `connect`/`disconnect`/`set`/`delete`/`add` for a cable or a parameter, `editCompound` for a composed change, `editPresentation` for position, size or groups.';

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
      const code = line.replace(/\/\/.*$/, '');
      if (/^\s*(import|export)\b.*\bfrom\b/.test(code)) return;
      if (CALL.test(code) || SESSION_WRITE.test(code)) errors.push(`${rel}:${i + 1}: writes the graph outside the editing layer. ${HINT}`);
    });
  }
  return errors;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const errors = check('.');
  if (errors.length) { console.error(`check-graph-writes: ${errors.length} write(s) outside the editing layer\n${errors.map((e) => `  ${e}`).join('\n')}`); process.exit(1); }
  console.log('check-graph-writes: the graph is written only through the editing layer.');
}
