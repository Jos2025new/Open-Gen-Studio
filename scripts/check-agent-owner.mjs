/**
 * ADR 0031 (agents in parallel): an agent's state is written by id. A hand-built write of `session.agent` (`agent: { ...s.agent, … }`
 * put into the session) lands in whichever agent is on screen, not in the agent whose turn, card or plan it belongs to.
 * The only ways in are `patchAgent(sessionId, patch, owner)` / `patchLane(sessionId, owner, patch)`; the compiler already
 * demands an owner from them (and from pushHistory, flushToolResults, messageMeta, engineLabel). Static; fails with file:line.
 */
import { pathToFileURL } from 'node:url';
import { scan } from './ast-scan.mjs';

// lanes.ts and the store define the by-id write itself.
// lanes.ts holds the threads and the one choice of which is shown; the store keeps the shown thread in step; writerHandoff only asks whether any agent is busy (protected).
const ALLOWED = new Set(['src/engine/agent/lanes.ts', 'src/engine/agent/threads.ts', 'src/store/store.ts']); // store.ts only builds a new session and migrates a saved one
const THREAD_KEYS = new Set(['agents', 'agentLane']);
const HINT = 'write it by id: `patchAgent(sessionId, patch, owner)` (agent/runtimeShared.ts) or `patchLane(sessionId, owner, patch)` (agent/lanes.ts); `owner` is the agent the turn, card or plan belongs to.';

/** Problems under `root`, as `file:line: message` strings. */
export function check(root = '.') {
  return scan(root, {
    allowed: ALLOWED,
    what: 'agent writes',
    rules: () => {
      const keyName = (p) => (p.key?.type === 'Identifier' ? p.key.name : p.key?.value);
      const isAgentMember = (n) => n?.type === 'MemberExpression' && !n.computed && n.property?.name === 'agent';
      const touchesAgent = (n) => { for (let m = n; m?.type === 'MemberExpression'; m = m.object) if (isAgentMember(m)) return true; return false; };
      // Reading `.agent` of a session is reading whichever agent is on screen: threads are read by id (`laneState`, `threadOf`, `useThread`).
      const SESSION_NAMES = new Set(['s', 'session', 'sess', 'x', 'cur', 'prev', 'next', 'sn', 'current']);
      const sessionish = (n) => {
        const o = n?.type === 'ChainExpression' ? n.expression : n;
        if (o?.type === 'Identifier') return SESSION_NAMES.has(o.name);
        if (o?.type === 'CallExpression') return ['session', 'S', 'sessionOf'].includes(o.callee?.name);
        if (o?.type === 'MemberExpression') return o.computed && (o.object?.property?.name === 'sessions' || o.object?.name === 'sessions');
        return false;
      };
      // `agent` is also the name of a settings key and of a message's label (a string): those are not an agent's state.
      const plain = (v) => v?.type === 'Literal' || v?.type === 'TemplateLiteral' || (v?.type === 'Identifier' && v.name === 'undefined') || (v?.type === 'ConditionalExpression' && plain(v.consequent) && plain(v.alternate));
      const settingsLike = (o) => o.properties.some((p) => p.type === 'SpreadElement' && (p.argument?.property?.name === 'settings' || p.argument?.name === 'settings'));
      // The syntax tree: line breaks, a variable in between or `Object.assign` do not hide a write.
      let inSettings = 0; // `setSettings((s) => ({ agent: { ...s.agent } }))`: `s` is the settings, whose `agent` is the model choice
      const opensSettings = (node) => node.type === 'CallExpression' && /^setSettings$/.test(node.callee?.name ?? '');
      return {
        enter: (node, report) => {
          const flag = (n, why) => report(n, `${why}. ${HINT}`);
          if (opensSettings(node)) inSettings++;
          // `{ ...session, agent: … }` (a session rebuilt with an agent put in it), however it is laid out.
          if (node.type === 'ObjectExpression' && node.properties.some((p) => p.type === 'SpreadElement') && !settingsLike(node) && node.properties.some((p) => p.type === 'Property' && keyName(p) === 'agent' && !plain(p.value))) flag(node, "writes an agent's state by hand (puts an agent into a session: it lands in the agent on screen)");
          if (node.type === 'MemberExpression' && !node.computed && node.property?.name === 'agent' && !inSettings && sessionish(node.object)) flag(node, "reads whichever agent is on screen (`session.agent`)");
          // `Object.assign(session.agent, …)`, `session.agent.busy = …`, `session.agent.notes.push(…)`.
          if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression' && node.callee.object?.name === 'Object' && node.callee.property?.name === 'assign' && touchesAgent(node.arguments[0])) flag(node, "mutates an agent's state by hand");
          if (node.type === 'AssignmentExpression' && touchesAgent(node.left)) flag(node, "assigns into an agent's state by hand");
          if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression' && ['push', 'splice', 'pop', 'shift', 'unshift', 'sort', 'reverse'].includes(node.callee.property?.name) && touchesAgent(node.callee.object)) flag(node, "mutates an agent's state by hand");
          // The thread map and the pointer to the one on screen belong to lanes.ts and threads.ts: `s.agents`, `s.agentLane`, `{ agents }` or `{ agentLane }` anywhere else is a read or write that picks a thread by position.
          if (node.type === 'MemberExpression' && THREAD_KEYS.has(node.computed ? node.property?.value : node.property?.name) && !inSettings) flag(node, `touches \`.${node.computed ? node.property.value : node.property.name}\` outside lanes.ts and threads.ts`);
          // `const { agent, keys } = get().settings` is the settings' model choice; destructuring a thread out of anything else is a read by position.
          const fromSettings = (i) => (i?.property?.name ?? i?.name) === 'settings';
          if (node.type === 'VariableDeclarator' && node.id?.type === 'ObjectPattern' && !fromSettings(node.init) && node.id.properties.some((p) => p.type === 'Property' && (THREAD_KEYS.has(keyName(p)) || keyName(p) === 'agent'))) flag(node, 'destructures an agent thread out of an object');
          if (node.type === 'Property' && THREAD_KEYS.has(keyName(node)) && node.parent !== 'pattern' && !inSettings) flag(node, `writes \`${keyName(node)}:\` into a session by hand`);
        },
        leave: (node) => { if (opensSettings(node)) inSettings--; },
      };
    },
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const errors = check('.');
  if (errors.length) { console.error(`check-agent-owner: ${errors.length} write(s) without an owner\n${errors.map((e) => `  ${e}`).join('\n')}`); process.exit(1); }
  console.log('check-agent-owner: an agent is written only by id.');
}
