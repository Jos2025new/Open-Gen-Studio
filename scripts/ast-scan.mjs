/**
 * The walk the static checks share: every .ts/.tsx under src/ (minus an allow list) is parsed with the syntax tree
 * (never lines: a call split over several lines is the same call) and every node is offered to the check.
 * A check supplies `rules(file)`: `{ enter(node, report), leave?(node) }`; `report(node, message)` records `file:line: message`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseSync } from 'rolldown/utils';

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** Problems under `root` as `file:line: message` strings. `what` names what could not be checked when a file does not parse. */
export function scan(root, { allowed, what, rules }) {
  const errors = [];
  for (const file of walk(join(root, 'src'))) {
    const rel = relative(root, file).split('\\').join('/');
    if (allowed.has(rel)) continue;
    const text = readFileSync(file, 'utf8');
    const { program, errors: broken } = parseSync(file, text);
    if (broken.length) { errors.push(`${rel}:1: could not be parsed, so its ${what} could not be checked (${broken[0].message}).`); continue; }
    const report = (node, message) => errors.push(`${rel}:${text.slice(0, node.start).split('\n').length}: ${message}`);
    const { enter, leave } = rules({ rel, text, program });
    const visit = (node) => {
      if (!node || typeof node.type !== 'string') return;
      enter(node, report);
      for (const key of Object.keys(node)) {
        const child = node[key];
        if (Array.isArray(child)) child.forEach(visit); else if (child && typeof child === 'object') visit(child);
      }
      leave?.(node);
    };
    visit(program);
  }
  return errors;
}
