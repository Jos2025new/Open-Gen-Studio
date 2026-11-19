/**
 * ADR 0031 (agents in parallel): an agent's state is written by id. A hand-built write of `session.agent` (`agent: { ...s.agent, … }`
 * put into the session) lands in whichever agent is on screen, not in the agent whose turn, card or plan it belongs to.
 * The only ways in are `patchAgent(sessionId, patch, owner)` / `patchLane(sessionId, owner, patch)`; the compiler already
 * demands an owner from them (and from pushHistory, flushToolResults, messageMeta, engineLabel). Static; fails with file:line.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseSync } from 'rolldown/utils';

// lanes.ts and the store define the by-id write itself.
const ALLOWED = new Set(['src/engine/agent/lanes.ts', 'src/store/store.ts']);
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
    const text = readFileSync(file, 'utf8');
    const { program, errors: broken } = parseSync(file, text);
    if (broken.length) { errors.push(`${rel}:1: could not be parsed, so its agent writes could not be checked (${broken[0].message}).`); continue; }
    const flag = (node, why) => errors.push(`${rel}:${text.slice(0, node.start).split('\n').length}: ${why}. ${HINT}`);
    const keyName = (p) => (p.key?.type === 'Identifier' ? p.key.name : p.key?.value);
    const isAgentMember = (n) => n?.type === 'MemberExpression' && !n.computed && n.property?.name === 'agent';
    const touchesAgent = (n) => { for (let m = n; m?.type === 'MemberExpression'; m = m.object) if (isAgentMember(m)) return true; return false; };
    // `agent` is also the name of a settings key and of a message's label (a string): those are not an agent's state.
    const plain = (v) => v?.type === 'Literal' || v?.type === 'TemplateLiteral' || (v?.type === 'Identifier' && v.name === 'undefined') || (v?.type === 'ConditionalExpression' && plain(v.consequent) && plain(v.alternate));
    const settingsLike = (o) => o.properties.some((p) => p.type === 'SpreadElement' && (p.argument?.property?.name === 'settings' || p.argument?.name === 'settings'));
    // The syntax tree: line breaks, a variable in between or `Object.assign` do not hide a write.
    const visit = (node) => {
      if (!node || typeof node.type !== 'string') return;
      // `{ ...session, agent: … }` (a session rebuilt with an agent put in it), however it is laid out.
      if (node.type === 'ObjectExpression' && node.properties.some((p) => p.type === 'SpreadElement') && !settingsLike(node) && node.properties.some((p) => p.type === 'Property' && keyName(p) === 'agent' && !plain(p.value))) flag(node, "puts an agent into a session by hand (it lands in the agent on screen)");
      // `Object.assign(session.agent, …)`, `session.agent.busy = …`, `session.agent.notes.push(…)`.
      if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression' && node.callee.object?.name === 'Object' && node.callee.property?.name === 'assign' && touchesAgent(node.arguments[0])) flag(node, "mutates an agent's state by hand");
      if (node.type === 'AssignmentExpression' && touchesAgent(node.left)) flag(node, "assigns into an agent's state by hand");
      if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression' && ['push', 'splice', 'pop', 'shift', 'unshift', 'sort', 'reverse'].includes(node.callee.property?.name) && touchesAgent(node.callee.object)) flag(node, "mutates an agent's state by hand");
      for (const key of Object.keys(node)) {
        const child = node[key];
        if (Array.isArray(child)) child.forEach(visit); else if (child && typeof child === 'object') visit(child);
      }
    };
    visit(program);
  }
  return errors;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const errors = check('.');
  if (errors.length) { console.error(`check-agent-owner: ${errors.length} write(s) without an owner\n${errors.map((e) => `  ${e}`).join('\n')}`); process.exit(1); }
  console.log('check-agent-owner: an agent is written only by id.');
}
