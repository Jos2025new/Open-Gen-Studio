export default {
  id: 'sandbox-external-cli',
  what: 'El lanzador sandbox publica una credencial efímera para ogs. El puente autentica al CLI, vincula una pestaña, envía las solicitudes por SSE y acepta sus respuestas. La pestaña conserva los destinos y la aprobación del núcleo ADR 0030.',
  sides: [
    ['scripts/dev-sandbox.mjs', 'bridge.publish(root)'],
    ['vite.config.ts', "'**/external-cli.json*'"],
    ['server/external-cli.mjs', "const PREFIX = '/x/ext/';"],
    ['scripts/ogs-cli.mjs', '/.sandbox/external-cli.json'],
    ['src/App.tsx', "import.meta.env.VITE_OGS_SANDBOX === '1' && <ExternalCliControl"],
    ['src/components/shell/ExternalCliControl.tsx', 'external-cli-approval'],
    ['src/lib/externalCliTab.ts', "fetch('/x/ext/result'"],
    ['src/engine/externalCommands.ts', "caller: 'external'"],
    ['src/engine/agent/commandCalls.ts', 'export function createsCommandDoc('],
  ],
  tests: ['tests/external-cli.test.ts', 'tests/external-commands.test.ts'],
};
