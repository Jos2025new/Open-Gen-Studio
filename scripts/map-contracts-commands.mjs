/** Checked by map.mjs: the command core (ADR 0030). */
export default [
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
];
