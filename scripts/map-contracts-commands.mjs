/** Checked by map.mjs: the command core (ADR 0030). */
export default [
  {
    id: 'command-check',
    what: 'El check estático vigila la convención y la deuda; la prueba de humo ejecuta los comandos sin autorizar gasto.',
    sides: [
      ['scripts/check-commands.mjs', 'function inspect('],
      ['scripts/check-all.mjs', "['commands', 'node', ['scripts/check-commands.mjs']]"],
      ['package.json', 'node scripts/check-commands.mjs'],
      ['src/engine/design/commands.ts', 'check-commands: reads-active'],
      ['src/store/commands.ts', 'check-commands: reads-active'],
    ],
    tests: ['tests/commands-smoke.test.ts'],
  },
  {
    id: 'command-index',
    what: 'Los comandos de un apartado van en commands.ts o <nombre>.commands.ts y exportan `commands`; index.ts los reúne por nombre de archivo, nadie los lista a mano.',
    sides: [
      ['src/engine/commands/index.ts', "import.meta.glob(['/src/**/commands.ts', '/src/**/*.commands.ts']"],
      ['src/engine/commands/collect.ts', 'modules[file] as { commands?: unknown }'],
      ['src/engine/commands/registry.ts', 'export function register'],
    ],
    tests: ['tests/commands-core.test.ts'],
  },
  {
    id: 'command-history-keys',
    what: 'Un comando nombra sus historiales como `tipo:id`; el apartado registra el adaptador de ese tipo. Una llamada o secuencia = un paso de deshacer en cada uno.',
    sides: [
      ['src/engine/commands/types.ts', 'history?: (on: Target, args: A)'],
      ['src/engine/commands/history.ts', 'export function registerHistory'],
      ['src/engine/commands/history.ts', "key.indexOf(':')"],
      ['src/engine/commands/run.ts', 'function openHistories'],
    ],
    tests: ['tests/commands-core.test.ts'],
  },
  {
    id: 'command-effect-approval',
    what: '`effect` decide la aprobación en la frontera: spend y delete siempre, write desde fuera; una pregunta por secuencia. La interfaz (invoke) no pregunta ni valida.',
    sides: [
      ['src/engine/commands/types.ts', "export type Effect = 'read' | 'write' | 'spend' | 'delete';"],
      ['src/engine/commands/run.ts', 'export function needsApproval'],
      ['src/engine/commands/run.ts', 'export function setApprover'],
    ],
    tests: ['tests/commands-core.test.ts'],
  },
  {
    id: 'designer-commands',
    what: 'Cada acción exportada de design/actions.ts es un comando o dice por qué no (DESIGNER_ACTIONS); el destino va en `on` y una secuencia es un paso de deshacer del doc.',
    sides: [
      ['src/engine/design/commands.ts', 'export const DESIGNER_ACTIONS'],
      ['src/engine/design/layer.commands.ts', "id: 'designer.layer.set'"],
      ['src/engine/design/commandKit.ts', "registerHistory('designer'"],
      ['src/engine/design/history.ts', 'export function openHistoryGroup'],
    ],
    tests: ['tests/designer-commands.test.ts'],
  },
  {
    id: 'agent-command-tools',
    what: 'El agente llega al registro por dos herramientas, no una por comando; solo puede nombrar un doc de su sesión.',
    sides: [
      ['src/engine/agent/commandTools.ts', "name: 'run_commands'"],
      ['src/engine/agent/commandTools.ts', "name: 'find_commands'"],
      ['src/engine/agent/commandCalls.ts', 'export async function runCommandsTool'],
      ['src/engine/agent/canvasCalls.ts', "call.name === 'find_commands' || call.name === 'run_commands'"],
      ['src/engine/agent/designerTools.ts', '...COMMAND_TOOLS,'],
      ['src/engine/skills/app/designer.md', 'run_commands lo hace al momento'],
    ],
    tests: ['tests/designer-commands.test.ts'],
  },
  {
    id: 'nodes-commands',
    what: 'Cada acción exportada de flow/actions.ts es un comando o dice por qué no (NODES_ACTIONS); el destino es `on.session` y una secuencia es un paso de deshacer del grafo.',
    sides: [
      ['src/engine/flow/commands.ts', 'export const NODES_ACTIONS'],
      ['src/engine/flow/commands.ts', "id: 'nodes.run.start'"],
      ['src/engine/flow/commandKit.ts', "registerHistory('nodes'"],
      ['src/engine/flow/history.ts', 'export function openHistoryGroup'],
    ],
    tests: ['tests/nodes-commands.test.ts'],
  },
  {
    id: 'sessions-commands',
    what: 'Las funciones de sesión del store son comandos (SESSION_ACTIONS) con el destino en `on.session`; ninguno lee la sesión activa salvo `sessions.list` para marcarla.',
    sides: [
      ['src/store/commands.ts', 'export const SESSION_ACTIONS'],
      ['src/store/commands.ts', "id: 'sessions.list'"],
    ],
    tests: ['tests/sessions-commands.test.ts'],
  },
];
